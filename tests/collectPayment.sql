CREATE ROLE service_role BYPASSRLS;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE bookings(booking_id bigint PRIMARY KEY,booking_name text,base_amount numeric,gst numeric,payment_received numeric,pending_amount numeric,payment_status text);
CREATE TABLE rooms(room_id bigint,room_name text);
CREATE TABLE beds(bed_id bigint);
CREATE TABLE booking_rooms(booking_room_id bigint);
CREATE TABLE booking_beds(booking_bed_id bigint);
CREATE TABLE room_daily_rates(room_id bigint);
CREATE TABLE guests(guest_id bigint);
CREATE TABLE payments(payment_id bigint);
CREATE TABLE images(image_id bigint);
\ir ../migrations/010_dashboard_payment_history.sql
\ir ../migrations/011_activity_logs.sql
\ir ../migrations/013_collect_booking_payment.sql
INSERT INTO bookings VALUES(1,'Test',1000,50,100,950,'Part-Payment');
GRANT SELECT ON bookings TO service_role;
SET ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
 result:=collect_booking_payment(1,200.25,'11111111-1111-4111-8111-111111111111');
 IF result->>'payment_received'<>'300.25' OR result->>'pending_amount'<>'749.75' THEN RAISE EXCEPTION 'Wrong balance'; END IF;
 PERFORM collect_booking_payment(1,200.25,'11111111-1111-4111-8111-111111111111');
 IF (SELECT payment_received FROM bookings WHERE booking_id=1)<>300.25 THEN RAISE EXCEPTION 'Retry duplicated payment'; END IF;
 BEGIN
  PERFORM collect_booking_payment(1,201,'11111111-1111-4111-8111-111111111111');
  RAISE EXCEPTION 'Expected idempotency mismatch' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM collect_booking_payment(1,750,'22222222-2222-4222-8222-222222222222');
  RAISE EXCEPTION 'Expected overpayment rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM collect_booking_payment(1,-1,'22222222-2222-4222-8222-222222222222');
  RAISE EXCEPTION 'Expected negative rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 PERFORM collect_booking_payment(1,749.75,'33333333-3333-4333-8333-333333333333');
 IF (SELECT pending_amount FROM bookings WHERE booking_id=1)<>0 OR (SELECT payment_status FROM bookings WHERE booking_id=1)<>'Paid' THEN RAISE EXCEPTION 'Not settled'; END IF;
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='payment')<>2 THEN RAISE EXCEPTION 'Missing/duplicate logs'; END IF;
 IF (SELECT sum(amount) FROM booking_payment_events WHERE booking_id=1)<>1050 THEN RAISE EXCEPTION 'Ledger mismatch'; END IF;
 IF (SELECT base_amount+gst FROM bookings WHERE booking_id=1)<>1050 THEN RAISE EXCEPTION 'Booking repriced'; END IF;
END $$;
