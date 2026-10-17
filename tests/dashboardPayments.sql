CREATE ROLE service_role;
CREATE TABLE bookings(booking_id bigint PRIMARY KEY,payment_received numeric);
INSERT INTO bookings VALUES(1,100),(2,0);
\ir ../migrations/010_dashboard_payment_history.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM booking_payment_events WHERE booking_id=1 AND amount=100 AND received_at IS NULL) THEN RAISE EXCEPTION 'Missing undated opening'; END IF;
 UPDATE bookings SET payment_received=250 WHERE booking_id=1;
 UPDATE bookings SET payment_received=200 WHERE booking_id=1;
 UPDATE bookings SET payment_received=200 WHERE booking_id=1;
 INSERT INTO bookings VALUES(3,500);
 IF (SELECT sum(amount) FROM booking_payment_events WHERE received_at IS NOT NULL)<>600 THEN RAISE EXCEPTION 'Duplicate or incorrect payment changes'; END IF;
 DELETE FROM bookings WHERE booking_id=3;
 IF (SELECT sum(amount) FROM booking_payment_events WHERE received_at IS NOT NULL)<>600 THEN RAISE EXCEPTION 'Deletion erased financial history'; END IF;
END $$;
