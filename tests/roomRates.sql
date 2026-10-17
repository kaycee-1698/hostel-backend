-- Disposable database only.
CREATE ROLE service_role;
CREATE TABLE rooms(room_id bigint PRIMARY KEY,room_name text);
INSERT INTO rooms VALUES(1,'Dorm A'),(2,'Dorm B');
\ir ../migrations/008_room_rates.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM rooms WHERE base_rate=600)<>2 THEN RAISE EXCEPTION 'Backfill failed'; END IF;
 PERFORM save_room_daily_rates('[{"room_id":1,"date":"2026-10-17","rate":700},{"room_id":2,"date":"2026-10-17","rate":800}]');
 PERFORM save_room_daily_rates('[{"room_id":1,"date":"2026-10-17","rate":750}]');
 IF (SELECT rate FROM room_daily_rates WHERE room_id=1)<>750 OR (SELECT rate FROM room_daily_rates WHERE room_id=2)<>800 THEN RAISE EXCEPTION 'Override failed'; END IF;
 BEGIN
  PERFORM save_room_daily_rates('[{"room_id":1,"date":"2026-10-17","rate":900},{"room_id":99,"date":"2026-10-17","rate":800}]');
  RAISE EXCEPTION 'Expected FK failure' USING ERRCODE='XX000';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF (SELECT rate FROM room_daily_rates WHERE room_id=1)<>750 THEN RAISE EXCEPTION 'Partial write'; END IF;
 BEGIN
  INSERT INTO rooms(room_id,room_name)VALUES(3,'Missing rate');
  RAISE EXCEPTION 'Expected required rate' USING ERRCODE='XX000';
 EXCEPTION WHEN not_null_violation THEN NULL; END;
 INSERT INTO rooms VALUES(3,'New dorm',650);
END $$;
\ir ../migrations/009_restore_base_rates.sql
DO $$ BEGIN
 PERFORM save_room_daily_rates('[{"room_id":1,"date":"2026-10-17","rate":null},{"room_id":2,"date":"2026-10-17","rate":950}]');
 IF EXISTS(SELECT 1 FROM room_daily_rates WHERE room_id=1) THEN RAISE EXCEPTION 'Override not removed'; END IF;
 IF (SELECT base_rate FROM rooms WHERE room_id=1)<>600 THEN RAISE EXCEPTION 'Base changed'; END IF;
 BEGIN
  PERFORM save_room_daily_rates('[{"room_id":2,"date":"2026-10-17","rate":null},{"room_id":99,"date":"2026-10-17","rate":100}]');
  RAISE EXCEPTION 'Expected failure' USING ERRCODE='XX000';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF (SELECT rate FROM room_daily_rates WHERE room_id=2)<>950 THEN RAISE EXCEPTION 'Restore not atomic'; END IF;
END $$;
