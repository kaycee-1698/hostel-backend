-- Public room catalogue. Existing rooms remain dormitories; bookings are unchanged.
BEGIN;
ALTER TABLE public.rooms ADD COLUMN room_type text NOT NULL DEFAULT 'dormitory'
 CHECK (room_type IN ('dormitory','private'));
ALTER TABLE public.rooms ADD COLUMN description text NOT NULL DEFAULT '' CHECK (length(description)<=3000);
ALTER TABLE public.rooms ADD COLUMN photo_paths text[] NOT NULL DEFAULT '{}'
 CHECK (cardinality(photo_paths)<=12);
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('room-photos','room-photos',true,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
-- Promotional room photos only. Do not use the private guest-documents bucket.
CREATE FUNCTION public.add_room_photo(p_room_id bigint,p_path text) RETURNS public.rooms
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.rooms;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE room_id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
 IF p_path NOT LIKE p_room_id::text||'/%' OR p_path LIKE '%..%' THEN RAISE EXCEPTION 'Invalid photo'; END IF;
 IF cardinality(r.photo_paths)>=12 THEN RAISE EXCEPTION 'A room can have up to 12 photos'; END IF;
 UPDATE public.rooms SET photo_paths=array_append(photo_paths,p_path) WHERE room_id=p_room_id RETURNING * INTO r;
 RETURN r;
END; $$;
CREATE FUNCTION public.save_room_photos(p_room_id bigint,p_expected text[],p_paths text[]) RETURNS public.rooms
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.rooms;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE room_id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
 IF r.photo_paths IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Photos changed. Reload the room before saving.'; END IF;
 IF p_paths IS NULL OR cardinality(p_paths)>12 OR array_position(p_paths,NULL) IS NOT NULL
  OR NOT p_paths <@ r.photo_paths OR cardinality(p_paths)<>(SELECT count(DISTINCT p) FROM unnest(p_paths) p)
 THEN RAISE EXCEPTION 'Invalid photo selection'; END IF;
 UPDATE public.rooms SET photo_paths=p_paths WHERE room_id=p_room_id RETURNING * INTO r;
 RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.add_room_photo(bigint,text),public.save_room_photos(bigint,text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_room_photo(bigint,text),public.save_room_photos(bigint,text[],text[]) TO service_role;
-- Existing room trigger records changed field names. Add the new values in a separate focused entry.
CREATE FUNCTION public.log_room_catalogue_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (OLD.room_type,OLD.description,OLD.photo_paths) IS DISTINCT FROM (NEW.room_type,NEW.description,NEW.photo_paths) THEN
  INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,changed_fields,before_values,after_values)
  VALUES('update','room',NEW.room_id::text,'Updated room listing · '||NEW.room_name,
   ARRAY(SELECT field FROM (VALUES ('room_type',to_jsonb(OLD.room_type),to_jsonb(NEW.room_type)),('description',to_jsonb(OLD.description),to_jsonb(NEW.description)),('photo_paths',to_jsonb(OLD.photo_paths),to_jsonb(NEW.photo_paths))) t(field,a,b) WHERE a IS DISTINCT FROM b),
   jsonb_build_object('room_type',OLD.room_type,'description',OLD.description,'photo_paths',OLD.photo_paths),
   jsonb_build_object('room_type',NEW.room_type,'description',NEW.description,'photo_paths',NEW.photo_paths));
 END IF; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.log_room_catalogue_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER room_catalogue_log AFTER UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.log_room_catalogue_change();
-- Private rooms cannot be occupied by different bookings at the same time.
-- Deferred checking permits atomic bed exchanges; existing bookings are not rewritten.
CREATE FUNCTION public.check_private_room_occupancy() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target_room bigint;
BEGIN
 SELECT b.room_id INTO target_room FROM public.beds b JOIN public.booking_beds bb ON bb.bed_id=b.bed_id
 WHERE bb.booking_bed_id=NEW.booking_bed_id;
 IF target_room IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.rooms WHERE room_id=target_room FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.rooms WHERE room_id=target_room AND room_type='private') AND EXISTS(
  SELECT 1 FROM public.booking_beds a JOIN public.beds ba ON ba.bed_id=a.bed_id
  JOIN public.booking_beds b ON a.booking_id<>b.booking_id AND a.check_in<b.check_out AND a.check_out>b.check_in
  JOIN public.beds bb ON bb.bed_id=b.bed_id
  WHERE ba.room_id=target_room AND bb.room_id=target_room
 ) THEN RAISE EXCEPTION 'This private room is already occupied for these dates.'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER private_room_occupancy AFTER INSERT OR UPDATE ON public.booking_beds
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_private_room_occupancy();
CREATE FUNCTION public.check_room_type_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.room_type='private' AND OLD.room_type IS DISTINCT FROM NEW.room_type AND EXISTS(
  SELECT 1 FROM public.booking_beds a JOIN public.beds ba ON ba.bed_id=a.bed_id
  JOIN public.booking_beds b ON a.booking_id<>b.booking_id AND a.check_in<b.check_out AND a.check_out>b.check_in
  JOIN public.beds bb ON bb.bed_id=b.bed_id WHERE ba.room_id=NEW.room_id AND bb.room_id=NEW.room_id
 ) THEN RAISE EXCEPTION 'This room has overlapping bookings. Keep it as a dormitory until they are resolved.'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER validate_room_type BEFORE UPDATE OF room_type ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.check_room_type_change();
REVOKE ALL ON FUNCTION public.check_private_room_occupancy(),public.check_room_type_change() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_private_room_occupancy(),public.check_room_type_change() TO service_role;
COMMIT;
