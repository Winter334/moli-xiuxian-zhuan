import { z } from 'zod';
import { integerAdd } from '../numbers';
import { addInstance, addStack, cleared, readCharacter, type CharacterState } from './character-state';
import { CharacterCommandError, commandEntry } from './command-error';
import { ITEMS, MANOR_AID, SHOPS } from './content';
import { instanceSchema, itemValue } from './equipment';
import { countSchema } from './types';

export const CONSIGNMENT_SLOTS = 20;
export const CONSIGNMENT_BATCH = 10000;
export const merchantShopSchema = z.enum(['market-supplies', 'stoneforge-supplies', 'manor-metalwork', 'forest-supplies']);
export const consignmentPriceSchema = countSchema.refine(value => BigInt(value) > 0n && BigInt(value) <= 1_000_000_000_000n);
const itemIdSchema = z.string().min(1).max(100);
const instanceIdSchema = z.string().regex(/^item-[1-9]\d*$/).max(100);
export const consignmentItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stack'), itemId: itemIdSchema }).strict(),
  instanceSchema.extend({ kind: z.literal('instance') }).strict(),
]);
export const consignmentAssetSchema = z.union([
  consignmentItemSchema, z.object({ kind: z.literal('money') }).strict(),
]);
export const consignmentGrantSchema = z.object({
  asset: consignmentAssetSchema,
  quantity: countSchema.refine(value => BigInt(value) > 0n),
}).strict();
export const consignmentSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stack'), itemId: itemIdSchema, quantity: z.number().int().min(1).max(CONSIGNMENT_BATCH) }).strict(),
  z.object({ kind: z.literal('instance'), instanceId: instanceIdSchema }).strict(),
]);
export const consignmentDeltaSchema = z.object({
  debit: z.union([
    consignmentSelectionSchema,
    z.object({ kind: z.literal('money'), amount: consignmentPriceSchema }).strict(),
  ]).nullable(),
  credit: consignmentGrantSchema.nullable(),
}).strict();
export const consignmentCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list'), selection: consignmentSelectionSchema, unitPrice: consignmentPriceSchema }).strict(),
  z.object({
    type: z.literal('buy'), listingId: z.uuid(), unitPrice: consignmentPriceSchema,
    quantity: z.number().int().min(1).max(CONSIGNMENT_BATCH),
  }).strict(),
  z.object({ type: z.literal('cancel'), listingId: z.uuid() }).strict(),
  z.object({ type: z.literal('claim'), deliveryId: z.uuid(), quantity: z.number().int().min(1).max(1_000_000_000_000) }).strict(),
]);
export type ConsignmentItem = z.infer<typeof consignmentItemSchema>;
export type ConsignmentAsset = z.infer<typeof consignmentAssetSchema>;
export type ConsignmentGrant = z.infer<typeof consignmentGrantSchema>;
export type ConsignmentDelta = z.infer<typeof consignmentDeltaSchema>;
export type ConsignmentSelection = z.infer<typeof consignmentSelectionSchema>;

export function requireMerchant(state: CharacterState, shopId: z.infer<typeof merchantShopSchema>) {
  const shop = SHOPS[shopId];
  if (state.locationId !== shop.locationId || state.simulation.battle) {
    throw new CharacterCommandError('请先前往商会所在的安全地点');
  }
  if (shop.prerequisite && !cleared(state, shop.prerequisite)) throw new CharacterCommandError('此商会尚未开放');
}

export function validateConsignmentItem(asset: ConsignmentItem) {
  const item = commandEntry(ITEMS, asset.itemId, '没有这个物品');
  if (asset.itemId === MANOR_AID.itemId) throw new CharacterCommandError('巡枢残印不能寄售');
  if ((asset.kind === 'instance') !== (item.kind === 'part' || item.kind === 'equipment')) {
    throw new CharacterCommandError('物品形态不匹配');
  }
  return item;
}

export function selectConsignmentItem(state: CharacterState, selection: ConsignmentSelection): ConsignmentItem {
  if (selection.kind === 'instance') {
    const instance = commandEntry(state.instances, selection.instanceId, '此器物已不在行囊中');
    if (Object.values(state.equipment).includes(selection.instanceId)) throw new CharacterCommandError('请先卸下寄售器物');
    const asset = { kind: 'instance' as const, ...instance };
    validateConsignmentItem(asset);
    return asset;
  }
  const asset = { kind: 'stack' as const, itemId: selection.itemId };
  validateConsignmentItem(asset);
  if (BigInt(state.inventory[selection.itemId] ?? '0') < BigInt(selection.quantity)) {
    throw new CharacterCommandError('寄售物品数量不足');
  }
  return asset;
}

export function consignmentFloor(asset: ConsignmentItem): string {
  validateConsignmentItem(asset);
  return itemValue(asset.itemId, asset.kind === 'instance' ? asset.quality : undefined);
}

export function consignmentFee(gross: string): string {
  return String((BigInt(gross) + 49n) / 50n);
}

// Credits allocate recipient-local instance IDs, never the seller's IDs.
export function applyConsignmentDelta(input: CharacterState, raw: ConsignmentDelta): CharacterState {
  const state = readCharacter(input);
  const { debit, credit } = consignmentDeltaSchema.parse(raw);
  if (debit?.kind === 'money') {
    if (BigInt(state.money) < BigInt(debit.amount)) throw new CharacterCommandError('灵石不足');
    state.money = integerAdd(state.money, `-${debit.amount}`);
  } else if (debit) {
    selectConsignmentItem(state, debit);
    if (debit.kind === 'instance') delete state.instances[debit.instanceId];
    else addStack(state.inventory, debit.itemId, -debit.quantity);
  }
  if (credit) {
    if (credit.asset.kind === 'money') state.money = integerAdd(state.money, credit.quantity);
    else {
      validateConsignmentItem(credit.asset);
      if (credit.asset.kind === 'instance') {
        if (credit.quantity !== '1') throw new CharacterCommandError('器物须逐件领取');
        addInstance(state, state.instances, credit.asset.itemId, credit.asset.quality);
      } else addStack(state.inventory, credit.asset.itemId, credit.quantity);
    }
  }
  return readCharacter(state);
}
