import { z } from 'zod';
import {
  consignmentAssetSchema, consignmentCommandSchema, consignmentDeltaSchema, consignmentItemSchema,
  consignmentPriceSchema, merchantShopSchema,
} from '../core/prototype/consignment';
import { countSchema } from '../core/prototype/types';
import { clientSaveSchema, revisionSchema } from './client-save';

export const CONSIGNMENT_PAGE_SIZE = 50;
const timeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const consignmentContextSchema = z.object({
  characterId: z.uuid(), baseRevision: revisionSchema, save: clientSaveSchema, shopId: merchantShopSchema,
}).strict();
export const consignmentRequestSchema = consignmentContextSchema.extend({
  requestId: z.uuid(), command: consignmentCommandSchema,
}).strict();
export type ConsignmentRequest = z.infer<typeof consignmentRequestSchema>;
export const consignmentReceiptSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('succeeded'), characterId: z.uuid(), requestId: z.uuid(),
    revision: revisionSchema, tradeRevision: revisionSchema, settledAt: timeSchema,
    delta: consignmentDeltaSchema, listingId: z.uuid().nullable(), deliveryId: z.uuid().nullable(),
  }).strict(),
  z.object({
    status: z.literal('rejected'), characterId: z.uuid(), requestId: z.uuid(), settledAt: timeSchema,
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  }).strict(),
]);
export type ConsignmentReceipt = z.infer<typeof consignmentReceiptSchema>;
export const consignmentLookupSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unknown') }).strict(),
  z.object({ status: z.literal('settled'), receipt: consignmentReceiptSchema }).strict(),
]);

export const consignmentListingSchema = z.object({
  id: z.uuid(), sellerId: z.uuid(), asset: consignmentItemSchema, unitPrice: consignmentPriceSchema,
  quantity: z.number().int().positive().max(10000), remaining: z.number().int().nonnegative().max(10000),
  gross: countSchema, fee: countSchema,
  status: z.enum(['active', 'sold', 'cancelled']), createdAt: timeSchema, updatedAt: timeSchema,
}).strict();
export type ConsignmentListing = z.infer<typeof consignmentListingSchema>;
export const consignmentDeliverySchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), asset: consignmentAssetSchema, quantity: countSchema, createdAt: timeSchema,
}).strict();
export type ConsignmentDelivery = z.infer<typeof consignmentDeliverySchema>;
export const consignmentFillSchema = z.object({
  id: z.uuid(), listingId: z.uuid(), buyerId: z.uuid(), sellerId: z.uuid(),
  quantity: z.number().int().positive(), gross: countSchema, fee: countSchema, net: countSchema, at: timeSchema,
}).strict();
export type ConsignmentFill = z.infer<typeof consignmentFillSchema>;

export const consignmentFilterSchema = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.enum(['material', 'food', 'marrow', 'insight', 'foundation-pill', 'part', 'equipment']).optional(),
  minQuality: z.number().int().min(10).max(999).optional(),
  maxQuality: z.number().int().min(10).max(999).optional(),
  minPrice: consignmentPriceSchema.optional(), maxPrice: consignmentPriceSchema.optional(),
}).strict().refine(value => (value.minQuality === undefined || value.maxQuality === undefined || value.minQuality <= value.maxQuality) &&
  (value.minPrice === undefined || value.maxPrice === undefined || BigInt(value.minPrice) <= BigInt(value.maxPrice)));
export const consignmentViewRequestSchema = consignmentContextSchema.extend({
  view: z.enum(['market', 'mine', 'deliveries']),
  page: z.number().int().min(0).max(1_000_000),
  filter: consignmentFilterSchema,
}).strict();
export type ConsignmentFilter = z.infer<typeof consignmentFilterSchema>;
export const consignmentTotalsSchema = z.object({
  purchaseSpent: countSchema, saleGross: countSchema, saleFees: countSchema, saleNet: countSchema,
}).strict();
export type ConsignmentTotals = z.infer<typeof consignmentTotalsSchema>;
export const publicListingSchema = consignmentListingSchema.omit({ sellerId: true, gross: true, fee: true, quantity: true }).extend({
  sellerName: z.string(), isSelf: z.boolean(), name: z.string(),
});
export const consignmentViewSchema = z.object({
  scope: z.literal('development'), view: z.enum(['market', 'mine', 'deliveries']), page: z.number().int().nonnegative(),
  hasMore: z.boolean(), activeCount: z.number().int().nonnegative(), slots: z.number().int().positive(),
  listings: z.array(publicListingSchema), deliveries: z.array(consignmentDeliverySchema.omit({ ownerId: true })),
  totals: consignmentTotalsSchema,
}).strict();
export type ConsignmentView = z.infer<typeof consignmentViewSchema>;
