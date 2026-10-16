-- Requires 001 and 004. Apply the entire file as one transaction.
-- Existing assignment dates are aligned with their booking dates ONLY if conflict-free.
BEGIN;
LOCK TABLE public.bookings, public.booking_rooms, public.booking_beds, public.rooms, public.beds IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(DISTINCT a.booking_id::text, ', ') INTO conflicts
  FROM public.booking_beds a JOIN public.bookings ba ON ba.booking_id=a.booking_id
  JOIN public.booking_beds b ON b.bed_id=a.bed_id AND b.booking_bed_id<>a.booking_bed_id
  JOIN public.bookings bb ON bb.booking_id=b.booking_id
  WHERE ba.check_in < bb.check_out AND ba.check_out > bb.check_in;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Shared-date migration stopped: resolve overlapping beds in bookings % before retrying. No changes were made.', conflicts;
  END IF;
END;
$$;
UPDATE public.booking_beds bb SET check_in=b.check_in, check_out=b.check_out
FROM public.bookings b WHERE b.booking_id=bb.booking_id
  AND (bb.check_in IS DISTINCT FROM b.check_in OR bb.check_out IS DISTINCT FROM b.check_out);

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
  allocation_entry record;
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
      ORDER BY EXISTS (SELECT 1 FROM public.booking_beds current_bed
        WHERE current_bed.booking_id = p_booking_id AND current_bed.bed_id = bed.bed_id) DESC,
        bed.bed_id LIMIT requested
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

  -- Preserve assignment IDs and bed choices whenever those beds are still available.
  DELETE FROM public.booking_beds bb WHERE bb.booking_id = p_booking_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(allocations) allocation,
      jsonb_array_elements_text(allocation.value) chosen WHERE chosen.value::bigint = bb.bed_id);
  FOR room_entry IN SELECT key, value FROM jsonb_each(allocations) LOOP
    SELECT * INTO room_assignment FROM public.booking_rooms
      WHERE booking_id = p_booking_id AND room_id = room_entry.key::bigint
      ORDER BY booking_room_id LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.booking_rooms (booking_id, room_id, number_of_guests, assigned_at)
      VALUES (p_booking_id, room_entry.key::bigint, jsonb_array_length(room_entry.value), now())
      RETURNING * INTO room_assignment;
    ELSE
      UPDATE public.booking_rooms SET number_of_guests = jsonb_array_length(room_entry.value)
      WHERE booking_room_id = room_assignment.booking_room_id;
    END IF;
    FOR allocation_entry IN SELECT value::bigint bed_id FROM jsonb_array_elements_text(room_entry.value) LOOP
      UPDATE public.booking_beds SET booking_room_id = room_assignment.booking_room_id,
        check_in = proposed.check_in, check_out = proposed.check_out
      WHERE booking_id = p_booking_id AND bed_id = allocation_entry.bed_id;
      IF NOT FOUND THEN
        INSERT INTO public.booking_beds (booking_id, booking_room_id, bed_id, check_in, check_out, assigned_at)
        VALUES (p_booking_id, room_assignment.booking_room_id, allocation_entry.bed_id, proposed.check_in, proposed.check_out, now());
      END IF;
    END LOOP;
  END LOOP;
  DELETE FROM public.booking_rooms br WHERE booking_id = p_booking_id
    AND NOT EXISTS (SELECT 1 FROM public.booking_beds bb WHERE bb.booking_room_id = br.booking_room_id);
  -- No exception handler: any failure rolls back every write in this call.
  RETURN to_jsonb(proposed);
END;
$$;

COMMENT ON FUNCTION public.update_booking_with_assignments(bigint, jsonb, jsonb)
IS 'Atomically updates a booking and its allocations, preserving all previous data on failure. Uses caller permissions and RLS.';

