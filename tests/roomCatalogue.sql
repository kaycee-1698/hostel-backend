-- Disposable PostgreSQL database only, never production.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE public.rooms(room_id bigint PRIMARY KEY,room_name text,base_rate numeric,capacity integer);
CREATE TABLE public.beds(bed_id bigint PRIMARY KEY,room_id bigint REFERENCES rooms);
CREATE TABLE public.booking_beds(booking_bed_id bigint PRIMARY KEY,booking_id bigint,bed_id bigint REFERENCES beds,check_in date,check_out date);
CREATE TABLE public.activity_logs(action text,entity_type text,entity_id text,summary text,changed_fields text[],before_values jsonb,after_values jsonb);
INSERT INTO rooms VALUES(1,'Dorm',600,2),(2,'Private',1800,2);
INSERT INTO beds VALUES(1,1),(2,1),(3,2),(4,2);
\ir ../migrations/017_room_catalogue.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM rooms WHERE room_type<>'dormitory') THEN RAISE EXCEPTION 'Existing rooms changed type'; END IF;
 PERFORM add_room_photo(1,'1/a.jpg'); PERFORM add_room_photo(1,'1/b.jpg');
 PERFORM save_room_photos(1,ARRAY['1/a.jpg','1/b.jpg'],ARRAY['1/b.jpg','1/a.jpg']);
 IF (SELECT photo_paths[1] FROM rooms WHERE room_id=1)<>'1/b.jpg' THEN RAISE EXCEPTION 'Photo order not saved'; END IF;
 BEGIN
  PERFORM save_room_photos(1,ARRAY['1/a.jpg','1/b.jpg'],ARRAY['1/a.jpg']);
  RAISE EXCEPTION 'Stale edit accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM save_room_photos(1,ARRAY['1/b.jpg','1/a.jpg'],ARRAY['2/foreign.jpg']);
  RAISE EXCEPTION 'Foreign photo accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM save_room_photos(1,ARRAY['1/b.jpg','1/a.jpg'],ARRAY['1/a.jpg','1/a.jpg']);
  RAISE EXCEPTION 'Duplicate photo accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 PERFORM save_room_photos(1,ARRAY['1/b.jpg','1/a.jpg'],ARRAY['1/a.jpg']);
 IF (SELECT cardinality(photo_paths) FROM rooms WHERE room_id=1)<>1 THEN RAISE EXCEPTION 'Photo removal failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM activity_logs WHERE changed_fields @> ARRAY['photo_paths']) THEN RAISE EXCEPTION 'Photo log missing'; END IF;
 IF has_function_privilege('anon','public.add_room_photo(bigint,text)','EXECUTE') THEN RAISE EXCEPTION 'Public write access'; END IF;
 UPDATE rooms SET room_type='private' WHERE room_id=2;
END $$;
INSERT INTO booking_beds VALUES(1,1,3,'2026-11-01','2026-11-04');
DO $$ BEGIN
 BEGIN
  INSERT INTO booking_beds VALUES(2,2,4,'2026-11-02','2026-11-03');
  SET CONSTRAINTS private_room_occupancy IMMEDIATE;
  RAISE EXCEPTION 'Private room shared' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
-- Checkout day can be reused; multiple beds for the same booking are allowed.
INSERT INTO booking_beds VALUES(3,2,4,'2026-11-04','2026-11-05');
INSERT INTO booking_beds VALUES(4,1,4,'2026-11-01','2026-11-04');
INSERT INTO booking_beds VALUES(5,3,1,'2026-11-01','2026-11-04'),(6,4,2,'2026-11-01','2026-11-04');
DO $$ BEGIN
 BEGIN
  UPDATE rooms SET room_type='private' WHERE room_id=1;
  RAISE EXCEPTION 'Overlapping dorm converted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
