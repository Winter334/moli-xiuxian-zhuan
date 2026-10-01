import { z } from 'zod';
import { addStack, readCharacter, type CharacterState } from '../core/prototype/character-state';
import {
  applyConsignmentDelta, consignmentDeltaSchema, consignmentFloor, selectConsignmentItem,
  type ConsignmentAsset, type ConsignmentDelta,
} from '../core/prototype/consignment';
import { CharacterCommandError } from '../core/prototype/command-error';
import { checkSaveCapacity, revisionSchema } from '../shared/client-save';
import { consignmentRequestSchema, type ConsignmentReceipt, type ConsignmentRequest } from '../shared/consignment';

export const pendingTradeSchema = z.object({
  request: consignmentRequestSchema,
  expected: consignmentDeltaSchema,
  localRevision: revisionSchema,
}).strict();
export type PendingTrade = z.infer<typeof pendingTradeSchema>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function reserveTrade(request: ConsignmentRequest, localRevision: string, claimAsset?: ConsignmentAsset): PendingTrade {
  const command = request.command;
  const expected: ConsignmentDelta = { debit: null, credit: null };
  if (command.type === 'list') {
    const asset = selectConsignmentItem(request.save.character, command.selection);
    if (BigInt(command.unitPrice) < BigInt(consignmentFloor(asset))) {
      throw new CharacterCommandError('寄售单价不得低于系统回收价');
    }
    expected.debit = command.selection;
  } else if (command.type === 'buy') {
    const amount = BigInt(command.unitPrice) * BigInt(command.quantity);
    if (amount > BigInt(request.save.character.money)) throw new CharacterCommandError('灵石不足');
    expected.debit = { kind: 'money', amount: String(amount) };
  } else if (command.type === 'claim') {
    if (!claimAsset) throw new CharacterCommandError('请重新读取待领资产');
    expected.credit = { asset: claimAsset, quantity: String(command.quantity) };
  }
  const pending = pendingTradeSchema.parse({ request, localRevision, expected });
  checkReservedCapacity(request.save.character, pending);
  return pending;
}

// Escrow stays in the durable inventory but is absent from every playable snapshot.
export function availableCharacter(state: CharacterState, pending: PendingTrade | null): CharacterState {
  if (!pending?.expected.debit) return state;
  const debit = pending.expected.debit;
  if (debit.kind === 'instance' &&
      !same(state.instances[debit.instanceId], pending.request.save.character.instances[debit.instanceId])) {
    throw new Error('寄售预留器物发生变化，已保留原请求');
  }
  return applyConsignmentDelta(state, { debit, credit: null });
}

export function restoreReservation(next: CharacterState, pending: PendingTrade | null): CharacterState {
  const debit = pending?.expected.debit;
  if (!debit) return next;
  const state = readCharacter(next);
  if (debit.kind === 'money') state.money = String(BigInt(state.money) + BigInt(debit.amount));
  else if (debit.kind === 'stack') addStack(state.inventory, debit.itemId, debit.quantity);
  else {
    if (state.instances[debit.instanceId]) throw new Error('寄售预留器物编号冲突');
    state.instances[debit.instanceId] = pending!.request.save.character.instances[debit.instanceId];
  }
  return readCharacter(state);
}

export function checkReservedCapacity(state: CharacterState, pending: PendingTrade | null) {
  checkSaveCapacity(state);
  availableCharacter(state, pending);
  if (pending?.expected.credit) {
    checkSaveCapacity(applyConsignmentDelta(state, { debit: null, credit: pending.expected.credit }));
  }
}

export function validateReservation(pending: PendingTrade) {
  const derived = reserveTrade(pending.request, pending.localRevision, pending.expected.credit?.asset);
  if (!same(derived.expected, pending.expected)) throw new Error('寄售预留与原请求不匹配');
}

export function validateTradeReceipt(pending: PendingTrade, receipt: ConsignmentReceipt) {
  const { request, expected } = pending;
  if (receipt.characterId !== request.characterId || receipt.requestId !== request.requestId) {
    throw new Error('寄售回执身份或请求编号不匹配');
  }
  if (receipt.status === 'rejected') return;
  const command = request.command;
  if (BigInt(receipt.revision) !== BigInt(request.baseRevision) + 1n ||
      BigInt(receipt.tradeRevision) !== BigInt(request.save.tradeRevision) + 1n ||
      !same(receipt.delta, expected) ||
      (command.type === 'claim' ? receipt.deliveryId !== command.deliveryId || receipt.listingId !== null
        : receipt.deliveryId !== null || receipt.listingId === null ||
          (command.type !== 'list' && receipt.listingId !== command.listingId))) {
    throw new Error('寄售回执资产或版本不匹配，预留与原请求已保留');
  }
}
