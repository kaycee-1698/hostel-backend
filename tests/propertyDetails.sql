-- Run in an isolated database; not against production.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(bucket_id text,name text);
CREATE TABLE public.activity_logs(action text,entity_type text,entity_id text,summary text,changed_fields text[],before_values jsonb,after_values jsonb);
\ir ../migrations/018_property_details.sql
DO $$
DECLARE original jsonb; changed jsonb; v integer;
BEGIN
 SELECT details INTO original FROM property_details;
 changed=jsonb_set(original,'{description}','"Updated"');
 PERFORM save_property_details(changed,1);
 SELECT version INTO v FROM property_details;
 IF v<>2 OR (SELECT count(*) FROM activity_logs)<>1 THEN RAISE EXCEPTION 'Save/log failed'; END IF;
 BEGIN PERFORM save_property_details(original,1); RAISE EXCEPTION 'Stale write accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN PERFORM save_property_details(jsonb_set(changed,'{photos}','[{"path":"missing","caption":""}]'),2); RAISE EXCEPTION 'Missing photo accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 INSERT INTO storage.objects VALUES('property-photos','property/test.jpg');
 PERFORM save_property_details(jsonb_set(changed,'{photos}','[{"path":"property/test.jpg","caption":"Roof"}]'),2);
 IF (SELECT count(*) FROM activity_logs)<>2 THEN RAISE EXCEPTION 'Photo audit failed'; END IF;
END; $$;
