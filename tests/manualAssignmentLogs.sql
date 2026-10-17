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
CREATE ROLE service_role BYPASSRLS;
\ir ../migrations/006_shared_booking_dates_and_swaps.sql
\ir ../migrations/007_idempotent_booking_creation.sql

CREATE ROLE anon;
CREATE ROLE authenticated;
ALTER TABLE rooms ADD COLUMN room_name text DEFAULT 'Dorm';
ALTER TABLE rooms ADD COLUMN base_rate numeric DEFAULT 600;
CREATE TABLE guests(guest_id bigint PRIMARY KEY,booking_id bigint);
CREATE TABLE payments(payment_id bigint PRIMARY KEY,booking_id bigint);
CREATE TABLE images(image_id bigint PRIMARY KEY,guest_id bigint);
CREATE TABLE room_daily_rates(room_id bigint,stay_date date,rate numeric);
\ir ../migrations/003_atomic_booking_delete.sql
\ir ../migrations/011_activity_logs.sql
-- A historical assignment entry must survive migration 012.
INSERT INTO activity_logs(action,entity_type,entity_id,summary) VALUES('assign','bed_assignment','old','Historical entry');
\ir ../migrations/012_manual_assignment_logs.sql
-- Reapplying must not rename the wrappers or change the original implementations.
\ir ../migrations/012_manual_assignment_logs.sql
GRANT SELECT,INSERT,UPDATE,DELETE ON bookings,rooms,beds,booking_rooms,booking_beds,guests,payments,booking_creation_requests TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
SET ROLE service_role;
INSERT INTO rooms(room_id) VALUES(1),(2);
INSERT INTO beds VALUES(1,1),(2,1),(3,2),(4,2);
DO $$
DECLARE a jsonb; b jsonb; aid bigint; bid bigint; before_count integer; room_count integer;
BEGIN
 a:=create_booking_with_assignments('{"booking_name":"A","number_of_adults":1,"check_in":"2026-10-10","check_out":"2026-10-13"}','{"1":1}',1);
 b:=create_booking_with_assignments('{"booking_name":"B","number_of_adults":1,"check_in":"2026-10-10","check_out":"2026-10-13"}','{"2":1}',3);
 IF (SELECT count(*) FROM activity_logs WHERE entity_type IN ('room_assignment','bed_assignment'))<>1 THEN RAISE EXCEPTION 'Automatic creation was logged'; END IF;
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='booking' AND action='create')<>2 THEN RAISE EXCEPTION 'Booking logs lost'; END IF;
 PERFORM update_booking_with_assignments((a->>'booking_id')::bigint,'{"check_in":"2026-10-09"}','{"1":1}');
 IF (SELECT count(*) FROM activity_logs WHERE entity_type IN ('room_assignment','bed_assignment'))<>1 THEN RAISE EXCEPTION 'Automatic date synchronization was logged'; END IF;
 -- Explicit room selection stays visible; automated bed allocation does not.
 PERFORM update_booking_with_assignments((a->>'booking_id')::bigint,'{}','{"2":1}');
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='bed_assignment')<>1 THEN RAISE EXCEPTION 'Automatic bed selection was logged'; END IF;
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='room_assignment')<>2 THEN RAISE EXCEPTION 'Explicit room change missing'; END IF;
 SELECT booking_bed_id INTO aid FROM booking_beds WHERE booking_id=(a->>'booking_id')::bigint;
 SELECT booking_bed_id INTO bid FROM booking_beds WHERE booking_id=(b->>'booking_id')::bigint;
 PERFORM reassign_booking_bed(aid,1,4,'2026-10-09','2026-10-13');
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='bed_assignment' AND action='reassign')<>1 THEN RAISE EXCEPTION 'Manual move suppressed'; END IF;
 -- Both sides of a confirmed swap are logged, then undo is also logged.
 PERFORM reassign_booking_bed(aid,3,1,'2026-10-09','2026-10-13',bid,'2026-10-10','2026-10-13',true);
 PERFORM reassign_booking_bed(aid,1,3,'2026-10-09','2026-10-13',bid,'2026-10-10','2026-10-13',true);
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='bed_assignment' AND action='reassign')<>5 THEN RAISE EXCEPTION 'Swap or undo suppressed'; END IF;
 before_count:=(SELECT count(*) FROM activity_logs WHERE entity_type IN ('room_assignment','bed_assignment'));
 PERFORM delete_booking_with_assignments((b->>'booking_id')::bigint);
 IF (SELECT count(*) FROM activity_logs WHERE entity_type IN ('room_assignment','bed_assignment'))<>before_count THEN RAISE EXCEPTION 'Deletion cleanup was logged'; END IF;
 IF NOT EXISTS(SELECT 1 FROM activity_logs WHERE entity_type='booking' AND action='delete') THEN RAISE EXCEPTION 'Booking deletion missing'; END IF;
 BEGIN
  PERFORM update_booking_with_assignments((a->>'booking_id')::bigint,'{}','{"99":1}');
  RAISE EXCEPTION 'Expected unavailable room' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 -- Direct/manual endpoint writes still work after failed automatic allocation.
 DELETE FROM booking_beds WHERE booking_bed_id=aid;
 IF NOT EXISTS(SELECT 1 FROM activity_logs WHERE entity_type='bed_assignment' AND action='unassign') THEN RAISE EXCEPTION 'Suppression leaked after error'; END IF;
 IF EXISTS(SELECT 1 FROM assignment_log_context) THEN RAISE EXCEPTION 'Context leaked after success or failure'; END IF;
 IF NOT EXISTS(SELECT 1 FROM activity_logs WHERE summary='Historical entry') THEN RAISE EXCEPTION 'Historical log removed'; END IF;
END $$;