CREATE OR REPLACE FUNCTION public.reassign_booking_bed(
  p_assignment_id bigint, p_bed_id bigint, p_expected_bed_id bigint,
  p_expected_check_in date, p_expected_check_out date,
  p_swap_assignment_id bigint DEFAULT NULL, p_swap_check_in date DEFAULT NULL,
  p_swap_check_out date DEFAULT NULL, p_confirm_swap boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  source public.booking_beds%ROWTYPE;
  target public.booking_beds%ROWTYPE;
  entry record;
  room_id_target bigint;
  booking_room_target bigint;
BEGIN
  LOCK TABLE public.bookings, public.booking_rooms, public.booking_beds, public.rooms, public.beds IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO source FROM public.booking_beds WHERE booking_bed_id=p_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment no longer exists. Refresh the calendar.'; END IF;
  IF source.bed_id IS DISTINCT FROM p_expected_bed_id OR source.check_in IS DISTINCT FROM p_expected_check_in
    OR source.check_out IS DISTINCT FROM p_expected_check_out THEN RAISE EXCEPTION 'Assignment changed. Refresh and try again.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_id=source.booking_id AND check_in=source.check_in AND check_out=source.check_out) THEN
    RAISE EXCEPTION 'Edit this booking to align all bed dates before moving beds.';
  END IF;
  IF p_bed_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.beds WHERE bed_id=p_bed_id) THEN RAISE EXCEPTION 'Destination bed not found'; END IF;
  IF p_bed_id=source.bed_id THEN RETURN jsonb_build_object('assignment',to_jsonb(source),'swapped',false); END IF;
  IF p_swap_assignment_id IS NOT NULL THEN
    IF p_confirm_swap IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirm the bed exchange before proceeding'; END IF;
    SELECT * INTO target FROM public.booking_beds WHERE booking_bed_id=p_swap_assignment_id;
    IF NOT FOUND OR target.bed_id IS DISTINCT FROM p_bed_id OR target.check_in IS DISTINCT FROM p_swap_check_in
      OR target.check_out IS DISTINCT FROM p_swap_check_out OR target.booking_bed_id=source.booking_bed_id THEN
      RAISE EXCEPTION 'The other assignment changed. Refresh and confirm the exchange again.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_id=target.booking_id AND check_in=target.check_in AND check_out=target.check_out) THEN
      RAISE EXCEPTION 'Edit the other booking to align its bed dates before exchanging beds.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.booking_beds occupied WHERE occupied.bed_id=p_bed_id
    AND occupied.booking_bed_id<>source.booking_bed_id
    AND (p_swap_assignment_id IS NULL OR occupied.booking_bed_id<>p_swap_assignment_id)
    AND occupied.check_in<source.check_out AND occupied.check_out>source.check_in) THEN
    RAISE EXCEPTION 'Destination bed is occupied during this booking. Nothing changed.';
  END IF;
  IF p_swap_assignment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.booking_beds occupied WHERE occupied.bed_id=source.bed_id
    AND occupied.booking_bed_id NOT IN (source.booking_bed_id,target.booking_bed_id)
    AND occupied.check_in<target.check_out AND occupied.check_out>target.check_in) THEN
    RAISE EXCEPTION 'The other booking cannot fit in the original bed for its full stay. Nothing changed.';
  END IF;
  FOR entry IN SELECT source.booking_bed_id id,source.booking_id booking_id,p_bed_id bed_id
    UNION ALL SELECT target.booking_bed_id,target.booking_id,source.bed_id WHERE p_swap_assignment_id IS NOT NULL LOOP
    SELECT room_id INTO room_id_target FROM public.beds WHERE bed_id=entry.bed_id;
    SELECT booking_room_id INTO booking_room_target FROM public.booking_rooms
      WHERE booking_id=entry.booking_id AND room_id=room_id_target ORDER BY booking_room_id LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.booking_rooms (booking_id,room_id,number_of_guests,assigned_at)
      VALUES (entry.booking_id,room_id_target,1,now()) RETURNING booking_room_id INTO booking_room_target;
    END IF;
    UPDATE public.booking_beds SET bed_id=entry.bed_id,booking_room_id=booking_room_target WHERE booking_bed_id=entry.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignment could not be updated'; END IF;
  END LOOP;
  UPDATE public.booking_rooms room SET number_of_guests=(SELECT count(*) FROM public.booking_beds bb WHERE bb.booking_room_id=room.booking_room_id)
    WHERE booking_id IN (source.booking_id,target.booking_id);
  DELETE FROM public.booking_rooms room WHERE booking_id IN (source.booking_id,target.booking_id)
    AND NOT EXISTS (SELECT 1 FROM public.booking_beds bb WHERE bb.booking_room_id=room.booking_room_id);
  RETURN jsonb_build_object('assignment_id',source.booking_bed_id,'swapped',p_swap_assignment_id IS NOT NULL);
END;
$$;

-- Old clients may reassign beds, but cannot change dates via the old move function.
CREATE OR REPLACE FUNCTION public.move_bed_assignment(
  p_assignment_id bigint,p_bed_id bigint,p_check_in date,p_expected_bed_id bigint,
  p_expected_check_in date,p_expected_check_out date
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_check_in IS DISTINCT FROM p_expected_check_in THEN RAISE EXCEPTION 'Change dates through Edit Booking. Dragging only changes beds.'; END IF;
  RETURN public.reassign_booking_bed(p_assignment_id,p_bed_id,p_expected_bed_id,p_expected_check_in,p_expected_check_out);
END;
$$;

-- Check at transaction end so whole-booking edits can update parent and children together.
CREATE OR REPLACE FUNCTION public.enforce_shared_booking_dates() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected bigint;
BEGIN
  affected := NEW.booking_id;
  IF EXISTS (SELECT 1 FROM public.booking_beds bb JOIN public.bookings b USING(booking_id)
    WHERE bb.booking_id=affected AND (bb.check_in IS DISTINCT FROM b.check_in OR bb.check_out IS DISTINCT FROM b.check_out)) THEN
    RAISE EXCEPTION 'All beds must use the booking check-in and check-out dates';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS shared_booking_dates ON public.bookings;
CREATE CONSTRAINT TRIGGER shared_booking_dates AFTER INSERT OR UPDATE ON public.bookings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_shared_booking_dates();
DROP TRIGGER IF EXISTS shared_assignment_dates ON public.booking_beds;
CREATE CONSTRAINT TRIGGER shared_assignment_dates AFTER INSERT OR UPDATE ON public.booking_beds
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_shared_booking_dates();
COMMIT;
