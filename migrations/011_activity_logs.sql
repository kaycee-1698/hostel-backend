-- Apply in Supabase SQL Editor. Starts recording future changes; retains all history.
BEGIN;
CREATE TABLE public.activity_logs (
 log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id text,
 actor_name text NOT NULL DEFAULT 'Admin',
 actor_role text NOT NULL DEFAULT 'Admin',
 action text NOT NULL CHECK(action IN ('create','update','delete','assign','reassign','unassign','rate_change')),
 entity_type text NOT NULL,
 entity_id text NOT NULL,
 summary text NOT NULL,
 changed_fields text[] NOT NULL DEFAULT '{}',
 before_values jsonb,
 after_values jsonb
);
CREATE INDEX activity_logs_time_idx ON public.activity_logs(occurred_at DESC,log_id DESC);
CREATE INDEX activity_logs_entity_time_idx ON public.activity_logs(entity_type,occurred_at DESC,log_id DESC);
CREATE INDEX activity_logs_action_time_idx ON public.activity_logs(action,occurred_at DESC,log_id DESC);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_logs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.activity_logs TO service_role;
REVOKE ALL ON SEQUENCE public.activity_logs_log_id_seq FROM PUBLIC,anon,authenticated,service_role;

-- Controlled trigger writes only. No public RPC or API for changing audit history.
CREATE FUNCTION public.record_activity_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 old_row jsonb; new_row jsonb; row_data jsonb;
 before_safe jsonb; after_safe jsonb; fields text[]; changed text[];
 entity text:=TG_ARGV[0]; id_key text:=TG_ARGV[1]; record_id text;
 verb text; description text; display_name text; room_name text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' AND old_row=new_row THEN RETURN NEW; END IF;
 row_data:=coalesce(new_row,old_row);
 record_id:=coalesce(row_data->>id_key,'unknown');
 fields:=CASE entity
  WHEN 'booking' THEN ARRAY['booking_id','booking_name','ota_name','number_of_adults','check_in','check_out','base_amount','payment_received','pending_amount','gst','commission','bank']
  WHEN 'room' THEN ARRAY['room_id','room_name','capacity','base_rate']
  WHEN 'bed' THEN ARRAY['bed_id','room_id','bed_name','status']
  WHEN 'bed_assignment' THEN ARRAY['booking_bed_id','booking_id','booking_room_id','bed_id','check_in','check_out']
  WHEN 'room_assignment' THEN ARRAY['booking_room_id','booking_id','room_id']
  WHEN 'rate' THEN ARRAY['room_id','stay_date','rate']
  WHEN 'payment' THEN ARRAY['payment_id','booking_id','guest_id','payment_date','amount_paid','mode']
  WHEN 'guest' THEN ARRAY['guest_id','booking_id']
  WHEN 'document' THEN ARRAY['image_id','guest_id','image_type'] END;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO before_safe FROM jsonb_each(coalesce(old_row,'{}')) WHERE key=ANY(fields);
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO after_safe FROM jsonb_each(coalesce(new_row,'{}')) WHERE key=ANY(fields);
 SELECT coalesce(array_agg(key ORDER BY key),'{}') INTO changed
 FROM (SELECT jsonb_object_keys(coalesce(old_row,'{}')||coalesce(new_row,'{}')) AS key) keys
 WHERE old_row->key IS DISTINCT FROM new_row->key;
 verb:=CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
 display_name:=coalesce(row_data->>'booking_name',row_data->>'room_name',row_data->>'bed_name');
 IF entity IN ('bed_assignment','room_assignment') THEN
  verb:=CASE TG_OP WHEN 'INSERT' THEN 'assign' WHEN 'DELETE' THEN 'unassign' ELSE 'reassign' END;
  SELECT b.booking_name INTO display_name FROM public.bookings b WHERE b.booking_id=(row_data->>'booking_id')::bigint;
  description:=CASE verb WHEN 'assign' THEN 'Assigned ' WHEN 'unassign' THEN 'Removed ' ELSE 'Changed ' END
   ||CASE entity WHEN 'bed_assignment' THEN 'bed assignment' ELSE 'room assignment' END
   ||' for booking #'||coalesce(row_data->>'booking_id','unknown')||coalesce(' · '||display_name,'');
 ELSIF entity='rate' THEN
  verb:='rate_change';record_id:=record_id||'/'||(row_data->>'stay_date');
  SELECT r.room_name INTO room_name FROM public.rooms r WHERE r.room_id=(row_data->>'room_id')::bigint;
  description:=CASE TG_OP WHEN 'DELETE' THEN 'Restored base rate' ELSE 'Changed nightly rate' END
   ||' · '||coalesce(room_name,'Room #'||(row_data->>'room_id'))||' · '||(row_data->>'stay_date')
   ||CASE TG_OP WHEN 'DELETE' THEN '' ELSE ' · ₹'||(row_data->>'rate') END;

 ELSE
  description:=CASE verb WHEN 'create' THEN 'Created ' WHEN 'update' THEN 'Updated ' ELSE 'Deleted ' END
   ||entity||' #'||record_id||coalesce(' · '||display_name,'');
 END IF;
 INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,changed_fields,before_values,after_values)
 VALUES(verb,entity,record_id,description,changed,CASE WHEN old_row IS NULL THEN NULL ELSE before_safe END,CASE WHEN new_row IS NULL THEN NULL ELSE after_safe END);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_activity_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER activity_bookings AFTER INSERT OR UPDATE OR DELETE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('booking','booking_id');
CREATE TRIGGER activity_rooms AFTER INSERT OR UPDATE OR DELETE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('room','room_id');
CREATE TRIGGER activity_beds AFTER INSERT OR UPDATE OR DELETE ON public.beds FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('bed','bed_id');
CREATE TRIGGER activity_booking_beds AFTER INSERT OR UPDATE OR DELETE ON public.booking_beds FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('bed_assignment','booking_bed_id');
CREATE TRIGGER activity_booking_rooms AFTER INSERT OR UPDATE OR DELETE ON public.booking_rooms FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('room_assignment','booking_room_id');
CREATE TRIGGER activity_rates AFTER INSERT OR UPDATE OR DELETE ON public.room_daily_rates FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('rate','room_id');
CREATE TRIGGER activity_guests AFTER INSERT OR UPDATE OR DELETE ON public.guests FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('guest','guest_id');
CREATE TRIGGER activity_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('payment','payment_id');
CREATE TRIGGER activity_images AFTER INSERT OR UPDATE OR DELETE ON public.images FOR EACH ROW EXECUTE FUNCTION public.record_activity_change('document','image_id');
COMMIT;
