CREATE TABLE characters (
  id UUID PRIMARY KEY,
  state JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  stones NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT character_state_object CHECK (
    jsonb_typeof(state) = 'object'
    AND NOT (state ?| ARRAY['stones', 'inventory', 'equipment'])
  ),
  CONSTRAINT character_stones_integer CHECK (
    stones >= 0 AND stones = trunc(stones)
    AND stones::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);

CREATE TABLE inventory (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
  quantity NUMERIC NOT NULL,
  PRIMARY KEY (character_id, item_id),
  CONSTRAINT inventory_quantity_integer CHECK (
    quantity >= 0 AND quantity = trunc(quantity)
    AND quantity::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);

CREATE TABLE equipment_instances (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL CHECK (length(instance_id) BETWEEN 1 AND 128),
  definition_id TEXT NOT NULL CHECK (length(definition_id) BETWEEN 1 AND 128),
  position INTEGER NOT NULL CHECK (position >= 0),
  instance JSONB NOT NULL,
  PRIMARY KEY (character_id, instance_id),
  UNIQUE (character_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT equipment_data_object CHECK (
    jsonb_typeof(instance) = 'object'
    AND NOT (instance ?| ARRAY['instanceId', 'definitionId', 'characterId'])
  )
);

CREATE TABLE dev_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  character_id UUID NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE command_requests (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status_code SMALLINT NOT NULL CHECK (status_code IN (200, 422)),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, request_id)
);
