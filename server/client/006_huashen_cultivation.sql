-- Keep legacy snapshots readable. On the first write, preserve the complete
-- original in the same transaction before applying the authorized level-24 cap.
CREATE TABLE moli_client.huashen_originals (
  character_id UUID NOT NULL REFERENCES moli_client.characters(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('previous', 'incoming')),
  save JSONB NOT NULL,
  PRIMARY KEY (character_id, revision, source)
);
CREATE FUNCTION moli_client.cap_huashen_cultivation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original_amount NUMERIC;
  log_entries JSONB;
BEGIN
  IF OLD.save #>> '{character,level}' = '24'
      AND (OLD.save #>> '{character,cultivation}')::numeric > 1000000000000 THEN
    INSERT INTO moli_client.huashen_originals VALUES (OLD.id, OLD.revision, 'previous', OLD.save)
      ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.save #>> '{character,level}' = '24' THEN
    original_amount := (NEW.save #>> '{character,cultivation}')::numeric;
    IF original_amount > 1000000000000 THEN
      INSERT INTO moli_client.huashen_originals VALUES (NEW.id, NEW.revision, 'incoming', NEW.save)
        ON CONFLICT DO NOTHING;
      NEW.save := jsonb_set(NEW.save, '{character,cultivation}', '"1000000000000"'::jsonb);
      SELECT COALESCE(jsonb_agg(entry ORDER BY ordinal), '[]'::jsonb) INTO log_entries
        FROM jsonb_array_elements(NEW.save #> '{character,log}') WITH ORDINALITY AS entries(entry, ordinal)
        WHERE ordinal > jsonb_array_length(NEW.save #> '{character,log}') - 199;
      log_entries := log_entries || jsonb_build_array(jsonb_build_object(
        'at', (NEW.save #>> '{character,simulation,clockMs}')::bigint,
        'message', left('化神开放修为处理：原有' || original_amount || '，元婴圆满上限1000000000000，移除超额' || (original_amount - 1000000000000), 500)));
      NEW.save := jsonb_set(NEW.save, '{character,log}', log_entries);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER huashen_cultivation_before_write BEFORE UPDATE OF save ON moli_client.characters
  FOR EACH ROW EXECUTE FUNCTION moli_client.cap_huashen_cultivation();
