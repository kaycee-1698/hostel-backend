-- Requires 008. Enables atomic removal of daily overrides; existing data is unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.save_room_daily_rates(p_updates jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; total integer;
BEGIN
 IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected rate updates'; END IF;
 total:=jsonb_array_length(p_updates);
 IF total<1 OR total>10000 THEN RAISE EXCEPTION 'Save between 1 and 10000 daily rates at a time'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
  IF jsonb_typeof(item->'room_id') IS DISTINCT FROM 'number' OR (item->>'room_id') !~ '^[1-9][0-9]*$'
   OR NOT (item ? 'rate') OR (item->'rate'<>'null'::jsonb AND (jsonb_typeof(item->'rate') IS DISTINCT FROM 'number' OR (item->>'rate')::numeric<0 OR (item->>'rate')::numeric>1000000
   OR trunc((item->>'rate')::numeric,2)<>(item->>'rate')::numeric))
   OR coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid daily rate'; END IF;
 END LOOP;
 DELETE FROM public.room_daily_rates r USING jsonb_array_elements(p_updates) removal
 WHERE removal.value->'rate'='null'::jsonb AND r.room_id=(removal.value->>'room_id')::bigint AND r.stay_date=(removal.value->>'date')::date;
 INSERT INTO public.room_daily_rates(room_id,stay_date,rate)
 SELECT (value->>'room_id')::bigint,(value->>'date')::date,(value->>'rate')::numeric FROM jsonb_array_elements(p_updates) WHERE value->'rate'<>'null'::jsonb
 ON CONFLICT(room_id,stay_date) DO UPDATE SET rate=EXCLUDED.rate;
 RETURN total;
END;
$$;
COMMIT;
