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

\ir ../migrations/005_move_bed_assignment.sql
INSERT INTO public.rooms VALUES (1), (2);
INSERT INTO public.beds VALUES (1,1), (2,1), (3,2), (4,2);
INSERT INTO public.bookings (booking_id,booking_name,number_of_adults,check_in,check_out,base_amount,payment_received)
VALUES (1,'Group',2,'2026-10-10','2026-10-13',1000,200),(2,'Other',1,'2026-10-20','2026-10-23',100,0);
INSERT INTO public.booking_rooms (booking_id,room_id,number_of_guests) VALUES (1,1,2),(2,2,1);
INSERT INTO public.booking_beds (booking_id,booking_room_id,bed_id,check_in,check_out)
VALUES (1,1,1,'2026-10-10','2026-10-13'),(1,1,2,'2026-10-10','2026-10-13'),(2,2,3,'2026-10-20','2026-10-23');
DO $$
DECLARE before_sibling jsonb; snapshot jsonb; result jsonb;
BEGIN
  SELECT to_jsonb(bb) INTO before_sibling FROM public.booking_beds bb WHERE booking_bed_id=2;
  -- Same-bed overlapping move excludes only the moving assignment.
  PERFORM public.move_bed_assignment(1,1,'2026-10-11',1,'2026-10-10','2026-10-13');
  IF NOT EXISTS (SELECT 1 FROM public.booking_beds WHERE booking_bed_id=1 AND check_out='2026-10-14') THEN
    RAISE EXCEPTION 'Duration changed'; END IF;
  -- Same booking's other assignment must still block a conflicting move.
  SELECT jsonb_agg(to_jsonb(bb)) INTO snapshot FROM public.booking_beds bb;
  BEGIN
    PERFORM public.move_bed_assignment(1,2,'2026-10-11',1,'2026-10-11','2026-10-14');
    RAISE EXCEPTION 'Expected sibling conflict' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.move_bed_assignment(1,3,'2026-10-21',1,'2026-10-11','2026-10-14');
    RAISE EXCEPTION 'Expected other-booking conflict' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.move_bed_assignment(1,4,'2026-10-21',1,'2026-10-10','2026-10-13');
    RAISE EXCEPTION 'Expected stale failure' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF (SELECT jsonb_agg(to_jsonb(bb)) FROM public.booking_beds bb) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Failed moves changed assignments'; END IF;
  -- Checkout boundary is available. Creates a new booking_room for the moved assignment only.
  result := public.move_bed_assignment(1,3,'2026-10-23',1,'2026-10-11','2026-10-14');
  IF result->>'check_out' <> '2026-10-26' THEN RAISE EXCEPTION 'Incorrect end date'; END IF;
  IF (SELECT to_jsonb(bb) FROM public.booking_beds bb WHERE booking_bed_id=2) IS DISTINCT FROM before_sibling THEN RAISE EXCEPTION 'Sibling changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_rooms WHERE booking_id=1 AND room_id=1 AND number_of_guests=1)
    OR NOT EXISTS (SELECT 1 FROM public.booking_rooms WHERE booking_id=1 AND room_id=2 AND number_of_guests=1) THEN RAISE EXCEPTION 'Room counts incorrect'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_id=1 AND check_in='2026-10-10' AND check_out='2026-10-26' AND base_amount=1000 AND payment_received=200) THEN RAISE EXCEPTION 'Booking summary or money incorrect'; END IF;
  -- Moving back removes the now-empty room without affecting the sibling.
  PERFORM public.move_bed_assignment(1,1,'2026-10-10',3,'2026-10-23','2026-10-26');
  IF (SELECT count(*) FROM public.booking_rooms WHERE booking_id=1) <> 1 THEN RAISE EXCEPTION 'Empty room remains'; END IF;
  IF (SELECT number_of_guests FROM public.booking_rooms WHERE booking_id=1) <> 2 THEN RAISE EXCEPTION 'Room count not restored'; END IF;
END;
$$;
ROLLBACK;
