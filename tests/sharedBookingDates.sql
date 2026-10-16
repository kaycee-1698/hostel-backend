-- Run ONLY against an empty, disposable PostgreSQL database:
-- psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/atomicBookingUpdate.sql
-- Plain CREATE TABLE deliberately fails if application tables already exist.

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
CREATE ROLE service_role;
\ir ../migrations/006_shared_booking_dates_and_swaps.sql
\ir ../migrations/007_idempotent_booking_creation.sql
INSERT INTO rooms VALUES (1),(2);
INSERT INTO beds VALUES (1,1),(2,1),(3,2),(4,2);
DO $$
DECLARE a jsonb; b jsonb; aid bigint; bid bigint; original_id bigint;
BEGIN
 a:=create_booking_once('11111111-1111-4111-8111-111111111111','{"booking_name":"A","number_of_adults":1,"check_in":"2026-10-10","check_out":"2026-10-13"}','{"1":1}',1);
 IF create_booking_once('11111111-1111-4111-8111-111111111111','{"booking_name":"A","number_of_adults":1,"check_in":"2026-10-10","check_out":"2026-10-13"}','{"1":1}',1)<>a THEN RAISE EXCEPTION 'Retry changed response'; END IF;
 IF (SELECT count(*) FROM bookings)<>1 THEN RAISE EXCEPTION 'Duplicate created'; END IF;
 BEGIN
  PERFORM create_booking_once('11111111-1111-4111-8111-111111111111','{"booking_name":"Different"}','{"1":1}',1);
  RAISE EXCEPTION 'Expected request mismatch' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 b:=create_booking_with_assignments('{"booking_name":"B","number_of_adults":1,"check_in":"2026-10-11","check_out":"2026-10-14"}','{"2":1}',3);
 SELECT booking_bed_id INTO aid FROM booking_beds WHERE booking_id=(a->>'booking_id')::bigint;
 SELECT booking_bed_id INTO bid FROM booking_beds WHERE booking_id=(b->>'booking_id')::bigint;
 BEGIN
  PERFORM reassign_booking_bed(aid,3,1,'2026-10-10','2026-10-13',bid,'2026-10-11','2026-10-14',false);
  RAISE EXCEPTION 'Expected confirmation' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 PERFORM reassign_booking_bed(aid,3,1,'2026-10-10','2026-10-13',bid,'2026-10-11','2026-10-14',true);
 IF NOT EXISTS(SELECT 1 FROM booking_beds WHERE booking_bed_id=aid AND bed_id=3 AND check_in='2026-10-10' AND check_out='2026-10-13') OR NOT EXISTS(SELECT 1 FROM booking_beds WHERE booking_bed_id=bid AND bed_id=1 AND check_in='2026-10-11' AND check_out='2026-10-14') THEN RAISE EXCEPTION 'Swap corrupted assignment'; END IF;
 PERFORM update_booking_with_assignments((a->>'booking_id')::bigint,'{"check_in":"2026-10-09","check_out":"2026-10-13"}','{"2":1}');
 IF NOT EXISTS(SELECT 1 FROM booking_beds WHERE booking_bed_id=aid AND bed_id=3 AND check_in='2026-10-09') THEN RAISE EXCEPTION 'Edit lost selected bed or ID'; END IF;
 -- A later occupant on B's bed prevents moving A there for its full stay.
 PERFORM create_booking_with_assignments('{"booking_name":"C","number_of_adults":1,"check_in":"2026-10-09","check_out":"2026-10-11"}','{"1":1}',1);
 BEGIN
  PERFORM reassign_booking_bed(aid,1,3,'2026-10-09','2026-10-13',bid,'2026-10-11','2026-10-14',true);
  RAISE EXCEPTION 'Expected full-stay conflict' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 IF (SELECT bed_id FROM booking_beds WHERE booking_bed_id=aid)<>3 OR (SELECT bed_id FROM booking_beds WHERE booking_bed_id=bid)<>1 THEN RAISE EXCEPTION 'Failed swap changed beds'; END IF;
 BEGIN
  PERFORM move_bed_assignment(aid,4,'2026-10-10',3,'2026-10-09','2026-10-13');
  RAISE EXCEPTION 'Expected date rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  UPDATE booking_beds SET check_out='2026-10-15' WHERE booking_bed_id=aid;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'Expected shared-date constraint' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END;
$$;

DO $$
DECLARE saved jsonb; ids bigint[];
BEGIN
 saved:=create_booking_with_assignments('{"booking_name":"Group","number_of_adults":2,"check_in":"2026-11-10","check_out":"2026-11-13"}','{"2":2}',NULL);
 SELECT array_agg(booking_bed_id ORDER BY booking_bed_id) INTO ids FROM booking_beds WHERE booking_id=(saved->>'booking_id')::bigint;
 PERFORM update_booking_with_assignments((saved->>'booking_id')::bigint,'{"check_in":"2026-11-11","check_out":"2026-11-15"}','{"2":2}');
 IF (SELECT count(*) FROM booking_beds WHERE booking_bed_id=ANY(ids) AND check_in='2026-11-11' AND check_out='2026-11-15')<>2 THEN RAISE EXCEPTION 'Whole booking dates did not update together'; END IF;
 BEGIN
  PERFORM create_booking_once('22222222-2222-4222-8222-222222222222','{"booking_name":"Full","number_of_adults":1,"check_in":"2026-11-12","check_out":"2026-11-14"}','{"2":1}',NULL);
  RAISE EXCEPTION 'Expected capacity failure' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 IF EXISTS(SELECT 1 FROM booking_creation_requests WHERE request_id='22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'Failed create left receipt'; END IF;
END;
$$;
