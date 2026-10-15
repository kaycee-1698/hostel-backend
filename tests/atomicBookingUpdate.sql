-- Run ONLY against an empty, disposable PostgreSQL database:
-- psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/atomicBookingUpdate.sql
-- Plain CREATE TABLE deliberately fails if application tables already exist.
BEGIN;
CREATE TABLE public.bookings (
  booking_id bigint PRIMARY KEY, booking_name text, ota_name text,
  number_of_adults integer, contact_number text, check_in date, check_out date,
  number_of_nights integer, base_amount numeric, payment_received numeric,
  commission numeric, gst numeric, pending_amount numeric, payment_status text,
  bank text, other_info text
);
CREATE TABLE public.rooms (room_id bigint PRIMARY KEY);
CREATE TABLE public.beds (bed_id bigint PRIMARY KEY, room_id bigint REFERENCES public.rooms);
CREATE TABLE public.booking_rooms (
  booking_room_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint REFERENCES public.bookings, room_id bigint REFERENCES public.rooms,
  number_of_guests integer, assigned_at timestamptz
);
CREATE TABLE public.booking_beds (
  booking_bed_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint REFERENCES public.bookings,
  booking_room_id bigint REFERENCES public.booking_rooms,
  bed_id bigint REFERENCES public.beds, check_in date, check_out date, assigned_at timestamptz
);
\ir ../migrations/001_atomic_booking_update.sql

INSERT INTO public.rooms VALUES (1), (2), (3);
INSERT INTO public.beds VALUES (1, 1), (2, 2), (3, 3);
INSERT INTO public.bookings (booking_id, booking_name, number_of_adults, check_in, check_out)
VALUES (1, 'Original', 1, '2026-10-20', '2026-10-22'),
       (2, 'Other guest', 1, '2026-10-20', '2026-10-22');
INSERT INTO public.booking_rooms (booking_id, room_id, number_of_guests) VALUES (1, 1, 1), (2, 2, 1);
INSERT INTO public.booking_beds (booking_id, booking_room_id, bed_id, check_in, check_out)
SELECT booking_id, booking_room_id, room_id, '2026-10-20', '2026-10-22' FROM public.booking_rooms;

-- Force a failure AFTER old assignments have been removed and booking updated.
CREATE FUNCTION public.test_reject_bed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bed_id = 3 THEN RAISE EXCEPTION 'Simulated insert failure'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_reject_bed BEFORE INSERT ON public.booking_beds
FOR EACH ROW EXECUTE FUNCTION public.test_reject_bed();

DO $$
DECLARE
  before_booking jsonb;
  before_rooms jsonb;
  before_beds jsonb;
  result jsonb;
  target_room text;
  failed boolean;
BEGIN
  SELECT to_jsonb(b) INTO before_booking FROM public.bookings b WHERE booking_id = 1;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY booking_room_id) INTO before_rooms
    FROM public.booking_rooms r WHERE booking_id = 1;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY booking_bed_id) INTO before_beds
    FROM public.booking_beds b WHERE booking_id = 1;

  FOREACH target_room IN ARRAY ARRAY['2', '3'] LOOP
    failed := false;
    BEGIN
      PERFORM public.update_booking_with_assignments(1,
        '{"booking_name":"Changed","check_out":"2026-10-23"}',
        jsonb_build_object(target_room, 1));
    EXCEPTION WHEN OTHERS THEN
      IF target_room = '2' AND SQLERRM NOT LIKE 'Room 2 does not have%' THEN RAISE; END IF;
      IF target_room = '3' AND SQLERRM <> 'Simulated insert failure' THEN RAISE; END IF;
      failed := true;
    END;
    IF NOT failed THEN RAISE EXCEPTION 'Expected update failure'; END IF;
    IF (SELECT to_jsonb(b) FROM public.bookings b WHERE booking_id = 1) IS DISTINCT FROM before_booking
      OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY booking_room_id) FROM public.booking_rooms r WHERE booking_id = 1) IS DISTINCT FROM before_rooms
      OR (SELECT jsonb_agg(to_jsonb(b) ORDER BY booking_bed_id) FROM public.booking_beds b WHERE booking_id = 1) IS DISTINCT FROM before_beds THEN
      RAISE EXCEPTION 'Failed update changed original booking or assignments';
    END IF;
  END LOOP;

  -- The booking's own occupied bed remains eligible when extending its stay.
  result := public.update_booking_with_assignments(1,
    '{"booking_name":"Extended","check_out":"2026-10-23"}', '{"1":1}');
  IF result->>'booking_name' <> 'Extended' OR (result->>'number_of_nights')::integer <> 3
    OR NOT EXISTS (SELECT 1 FROM public.booking_beds WHERE booking_id = 1
      AND bed_id = 1 AND check_out = '2026-10-23') THEN
    RAISE EXCEPTION 'Successful update did not update booking and assignment together';
  END IF;
END;
$$;
ROLLBACK;
