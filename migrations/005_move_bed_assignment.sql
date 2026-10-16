-- Installs a function only; existing bookings are unchanged.
CREATE OR REPLACE FUNCTION public.move_bed_assignment(
  p_assignment_id bigint, p_bed_id bigint, p_check_in date,
  p_expected_bed_id bigint, p_expected_check_in date, p_expected_check_out date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  original public.booking_beds%ROWTYPE;
  moved public.booking_beds%ROWTYPE;
  target_room bigint;
  target_booking_room bigint;
  new_checkout date;
BEGIN
  -- Same lock order as creation/reassignment; recheck availability inside the transaction.
  LOCK TABLE public.bookings, public.booking_rooms, public.booking_beds,
    public.rooms, public.beds IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO original FROM public.booking_beds WHERE booking_bed_id = p_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This assignment no longer exists. Refresh the calendar.'; END IF;
  IF p_check_in IS NULL OR p_bed_id IS NULL OR original.check_out <= original.check_in
    OR original.check_in IS NULL OR original.check_out IS NULL THEN
    RAISE EXCEPTION 'A valid bed and stay are required';
  END IF;
  IF original.bed_id IS DISTINCT FROM p_expected_bed_id
    OR original.check_in IS DISTINCT FROM p_expected_check_in
    OR original.check_out IS DISTINCT FROM p_expected_check_out THEN
    RAISE EXCEPTION 'This assignment has changed. Refresh the calendar and try again.';
  END IF;
  SELECT room_id INTO target_room FROM public.beds WHERE bed_id = p_bed_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The destination bed no longer exists'; END IF;
  new_checkout := p_check_in + (original.check_out::date - original.check_in::date);
  IF EXISTS (SELECT 1 FROM public.booking_beds occupied
    WHERE occupied.bed_id = p_bed_id AND occupied.booking_bed_id <> p_assignment_id
      AND occupied.check_in < new_checkout AND occupied.check_out > p_check_in) THEN
    RAISE EXCEPTION 'This bed is occupied during the requested stay. Nothing was moved.';
  END IF;
  SELECT booking_room_id INTO target_booking_room FROM public.booking_rooms
    WHERE booking_id = original.booking_id AND room_id = target_room
    ORDER BY booking_room_id LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.booking_rooms (booking_id, room_id, number_of_guests, assigned_at)
    VALUES (original.booking_id, target_room, 1, now()) RETURNING booking_room_id INTO target_booking_room;
  END IF;
  UPDATE public.booking_beds SET bed_id = p_bed_id, booking_room_id = target_booking_room,
    check_in = p_check_in, check_out = new_checkout
    WHERE booking_bed_id = p_assignment_id RETURNING * INTO moved;
  IF NOT FOUND THEN RAISE EXCEPTION 'The assignment could not be moved'; END IF;
  UPDATE public.booking_rooms room SET number_of_guests = (
    SELECT count(*) FROM public.booking_beds bb WHERE bb.booking_room_id = room.booking_room_id
  ) WHERE booking_room_id IN (original.booking_room_id, target_booking_room);
  DELETE FROM public.booking_rooms room WHERE booking_room_id = original.booking_room_id
    AND NOT EXISTS (SELECT 1 FROM public.booking_beds bb WHERE bb.booking_room_id = room.booking_room_id);
  -- Parent dates represent the whole booking; individual stays and money remain intact.
  UPDATE public.bookings SET check_in = stay.first_day, check_out = stay.last_day,
    number_of_nights = stay.last_day::date - stay.first_day::date
  FROM (SELECT min(check_in) first_day, max(check_out) last_day FROM public.booking_beds
    WHERE booking_id = original.booking_id) stay
  WHERE booking_id = original.booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The booking could not be updated'; END IF;
  RETURN to_jsonb(moved);
END;
$$;
