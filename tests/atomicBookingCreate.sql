-- Run ONLY against an empty, disposable PostgreSQL database:
-- psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/atomicBookingUpdate.sql
-- Plain CREATE TABLE deliberately fails if application tables already exist.
BEGIN;
CREATE TABLE public.bookings (
  booking_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, booking_name text, ota_name text,
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

\ir ../migrations/004_atomic_booking_create.sql
INSERT INTO public.rooms VALUES (1), (2);
INSERT INTO public.beds VALUES (1,1), (2,1), (3,2);
DO $$
DECLARE saved jsonb; before_count bigint;
BEGIN
  saved := public.create_booking_with_assignments(
    '{"booking_name":"Selected bed", "number_of_adults":1, "check_in":"2026-10-20", "check_out":"2026-10-22"}', '{"1":1}', 2);
  IF NOT EXISTS (SELECT 1 FROM public.booking_beds WHERE booking_id=(saved->>'booking_id')::bigint AND bed_id=2) THEN
    RAISE EXCEPTION 'Selected bed was not assigned';
  END IF;
  SELECT count(*) INTO before_count FROM public.bookings;
  BEGIN
    PERFORM public.create_booking_with_assignments(
      '{"booking_name":"Conflict", "number_of_adults":1, "check_in":"2026-10-21", "check_out":"2026-10-23"}', '{"1":1}', 2);
    RAISE EXCEPTION 'Expected conflict' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.create_booking_with_assignments(
      '{"booking_name":"Too many", "number_of_adults":3, "check_in":"2026-10-21", "check_out":"2026-10-23"}', '{"1":1,"2":2}', NULL);
    RAISE EXCEPTION 'Expected capacity failure' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT count(*) FROM public.bookings) <> before_count THEN RAISE EXCEPTION 'Failed creation left a booking'; END IF;
  IF (SELECT count(*) FROM public.booking_rooms) <> 1 OR (SELECT count(*) FROM public.booking_beds) <> 1 THEN
    RAISE EXCEPTION 'Failed creation left assignments';
  END IF;
  PERFORM public.create_booking_with_assignments(
    '{"booking_name":"Turnover", "number_of_adults":1, "check_in":"2026-10-22", "check_out":"2026-10-23"}', '{"1":1}', 2);
END;
$$;
ROLLBACK;
