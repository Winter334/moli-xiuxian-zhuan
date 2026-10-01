import { createHash, randomUUID } from 'node:crypto';
import {
  applyConsignmentDelta, consignmentFee, consignmentFloor, CONSIGNMENT_SLOTS, requireMerchant, selectConsignmentItem,
  type ConsignmentAsset, type ConsignmentDelta,
} from '../../core/prototype/consignment';
import { CharacterCommandError } from '../../core/prototype/command-error';
import { ITEMS } from '../../core/prototype/content';
import { readClientSave, revisionSchema, SaveCapacityError } from '../../shared/client-save';
import {
  CONSIGNMENT_PAGE_SIZE, consignmentReceiptSchema, consignmentRequestSchema, consignmentViewRequestSchema,
  consignmentViewSchema, type ConsignmentReceipt, type ConsignmentRequest, type ConsignmentView,
} from '../../shared/consignment';
import { ApiError } from '../errors';
import { checkCheckpoint } from './checkpoint';
import type { ConsignmentPlan, ConsignmentStore, ConsignmentTransaction } from './consignment-store';

const advanceRevision = (revision: string) => revisionSchema.parse(String(BigInt(revision) + 1n));
function reject(code: string, message: string): never { throw new ApiError(409, code, message); }

export class ConsignmentService {
  constructor(private readonly store: ConsignmentStore, private readonly now: () => number = Date.now) {}

  async execute(characterId: string, raw: unknown): Promise<ConsignmentReceipt> {
    const input = consignmentRequestSchema.parse(raw);
    if (input.characterId !== characterId) reject('IDENTITY_CONFLICT', '寄售身份与当前角色不一致。');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.store.transact(characterId, async tx => {
      const previous = await tx.receipt(input.requestId);
      if (previous) {
        if (previous.hash !== hash) reject('IDEMPOTENCY_CONFLICT', '同一交易编号的内容发生变化，请核对原请求。');
        return previous.receipt;
      }
      const now = this.now();
      let prepared: { plan: ConsignmentPlan; receipt: ConsignmentReceipt };
      try {
        prepared = await this.plan(tx, input, now);
      } catch (error) {
        if (!(error instanceof ApiError || error instanceof CharacterCommandError || error instanceof SaveCapacityError)) throw error;
        const receipt: ConsignmentReceipt = {
          status: 'rejected', characterId, requestId: input.requestId, settledAt: now,
          error: { code: error instanceof ApiError ? error.code : 'TRADE_REJECTED', message: error.message },
        };
        await tx.record(hash, receipt);
        return receipt;
      }
      // No writes happen during planning; storage failures roll back the entire transaction.
      await tx.apply(prepared.plan, now);
      await tx.record(hash, prepared.receipt);
      return prepared.receipt;
    });
  }

