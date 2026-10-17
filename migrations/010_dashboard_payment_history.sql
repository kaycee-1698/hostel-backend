-- Adds dated changes to the booking payment total. Existing balances remain unchanged.
-- Opening totals have no date: never invent dates for historical receipts.
BEGIN;
CREATE TABLE public.booking_payment_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 booking_id bigint REFERENCES public.bookings(booking_id) ON DELETE SET NULL,
 amount numeric NOT NULL,
 received_at timestamptz,
 event_kind text NOT NULL CHECK(event_kind IN ('opening','payment_change')),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_payment_events_date_idx ON public.booking_payment_events(received_at);
ALTER TABLE public.booking_payment_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.booking_payment_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.booking_payment_events_event_id_seq TO service_role;
LOCK TABLE public.bookings IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.booking_payment_events(booking_id,amount,event_kind)
SELECT booking_id,payment_received,'opening' FROM public.bookings WHERE coalesce(payment_received,0)<>0;
CREATE FUNCTION public.record_booking_payment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE change_amount numeric;
BEGIN
 IF TG_OP='INSERT' THEN change_amount:=coalesce(NEW.payment_received,0);
 ELSE change_amount:=coalesce(NEW.payment_received,0)-coalesce(OLD.payment_received,0); END IF;
 IF change_amount<>0 THEN
  INSERT INTO public.booking_payment_events(booking_id,amount,received_at,event_kind)
  VALUES(NEW.booking_id,change_amount,now(),'payment_change');
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER booking_payment_history AFTER INSERT OR UPDATE OF payment_received ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.record_booking_payment_change();
COMMIT;
