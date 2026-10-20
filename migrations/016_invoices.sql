BEGIN;
CREATE TABLE public.invoices (
 invoice_id uuid PRIMARY KEY,
 invoice_number text NOT NULL UNIQUE,
 booking_id bigint UNIQUE,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE public.invoice_number_seq;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoices TO service_role;
CREATE FUNCTION public.issue_invoice(p_request_id uuid,p_booking_id bigint,p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE invoice public.invoices%ROWTYPE; number text; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; yr integer; serial text;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR coalesce(p_snapshot->>'customer_name','')='' THEN RAISE EXCEPTION 'Check the invoice details.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO invoice FROM public.invoices WHERE invoice_id=p_request_id;
 IF FOUND THEN
 IF invoice.snapshot<>p_snapshot OR invoice.booking_id IS DISTINCT FROM p_booking_id THEN RAISE EXCEPTION 'This invoice request has already been used.'; END IF;
 RETURN to_jsonb(invoice);END IF;
 IF p_booking_id IS NOT NULL THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-booking-'||p_booking_id,0));
 SELECT * INTO invoice FROM public.invoices WHERE booking_id=p_booking_id;
 IF FOUND THEN RETURN to_jsonb(invoice); END IF;
 PERFORM 1 FROM public.bookings WHERE booking_id=p_booking_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking no longer exists.'; END IF;
 END IF;
 yr:=extract(year FROM today)::integer-CASE WHEN extract(month FROM today)<4 THEN 1 ELSE 0 END;
 serial:=nextval('public.invoice_number_seq')::text;
 number:='UH/'||right(yr::text,2)||'-'||right((yr+1)::text,2)||'/'||lpad(serial,greatest(5,length(serial)),'0');
 INSERT INTO public.invoices VALUES(p_request_id,number,p_booking_id,p_snapshot,now()) RETURNING * INTO invoice;
 INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,after_values,changed_fields) VALUES('create','invoice',p_request_id::text,'Issued invoice · '||number,jsonb_build_object('invoice_number',number,'booking_id',p_booking_id,'total',p_snapshot->'total'),ARRAY['invoice_number']);
 RETURN to_jsonb(invoice);
END $$;
REVOKE ALL ON FUNCTION public.issue_invoice(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid,bigint,jsonb) TO service_role;
COMMIT;
