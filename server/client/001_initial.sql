CREATE TABLE moli_client.characters (
  id UUID PRIMARY KEY,
  save JSONB NOT NULL CHECK (jsonb_typeof(save) = 'object'),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  received_at BIGINT NOT NULL CHECK (received_at >= 0),
  last_request_id UUID,
  last_payload_hash TEXT CHECK (length(last_payload_hash) = 64)
);

CREATE TABLE moli_client.dev_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  character_id UUID NOT NULL UNIQUE REFERENCES moli_client.characters(id)
);

CREATE TABLE moli_client.consignment_listings (
  id UUID PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES moli_client.characters(id),
  asset JSONB NOT NULL CHECK (jsonb_typeof(asset) = 'object'),
  unit_price NUMERIC(20, 0) NOT NULL CHECK (unit_price > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  remaining INTEGER NOT NULL CHECK (remaining BETWEEN 0 AND quantity),
  gross NUMERIC(24, 0) NOT NULL CHECK (gross >= 0),
  fee NUMERIC(24, 0) NOT NULL CHECK (fee >= 0 AND fee <= gross),
  status TEXT NOT NULL CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at BIGINT NOT NULL CHECK (created_at >= 0),
  updated_at BIGINT NOT NULL CHECK (updated_at >= created_at),
  CHECK ((status = 'active') = (remaining > 0)),
  CHECK (asset->>'kind' <> 'instance' OR quantity = 1)
);
CREATE INDEX consignment_market ON moli_client.consignment_listings (created_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX consignment_seller ON moli_client.consignment_listings (seller_id, created_at DESC, id DESC);

CREATE TABLE moli_client.consignment_deliveries (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES moli_client.characters(id),
  asset JSONB NOT NULL CHECK (jsonb_typeof(asset) = 'object'),
  quantity NUMERIC(24, 0) NOT NULL CHECK (quantity >= 0),
  created_at BIGINT NOT NULL CHECK (created_at >= 0),
  CHECK (asset->>'kind' <> 'instance' OR quantity <= 1)
);
CREATE INDEX consignment_pending ON moli_client.consignment_deliveries (owner_id, created_at, id) WHERE quantity > 0;

CREATE TABLE moli_client.consignment_fills (
  id UUID PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES moli_client.consignment_listings(id),
  buyer_id UUID NOT NULL REFERENCES moli_client.characters(id),
  seller_id UUID NOT NULL REFERENCES moli_client.characters(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  gross NUMERIC(24, 0) NOT NULL CHECK (gross > 0),
  fee NUMERIC(24, 0) NOT NULL CHECK (fee >= 0),
  net NUMERIC(24, 0) NOT NULL CHECK (net >= 0 AND net + fee = gross),
  settled_at BIGINT NOT NULL CHECK (settled_at >= 0),
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX consignment_purchases ON moli_client.consignment_fills (buyer_id);
CREATE INDEX consignment_sales ON moli_client.consignment_fills (seller_id);

CREATE TABLE moli_client.consignment_receipts (
  character_id UUID NOT NULL REFERENCES moli_client.characters(id),
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  PRIMARY KEY (character_id, request_id)
);

CREATE TABLE moli_client.reincarnation_receipts (
  character_id UUID NOT NULL REFERENCES moli_client.characters(id),
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  PRIMARY KEY (character_id, request_id)
);
