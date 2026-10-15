-- Apply in Supabase SQL Editor before deploying the updated backend.
-- Uses the existing tables and their column types; does not change table data.
CREATE OR REPLACE FUNCTION public.update_booking_with_assignments(
  p_booking_id bigint,
  p_updates jsonb,
  p_guests_per_room jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  proposed public.bookings%ROWTYPE;
  room_entry record;
  room_assignment public.booking_rooms%ROWTYPE;
  selected_beds bigint[];
  allocations jsonb := '{}'::jsonb;
  requested integer;
  total_guests integer := 0;
BEGIN
  -- Serializes allocation writes, including the existing non-RPC endpoints.
  -- Acquire before reading availability. Suitable for a small hostel; holds
  -- only for this transaction. Ordinary reads remain available.
  LOCK TABLE public.bookings, public.booking_rooms, public.booking_beds,
    public.rooms, public.beds IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO proposed FROM public.bookings WHERE booking_id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;

  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Booking updates must be an object';
  END IF;
  -- Ignore unrelated fields and never permit a booking ID change.
  SELECT * INTO proposed FROM jsonb_populate_record(proposed,
    (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
     FROM jsonb_each(p_updates)
     WHERE key = ANY (ARRAY['booking_name','ota_name','number_of_adults',
       'contact_number','check_in','check_out','base_amount','payment_received',
       'commission','gst','pending_amount','payment_status','bank','other_info'])));

  IF proposed.check_in IS NULL OR proposed.check_out IS NULL
     OR proposed.check_out <= proposed.check_in THEN
    RAISE EXCEPTION 'Check-out date must be after check-in date';
  END IF;
  proposed.number_of_nights := proposed.check_out::date - proposed.check_in::date;
  IF jsonb_typeof(p_guests_per_room) IS DISTINCT FROM 'object'
     OR p_guests_per_room = '{}'::jsonb THEN
    RAISE EXCEPTION 'Guests must be assigned to rooms';
  END IF;

  -- Plan every replacement before changing any booking or assignment.
  FOR room_entry IN SELECT key, value FROM jsonb_each_text(p_guests_per_room) LOOP
    IF room_entry.key !~ '^[1-9][0-9]*$' OR room_entry.value IS NULL
       OR room_entry.value !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Room IDs and guest counts must be positive integers';
    END IF;
    requested := room_entry.value::integer;
    total_guests := total_guests + requested;
    SELECT array_agg(candidate.bed_id ORDER BY candidate.bed_id) INTO selected_beds
    FROM (
      SELECT bed.bed_id FROM public.beds bed
      WHERE bed.room_id = room_entry.key::bigint
        AND NOT EXISTS (
          SELECT 1 FROM public.booking_beds occupied
          WHERE occupied.bed_id = bed.bed_id
            AND occupied.booking_id IS DISTINCT FROM p_booking_id
            AND occupied.check_in < proposed.check_out
            AND occupied.check_out > proposed.check_in
        )
      ORDER BY bed.bed_id LIMIT requested
    ) candidate;
    IF coalesce(cardinality(selected_beds), 0) < requested THEN
      RAISE EXCEPTION 'Room % does not have % available bed(s) for the selected dates',
        room_entry.key, requested;
    END IF;
    allocations := allocations || jsonb_build_object(room_entry.key, selected_beds);
  END LOOP;
  IF proposed.number_of_adults IS NULL OR total_guests <> proposed.number_of_adults THEN
    RAISE EXCEPTION 'Room allocations must match the number of adults';
  END IF;

  UPDATE public.bookings SET
    booking_name = proposed.booking_name, ota_name = proposed.ota_name,
    number_of_adults = proposed.number_of_adults, contact_number = proposed.contact_number,
    check_in = proposed.check_in, check_out = proposed.check_out,
    number_of_nights = proposed.number_of_nights, base_amount = proposed.base_amount,
    payment_received = proposed.payment_received, commission = proposed.commission,
    gst = proposed.gst, pending_amount = proposed.pending_amount,
    payment_status = proposed.payment_status, bank = proposed.bank, other_info = proposed.other_info
  WHERE booking_id = p_booking_id RETURNING * INTO proposed;

  DELETE FROM public.booking_beds WHERE booking_id = p_booking_id;
  DELETE FROM public.booking_rooms WHERE booking_id = p_booking_id;
  FOR room_entry IN SELECT key, value FROM jsonb_each(allocations) LOOP
    INSERT INTO public.booking_rooms (booking_id, room_id, number_of_guests, assigned_at)
    VALUES (p_booking_id, room_entry.key::bigint, jsonb_array_length(room_entry.value), now())
    RETURNING * INTO room_assignment;

    INSERT INTO public.booking_beds
      (booking_id, booking_room_id, bed_id, check_in, check_out, assigned_at)
    SELECT p_booking_id, room_assignment.booking_room_id, value::bigint,
      proposed.check_in, proposed.check_out, now()
    FROM jsonb_array_elements_text(room_entry.value);
  END LOOP;
  -- No exception handler: any failure rolls back every write in this call.
  RETURN to_jsonb(proposed);
END;
$$;

COMMENT ON FUNCTION public.update_booking_with_assignments(bigint, jsonb, jsonb)
IS 'Atomically updates a booking and its allocations, preserving all previous data on failure. Uses caller permissions and RLS.';
