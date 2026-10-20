CREATE ROLE service_role BYPASSRLS;CREATE ROLE anon;CREATE ROLE authenticated;
CREATE TABLE bookings(booking_id bigint PRIMARY KEY);INSERT INTO bookings VALUES(1);
CREATE TABLE activity_logs(action text,entity_type text,entity_id text,summary text,after_values jsonb,changed_fields text[],actor_name text DEFAULT 'Admin',actor_role text DEFAULT 'Admin');
\ir ../migrations/016_invoices.sql
SET ROLE service_role;
DO $$ DECLARE a jsonb;b jsonb;BEGIN
 a:=issue_invoice('11111111-1111-4111-8111-111111111111',1,'{"customer_name":"Test","total":100}');
 b:=issue_invoice('11111111-1111-4111-8111-111111111111',1,'{"customer_name":"Test","total":100}');
 IF a<>b THEN RAISE EXCEPTION 'Retry duplicated invoice'; END IF;
 b:=issue_invoice('22222222-2222-4222-8222-222222222222',1,'{"customer_name":"Test","total":200}');
 IF a<>b THEN RAISE EXCEPTION 'Booking invoice was overwritten'; END IF;
 b:=issue_invoice('33333333-3333-4333-8333-333333333333',NULL,'{"customer_name":"Manual","total":200}');
 IF a->>'invoice_number'=b->>'invoice_number' THEN RAISE EXCEPTION 'Duplicate number'; END IF;
 BEGIN
 PERFORM issue_invoice('11111111-1111-4111-8111-111111111111',1,'{"customer_name":"Test","total":500}');
 RAISE EXCEPTION 'Expected mismatch rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM invoices)<>2 OR (SELECT count(*) FROM activity_logs)<>2 THEN RAISE EXCEPTION 'Duplicate audit or invoice'; END IF;
 IF (SELECT count(*) FROM activity_logs WHERE action='create' AND entity_type='invoice' AND actor_name='Admin' AND actor_role='Admin' AND summary LIKE 'Issued invoice · UH/%')<>2 THEN RAISE EXCEPTION 'Invoice log metadata missing'; END IF;
 IF EXISTS(SELECT 1 FROM invoices i LEFT JOIN activity_logs l ON l.entity_id=i.invoice_id::text WHERE l.entity_id IS NULL OR l.after_values->>'invoice_number'<>i.invoice_number OR l.after_values->'total'<>i.snapshot->'total') THEN RAISE EXCEPTION 'Invoice log details missing'; END IF;
 IF has_table_privilege('service_role','invoices','UPDATE') OR has_function_privilege('anon','public.issue_invoice(uuid,bigint,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected invoice permissions'; END IF;
END $$;
