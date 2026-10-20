CREATE ROLE service_role BYPASSRLS;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE bookings(booking_id bigint PRIMARY KEY,booking_name text,pending_amount numeric);
CREATE TABLE activity_logs(log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,action text,entity_type text,entity_id text,summary text,before_values jsonb,after_values jsonb,changed_fields text[]);
INSERT INTO bookings VALUES(1,'Test guest',1000);
\ir ../migrations/014_extras_manager.sql
SET ROLE service_role;
DO $$ DECLARE towel bigint; sale jsonb; result jsonb; BEGIN
 SELECT item_id INTO towel FROM extra_items WHERE name='Towel';
 sale:=record_extra_sale('11111111-1111-4111-8111-111111111111',towel,2,50,current_date,'Cash',1,'test');
 IF sale->>'total'<>'100.00' THEN RAISE EXCEPTION 'Incorrect total'; END IF;
 PERFORM record_extra_sale('11111111-1111-4111-8111-111111111111',towel,2,50,current_date,'Cash',1,'test');
 IF (SELECT count(*) FROM extra_sales)<>1 THEN RAISE EXCEPTION 'Duplicate payment'; END IF;
 UPDATE extra_items SET price=80,name='Towel rental' WHERE item_id=towel;
 IF (SELECT unit_price FROM extra_sales)<>50 OR (SELECT item_name FROM extra_sales)<>'Towel' THEN RAISE EXCEPTION 'Historical sale changed'; END IF;
 BEGIN
  PERFORM record_extra_sale('11111111-1111-4111-8111-111111111111',towel,2,80,current_date,'Cash',1,'test');
  RAISE EXCEPTION 'Expected retry mismatch' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 result:=list_extra_sales(current_date,current_date,NULL,NULL,1);
 IF result->>'total'<>'100.00' OR result->>'count'<>'1' THEN RAISE EXCEPTION 'History totals incorrect'; END IF;
 PERFORM void_extra_sale('11111111-1111-4111-8111-111111111111','Incorrect entry');
 PERFORM void_extra_sale('11111111-1111-4111-8111-111111111111','Retry');
 IF (list_extra_sales()->>'total')::numeric<>0 THEN RAISE EXCEPTION 'Void included in total'; END IF;
 IF (SELECT count(*) FROM extra_sales)<>1 THEN RAISE EXCEPTION 'Void erased history'; END IF;
 UPDATE extra_items SET active=false WHERE item_id=towel;
 BEGIN
  PERFORM record_extra_sale('22222222-2222-4222-8222-222222222222',towel,1,80,current_date,'Cash');
  RAISE EXCEPTION 'Expected inactive item rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT pending_amount FROM bookings WHERE booking_id=1)<>1000 THEN RAISE EXCEPTION 'Accommodation balance changed'; END IF;
 IF (SELECT count(*) FROM activity_logs WHERE entity_type='extra_sale')<>2 THEN RAISE EXCEPTION 'Missing or duplicate sale/void audit'; END IF;
 IF has_table_privilege('service_role','extra_sales','UPDATE') OR has_table_privilege('anon','extra_sales','SELECT') THEN RAISE EXCEPTION 'Unexpected access'; END IF;
END $$;
