-- Requires migration 001. Installs a function; existing rows are unchanged.
CREATE OR REPLACE FUNCTION public.create_booking_with_assignments(
  p_booking jsonb, p_guests_per_room jsonb, p_preferred_bed_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  proposed public.bookings%ROWTYPE;
  saved public.bookings%ROWTYPE;
  preferred_room bigint;
BEGIN
  LOCK TABLE public.bookings, public.booking_rooms, public.booking_beds,
    public.rooms, public.beds IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO proposed FROM jsonb_populate_record(NULL::public.bookings, p_booking);
  IF coalesce(trim(proposed.booking_name), '') = '' OR proposed.number_of_adults IS NULL
    OR proposed.number_of_adults < 1 OR proposed.number_of_adults > 1000 THEN
    RAISE EXCEPTION 'Booking name and a valid guest count are required';
  END IF;
  IF p_preferred_bed_id IS NOT NULL THEN
    SELECT room_id INTO preferred_room FROM public.beds WHERE bed_id = p_preferred_bed_id;
    IF NOT FOUND OR coalesce((p_guests_per_room->>preferred_room::text)::integer, 0) < 1 THEN
      RAISE EXCEPTION 'Keep at least one guest in the selected bed room, or create a booking without a selected bed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.booking_beds WHERE bed_id = p_preferred_bed_id
      AND check_in < proposed.check_out AND check_out > proposed.check_in) THEN
      RAISE EXCEPTION 'The selected bed is unavailable for this stay. Choose another bed or dates';
    END IF;
  END IF;
  INSERT INTO public.bookings (booking_name, ota_name, number_of_adults, contact_number,
    check_in, check_out, number_of_nights, base_amount, payment_received, commission,
    gst, pending_amount, payment_status, bank, other_info)
  VALUES (proposed.booking_name, proposed.ota_name, proposed.number_of_adults, proposed.contact_number,
    proposed.check_in, proposed.check_out, proposed.check_out::date - proposed.check_in::date,
    proposed.base_amount, proposed.payment_received, proposed.commission, proposed.gst,
    proposed.pending_amount, proposed.payment_status, proposed.bank, proposed.other_info)
  RETURNING * INTO saved;
  PERFORM public.update_booking_with_assignments(saved.booking_id, '{}'::jsonb, p_guests_per_room);
  IF p_preferred_bed_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.booking_beds WHERE booking_id = saved.booking_id AND bed_id = p_preferred_bed_id
  ) THEN
    UPDATE public.booking_beds SET bed_id = p_preferred_bed_id
    WHERE booking_bed_id = (
      SELECT bb.booking_bed_id FROM public.booking_beds bb
      JOIN public.booking_rooms br USING (booking_room_id)
      WHERE bb.booking_id = saved.booking_id AND br.room_id = preferred_room
      ORDER BY bb.booking_bed_id LIMIT 1
    );
  END IF;
  RETURN to_jsonb(saved);
END;
$$;
