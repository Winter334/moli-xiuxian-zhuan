CREATE TABLE moli_client.discord_accounts (
  application_id TEXT NOT NULL CHECK (application_id ~ '^[0-9]{17,20}$'),
  user_id TEXT NOT NULL CHECK (user_id ~ '^[0-9]{17,20}$'),
  character_id UUID NOT NULL UNIQUE REFERENCES moli_client.characters(id),
  created_at BIGINT NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (application_id, user_id)
);

CREATE TABLE moli_client.discord_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  application_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL CHECK (expires_at >= 0),
  FOREIGN KEY (application_id, user_id)
    REFERENCES moli_client.discord_accounts(application_id, user_id)
);
CREATE INDEX discord_session_expiry ON moli_client.discord_sessions (expires_at);
