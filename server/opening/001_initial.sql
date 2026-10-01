CREATE TABLE moli_opening.characters (
  id UUID PRIMARY KEY,
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moli_opening.dev_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  character_id UUID NOT NULL UNIQUE REFERENCES moli_opening.characters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moli_opening.command_requests (
  character_id UUID NOT NULL REFERENCES moli_opening.characters(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status_code SMALLINT NOT NULL CHECK (status_code IN (200, 422)),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, request_id)
);
