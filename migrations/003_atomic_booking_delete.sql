-- Installs a function only. Running this migration does not delete existing data.
-- Guest check-in records and documents are intentionally protected.
CREATE OR REPLACE FUNCTION public.delete_booking_with_assignments(p_booking_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_booking_id IS NULL OR p_booking_id <= 0 THEN
    RAISE EXCEPTION 'Invalid booking ID';
  END IF;
  -- Prevent concurrent guest linkage while checking and deleting.
  PERFORM 1 FROM public.bookings WHERE booking_id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('booking_id', p_booking_id, 'deleted', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.guests WHERE booking_id = p_booking_id) THEN
    RAISE EXCEPTION 'This booking has guest check-in records and cannot be deleted.';
  END IF;
  DELETE FROM public.booking_beds WHERE booking_id = p_booking_id
    OR booking_room_id IN (SELECT booking_room_id FROM public.booking_rooms WHERE booking_id = p_booking_id);
  DELETE FROM public.booking_rooms WHERE booking_id = p_booking_id;
  DELETE FROM public.bookings WHERE booking_id = p_booking_id;
  RETURN jsonb_build_object('booking_id', p_booking_id, 'deleted', true);
END;
$$;
