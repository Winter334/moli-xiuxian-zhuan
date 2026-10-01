CREATE TABLE moli_client.discord_profiles (
  application_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 128),
  avatar_hash TEXT CHECK (avatar_hash ~ '^(a_)?[a-f0-9]{32}$'),
  updated_at BIGINT NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (application_id, user_id),
  FOREIGN KEY (application_id, user_id)
    REFERENCES moli_client.discord_accounts(application_id, user_id)
);
