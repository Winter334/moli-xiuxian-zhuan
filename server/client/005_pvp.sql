CREATE TABLE moli_client.pvp_battles (
  id UUID PRIMARY KEY,
  attacker_id UUID NOT NULL REFERENCES moli_client.characters(id),
  defender_id UUID REFERENCES moli_client.characters(id),
  state JSONB NOT NULL,
  expires_at BIGINT NOT NULL,
  finished BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (attacker_id <> defender_id)
);
CREATE INDEX pvp_battles_expiry ON moli_client.pvp_battles(expires_at) WHERE NOT finished;
CREATE TABLE moli_client.pvp_players (
  character_id UUID PRIMARY KEY REFERENCES moli_client.characters(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notoriety INTEGER NOT NULL DEFAULT 0 CHECK (notoriety BETWEEN 0 AND 1000000),
  mode_after BIGINT NOT NULL DEFAULT 0,
  attack_after BIGINT NOT NULL DEFAULT 0,
  protected_until BIGINT NOT NULL DEFAULT 0,
  active_battle_id UUID REFERENCES moli_client.pvp_battles(id)
);