  private async plan(tx: ConsignmentTransaction, input: ConsignmentRequest, now: number) {
    const save = checkCheckpoint(tx.snapshot, input, now);
    this.requireEligible(save.character.history.testAssisted);
    requireMerchant(save.character, input.shopId);
    const delta: ConsignmentDelta = { debit: null, credit: null };
    const plan: ConsignmentPlan = { save, listing: null, deliveries: [], claimed: null, fill: null };
    let listingId: string | null = null;
    let deliveryId: string | null = null;
    const deliver = (ownerId: string, asset: ConsignmentAsset, quantity: string) => {
      if (quantity !== '0') plan.deliveries.push({ id: randomUUID(), ownerId, asset, quantity, createdAt: now });
    };
    const command = input.command;
    if (command.type === 'list') {
      const asset = selectConsignmentItem(save.character, command.selection);
      if (BigInt(command.unitPrice) < BigInt(consignmentFloor(asset))) reject('PRICE_TOO_LOW', '寄售单价不得低于该物品的系统回收价。');
      if (await tx.activeCount() >= CONSIGNMENT_SLOTS) reject('LISTING_LIMIT', '在售货单已满，请先撤回或等待售出。');
      const quantity = command.selection.kind === 'instance' ? 1 : command.selection.quantity;
      listingId = randomUUID();
      plan.listing = {
        create: true,
        state: {
          id: listingId, sellerId: input.characterId, asset, unitPrice: command.unitPrice, quantity, remaining: quantity,
          gross: '0', fee: '0', status: 'active', createdAt: now, updatedAt: now,
        },
      };
      delta.debit = command.selection;
    } else if (command.type === 'buy' || command.type === 'cancel') {
      const listing = await tx.listing(command.listingId);
      if (!listing || listing.status !== 'active') reject('LISTING_UNAVAILABLE', '货单已售完、已撤回或不存在。');
      listingId = listing.id;
      if (command.type === 'buy') {
        if (listing.sellerId === input.characterId) reject('OWN_LISTING', '不能购买自己的货单。');
        if (command.unitPrice !== listing.unitPrice) reject('PRICE_CHANGED', '货单价格不匹配，请重新查看。');
        if (command.quantity > listing.remaining) reject('INSUFFICIENT_STOCK', '剩余数量不足，本次未成交。');
        const gross = BigInt(listing.unitPrice) * BigInt(command.quantity);
        if (gross > BigInt(save.character.money)) reject('INSUFFICIENT_MONEY', '灵石不足，本次未成交。');
        const cumulative = String(BigInt(listing.gross) + gross);
        const fee = BigInt(consignmentFee(cumulative)) - BigInt(listing.fee);
        const net = gross - fee;
        delta.debit = { kind: 'money', amount: String(gross) };
        listing.remaining -= command.quantity;
        listing.gross = cumulative;
        listing.fee = consignmentFee(cumulative);
        if (listing.remaining === 0) listing.status = 'sold';
        deliver(input.characterId, listing.asset, String(command.quantity));
        deliver(listing.sellerId, { kind: 'money' }, String(net));
        plan.fill = {
          id: randomUUID(), listingId, buyerId: input.characterId, sellerId: listing.sellerId,
          quantity: command.quantity, gross: String(gross), fee: String(fee), net: String(net), at: now,
        };
      } else {
        if (listing.sellerId !== input.characterId) reject('NOT_OWNER', '只能撤回自己的货单。');
        deliver(input.characterId, listing.asset, String(listing.remaining));
        listing.remaining = 0;
        listing.status = 'cancelled';
      }
      listing.updatedAt = Math.max(now, listing.createdAt);
      plan.listing = { create: false, state: listing };
    } else {
      const delivery = await tx.delivery(command.deliveryId);
      if (!delivery || delivery.ownerId !== input.characterId || BigInt(delivery.quantity) < BigInt(command.quantity)) {
        reject('DELIVERY_UNAVAILABLE', '待领资产不足、已领取或不属于当前角色。');
      }
      if (delivery.asset.kind === 'instance' && command.quantity !== 1) reject('INSTANCE_QUANTITY', '器物须逐件领取。');
      delta.credit = { asset: delivery.asset, quantity: String(command.quantity) };
      delivery.quantity = String(BigInt(delivery.quantity) - BigInt(command.quantity));
      plan.claimed = delivery;
      deliveryId = delivery.id;
    }
    plan.save = readClientSave({
      ...save, tradeRevision: advanceRevision(save.tradeRevision), character: applyConsignmentDelta(save.character, delta),
    });
    const receipt = consignmentReceiptSchema.parse({
      status: 'succeeded', characterId: input.characterId, requestId: input.requestId,
      revision: advanceRevision(tx.snapshot.revision), tradeRevision: plan.save.tradeRevision, settledAt: now,
      delta, listingId, deliveryId,
    });
    return { plan, receipt };
  }

  async lookup(characterId: string, requestId: string) {
    const record = await this.store.receipt(characterId, requestId);
    return record ? { status: 'settled' as const, receipt: record.receipt } : { status: 'unknown' as const };
  }

  async view(characterId: string, raw: unknown): Promise<ConsignmentView> {
    const input = consignmentViewRequestSchema.parse(raw);
    if (input.characterId !== characterId) reject('IDENTITY_CONFLICT', '寄售身份与当前角色不一致。');
    const save = checkCheckpoint(await this.store.load(characterId), input, this.now());
    this.requireEligible(save.character.history.testAssisted);
    try { requireMerchant(save.character, input.shopId); }
    catch (error) {
      if (error instanceof CharacterCommandError) reject('MERCHANT_UNAVAILABLE', error.message);
      throw error;
    }
    const search = input.filter.search?.toLocaleLowerCase() ?? '';
    const itemIds = Object.entries(ITEMS).filter(([, item]) =>
      (!input.filter.category || item.kind === input.filter.category) && item.name.toLocaleLowerCase().includes(search),
    ).map(([id]) => id);
    const listings = input.view === 'deliveries' ? [] : await this.store.listings({
      ...input.filter, itemIds, page: input.page, ...(input.view === 'mine' ? { sellerId: characterId } : {}),
    });
    const deliveries = input.view === 'deliveries' ? await this.store.deliveries(characterId, input.page) : [];
    return consignmentViewSchema.parse({
      scope: this.store.scope.kind, view: input.view, page: input.page,
      hasMore: Math.max(listings.length, deliveries.length) > CONSIGNMENT_PAGE_SIZE,
      activeCount: await this.store.activeCount(characterId), slots: CONSIGNMENT_SLOTS,
      listings: listings.slice(0, CONSIGNMENT_PAGE_SIZE).map(({ sellerId, sellerProfile, gross: _gross, fee: _fee, quantity: _quantity, ...listing }) => ({
        ...listing, name: ITEMS[listing.asset.itemId].name, isSelf: sellerId === characterId,
        sellerName: sellerProfile.name, sellerAvatarUrl: sellerProfile.avatarUrl,
      })),
      deliveries: deliveries.slice(0, CONSIGNMENT_PAGE_SIZE).map(({ ownerId: _owner, ...delivery }) => delivery),
      totals: await this.store.totals(characterId),
    });
  }

  private requireEligible(testAssisted: boolean) {
    if (this.store.scope.kind === 'discord' && testAssisted) {
      reject('TEST_CHARACTER', '受测试干预的角色不能参与 Discord 寄售。');
    }
  }
}
