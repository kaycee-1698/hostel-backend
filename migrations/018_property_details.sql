-- Property content and public promotional photos. Existing rooms/bookings are unchanged.
BEGIN;
CREATE TABLE public.property_details (
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.property_details(details) VALUES ('{"name":"Unpack Hostel","description":"A friendly hostel in Muthialpet, with shared spaces, a rooftop and hosts who know Pondy. Settle in, head out, or take the afternoon off.","address":"No. 96, Saint Rosario Street, Muthialpet","city":"Puducherry","postcode":"605003","country":"India","phone":"+91 8169791517","email":"unpackhostels@gmail.com","directions":"https://maps.app.goo.gl/b2tjgC1A1HGPNGRL8","checkIn":"13:00","checkOut":"10:00","amenities":["Wi-Fi","Air conditioning","Hot water","Linen included","Rooftop","Lounge","Shared kitchen","Luggage storage","Board games"],"customAmenities":[],"photos":[]}');
ALTER TABLE public.property_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_details FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.property_details TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('property-photos','property-photos',true,5242880,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
CREATE FUNCTION public.save_property_details(p_details jsonb,p_version integer) RETURNS public.property_details
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.property_details;
BEGIN
 SELECT * INTO r FROM public.property_details WHERE id=1 FOR UPDATE;
 IF r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Property changed'; END IF;
 IF jsonb_typeof(p_details->'photos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid photos'; END IF;
 IF jsonb_array_length(p_details->'photos')>12 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_details->'photos') photo
  WHERE NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='property-photos' AND name=photo->>'path')
 ) THEN RAISE EXCEPTION 'Invalid photo'; END IF;
 IF r.details=p_details THEN RETURN r; END IF;
 UPDATE public.property_details SET details=p_details,version=version+1,updated_at=now() WHERE id=1 RETURNING * INTO r;
 RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.save_property_details(jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_property_details(jsonb,integer) TO service_role;
CREATE FUNCTION public.log_property_details() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.details IS DISTINCT FROM NEW.details THEN
  INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,changed_fields,before_values,after_values)
  VALUES('update','property','1','Updated property details',
   ARRAY(SELECT key FROM jsonb_object_keys(OLD.details||NEW.details) AS key WHERE OLD.details->key IS DISTINCT FROM NEW.details->key),OLD.details,NEW.details);
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.log_property_details() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER property_details_log AFTER UPDATE ON public.property_details FOR EACH ROW EXECUTE FUNCTION public.log_property_details();
COMMIT;
