-- Requires migrations 003, 004, 006 and 011. Existing logs are preserved.
-- This version uses no custom PostgreSQL settings (restricted on Supabase).
BEGIN;
CREATE TABLE IF NOT EXISTS public.assignment_log_context (
 transaction_id bigint PRIMARY KEY,
 mode text NOT NULL CHECK (mode IN ('automatic','booking_edit'))
);
ALTER TABLE public.assignment_log_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assignment_log_context FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.assignment_log_context TO service_role;

-- Keep the existing allocation implementations and permissions intact. Their
-- public entry points below add only transaction-local logging context.
DO $$ BEGIN
 IF to_regprocedure('public.create_booking_with_assignments_impl(jsonb,jsonb,bigint)') IS NULL THEN
  ALTER FUNCTION public.create_booking_with_assignments(jsonb,jsonb,bigint) RENAME TO create_booking_with_assignments_impl;
 END IF;
 IF to_regprocedure('public.update_booking_with_assignments_impl(bigint,jsonb,jsonb)') IS NULL THEN
  ALTER FUNCTION public.update_booking_with_assignments(bigint,jsonb,jsonb) RENAME TO update_booking_with_assignments_impl;
 END IF;
 IF to_regprocedure('public.delete_booking_with_assignments_impl(bigint)') IS NULL THEN
  ALTER FUNCTION public.delete_booking_with_assignments(bigint) RENAME TO delete_booking_with_assignments_impl;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_booking_with_assignments(
 p_booking jsonb,p_guests_per_room jsonb,p_preferred_bed_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE previous_mode text; result jsonb;
BEGIN
 SELECT mode INTO previous_mode FROM public.assignment_log_context WHERE transaction_id=txid_current();
 INSERT INTO public.assignment_log_context VALUES(txid_current(),'automatic')
 ON CONFLICT(transaction_id) DO UPDATE SET mode=EXCLUDED.mode;
 result:=public.create_booking_with_assignments_impl(p_booking,p_guests_per_room,p_preferred_bed_id);
 IF previous_mode IS NULL THEN DELETE FROM public.assignment_log_context WHERE transaction_id=txid_current();
 ELSE UPDATE public.assignment_log_context SET mode=previous_mode WHERE transaction_id=txid_current(); END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.update_booking_with_assignments(
 p_booking_id bigint,p_updates jsonb,p_guests_per_room jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE previous_mode text; result jsonb;
BEGIN
 SELECT mode INTO previous_mode FROM public.assignment_log_context WHERE transaction_id=txid_current();
 -- Creation calls this allocator too: preserve the outer automatic context.
 INSERT INTO public.assignment_log_context VALUES(txid_current(),coalesce(previous_mode,'booking_edit'))
 ON CONFLICT(transaction_id) DO UPDATE SET mode=EXCLUDED.mode;
 result:=public.update_booking_with_assignments_impl(p_booking_id,p_updates,p_guests_per_room);
 IF previous_mode IS NULL THEN DELETE FROM public.assignment_log_context WHERE transaction_id=txid_current();
 ELSE UPDATE public.assignment_log_context SET mode=previous_mode WHERE transaction_id=txid_current(); END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.delete_booking_with_assignments(p_booking_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE previous_mode text; result jsonb;
BEGIN
 SELECT mode INTO previous_mode FROM public.assignment_log_context WHERE transaction_id=txid_current();
 INSERT INTO public.assignment_log_context VALUES(txid_current(),'automatic')
 ON CONFLICT(transaction_id) DO UPDATE SET mode=EXCLUDED.mode;
 result:=public.delete_booking_with_assignments_impl(p_booking_id);
 IF previous_mode IS NULL THEN DELETE FROM public.assignment_log_context WHERE transaction_id=txid_current();
 ELSE UPDATE public.assignment_log_context SET mode=previous_mode WHERE transaction_id=txid_current(); END IF;
 RETURN result;
END $$;
-- Context writes roll back with failed calls. Successful calls restore their
-- caller's context or remove it; pooled connections retain no suppression state.
REVOKE ALL ON FUNCTION public.create_booking_with_assignments(jsonb,jsonb,bigint),
 public.update_booking_with_assignments(bigint,jsonb,jsonb),public.delete_booking_with_assignments(bigint),
 public.create_booking_with_assignments_impl(jsonb,jsonb,bigint),
 public.update_booking_with_assignments_impl(bigint,jsonb,jsonb),public.delete_booking_with_assignments_impl(bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_assignments(jsonb,jsonb,bigint),
 public.update_booking_with_assignments(bigint,jsonb,jsonb),public.delete_booking_with_assignments(bigint),
 public.create_booking_with_assignments_impl(jsonb,jsonb,bigint),
 public.update_booking_with_assignments_impl(bigint,jsonb,jsonb),public.delete_booking_with_assignments_impl(bigint)
 TO service_role;

CREATE OR REPLACE FUNCTION public.should_log_assignment(assignment_kind text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM public.assignment_log_context
  WHERE transaction_id=txid_current()
    AND (mode='automatic' OR (mode='booking_edit' AND assignment_kind='bed'))
 );
$$;
REVOKE ALL ON FUNCTION public.should_log_assignment(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.should_log_assignment(text) TO service_role;
DROP TRIGGER IF EXISTS activity_booking_beds ON public.booking_beds;
CREATE TRIGGER activity_booking_beds AFTER INSERT OR UPDATE OR DELETE ON public.booking_beds
FOR EACH ROW WHEN (public.should_log_assignment('bed'))
EXECUTE FUNCTION public.record_activity_change('bed_assignment','booking_bed_id');
DROP TRIGGER IF EXISTS activity_booking_rooms ON public.booking_rooms;
CREATE TRIGGER activity_booking_rooms AFTER INSERT OR UPDATE OR DELETE ON public.booking_rooms
FOR EACH ROW WHEN (public.should_log_assignment('room'))
EXECUTE FUNCTION public.record_activity_change('room_assignment','booking_room_id');
COMMIT;
