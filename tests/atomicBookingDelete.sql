-- Run only in an empty disposable database. All fixtures roll back.
BEGIN;
CREATE TABLE public.bookings (booking_id bigint PRIMARY KEY);
CREATE TABLE public.guests (guest_id bigint PRIMARY KEY, booking_id bigint REFERENCES public.bookings);
CREATE TABLE public.booking_rooms (booking_room_id bigint PRIMARY KEY, booking_id bigint REFERENCES public.bookings);
CREATE TABLE public.booking_beds (booking_bed_id bigint PRIMARY KEY, booking_id bigint REFERENCES public.bookings, booking_room_id bigint REFERENCES public.booking_rooms);
\ir ../migrations/003_atomic_booking_delete.sql
INSERT INTO public.bookings VALUES (1), (2), (3);
INSERT INTO public.booking_rooms VALUES (1,1), (2,2), (3,3);
INSERT INTO public.booking_beds VALUES (1,1,1), (2,2,2), (3,3,3);
INSERT INTO public.guests VALUES (1,2);
CREATE TABLE public.other_records (booking_id bigint REFERENCES public.bookings);
INSERT INTO public.other_records VALUES (3);
DO $$
BEGIN
  PERFORM public.delete_booking_with_assignments(1);
  IF EXISTS (SELECT 1 FROM public.bookings WHERE booking_id=1)
    OR EXISTS (SELECT 1 FROM public.booking_rooms WHERE booking_id=1)
    OR EXISTS (SELECT 1 FROM public.booking_beds WHERE booking_id=1) THEN RAISE EXCEPTION 'Delete failed'; END IF;
  PERFORM public.delete_booking_with_assignments(1);
  BEGIN
    PERFORM public.delete_booking_with_assignments(2);
    RAISE EXCEPTION 'Guest protection failed' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.booking_beds WHERE booking_id=2) THEN RAISE EXCEPTION 'Guest booking changed'; END IF;
  BEGIN
    PERFORM public.delete_booking_with_assignments(3);
    RAISE EXCEPTION 'Expected constraint failure';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.booking_beds WHERE booking_id=3)
    OR NOT EXISTS (SELECT 1 FROM public.booking_rooms WHERE booking_id=3) THEN RAISE EXCEPTION 'Rollback failed'; END IF;
END;
$$;
ROLLBACK;
