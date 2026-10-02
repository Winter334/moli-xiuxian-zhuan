CREATE TABLE moli_client.world_messages (
  id BIGSERIAL PRIMARY KEY,
  application_id TEXT NOT NULL,
  sender_key TEXT NOT NULL,
  request_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  body TEXT,
  created_at BIGINT NOT NULL,
  deleted_at BIGINT,
  UNIQUE (application_id, sender_key, request_id)
);
CREATE INDEX world_messages_history ON moli_client.world_messages (application_id, id DESC);
CREATE INDEX world_messages_retention ON moli_client.world_messages (created_at);
CREATE INDEX world_messages_sender_rate ON moli_client.world_messages (application_id, sender_key, created_at DESC);

CREATE TABLE moli_client.world_mutes (
  application_id TEXT NOT NULL,
  player_key TEXT NOT NULL,
  until_at BIGINT NOT NULL,
  PRIMARY KEY (application_id, player_key)
);
