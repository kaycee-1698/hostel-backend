-- Apply once in Supabase SQL Editor. Existing rooms receive a base rate of 600.
BEGIN;
ALTER TABLE public.rooms ADD COLUMN base_rate numeric(12,2);
UPDATE public.rooms SET base_rate=600;
ALTER TABLE public.rooms ALTER COLUMN base_rate SET NOT NULL;
ALTER TABLE public.rooms ADD CONSTRAINT room_base_rate_valid CHECK (base_rate>=0 AND base_rate<=1000000);
CREATE TABLE public.room_daily_rates (
 room_id bigint NOT NULL REFERENCES public.rooms(room_id) ON DELETE CASCADE,
 stay_date date NOT NULL,
 rate numeric(12,2) NOT NULL CHECK(rate>=0 AND rate<=1000000),
 PRIMARY KEY(room_id,stay_date)
);
ALTER TABLE public.room_daily_rates ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.room_daily_rates TO service_role;
CREATE FUNCTION public.save_room_daily_rates(p_updates jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; total integer;
BEGIN
 IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected rate updates'; END IF;
 total:=jsonb_array_length(p_updates);
 IF total<1 OR total>10000 THEN RAISE EXCEPTION 'Save between 1 and 10000 daily rates at a time'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
  IF jsonb_typeof(item->'room_id') IS DISTINCT FROM 'number' OR (item->>'room_id') !~ '^[1-9][0-9]*$'
   OR jsonb_typeof(item->'rate') IS DISTINCT FROM 'number' OR (item->>'rate')::numeric<0 OR (item->>'rate')::numeric>1000000
   OR trunc((item->>'rate')::numeric,2)<>(item->>'rate')::numeric
   OR coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid daily rate'; END IF;
 END LOOP;
 INSERT INTO public.room_daily_rates(room_id,stay_date,rate)
 SELECT (value->>'room_id')::bigint,(value->>'date')::date,(value->>'rate')::numeric FROM jsonb_array_elements(p_updates)
 ON CONFLICT(room_id,stay_date) DO UPDATE SET rate=EXCLUDED.rate;
 RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.save_room_daily_rates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_room_daily_rates(jsonb) TO service_role;
COMMIT;
