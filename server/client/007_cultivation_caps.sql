-- Append-only extension of 006; keep its atomic original-snapshot protection.
-- Keep these next-stage costs aligned with core/prototype/growth.ts.
CREATE FUNCTION moli_client.cultivation_carry_cap(level integer) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE level
    WHEN 24 THEN 1000000000000
    WHEN 25 THEN 12000000000000
    WHEN 26 THEN 88000000000000
    WHEN 27 THEN 320000000000000
    WHEN 28 THEN 1120000000000000
    ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION moli_client.cap_huashen_cultivation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original_amount NUMERIC;
  previous_cap NUMERIC;
  incoming_cap NUMERIC;
  log_entries JSONB;
BEGIN
  previous_cap := moli_client.cultivation_carry_cap((OLD.save #>> '{character,level}')::integer);
  incoming_cap := moli_client.cultivation_carry_cap((NEW.save #>> '{character,level}')::integer);
  IF (OLD.save #>> '{character,cultivation}')::numeric > previous_cap THEN
    INSERT INTO moli_client.huashen_originals VALUES (OLD.id, OLD.revision, 'previous', OLD.save)
      ON CONFLICT DO NOTHING;
  END IF;
  IF incoming_cap IS NOT NULL THEN
    original_amount := (NEW.save #>> '{character,cultivation}')::numeric;
    IF original_amount > incoming_cap THEN
      INSERT INTO moli_client.huashen_originals VALUES (NEW.id, NEW.revision, 'incoming', NEW.save)
        ON CONFLICT DO NOTHING;
      NEW.save := jsonb_set(NEW.save, '{character,cultivation}', to_jsonb(incoming_cap::text));
      SELECT COALESCE(jsonb_agg(entry ORDER BY ordinal), '[]'::jsonb) INTO log_entries
        FROM jsonb_array_elements(NEW.save #> '{character,log}') WITH ORDINALITY AS entries(entry, ordinal)
        WHERE ordinal > jsonb_array_length(NEW.save #> '{character,log}') - 199;
      log_entries := log_entries || jsonb_build_array(jsonb_build_object(
        'at', (NEW.save #>> '{character,simulation,clockMs}')::bigint,
        'message', left('修为封顶处理：原有' || original_amount || '，当前境界上限' || incoming_cap || '，移除超额' || (original_amount - incoming_cap), 500)));
      NEW.save := jsonb_set(NEW.save, '{character,log}', log_entries);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
