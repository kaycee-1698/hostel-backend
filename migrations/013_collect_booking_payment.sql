-- Apply after 010 and 011. Does not change existing booking amounts.
BEGIN;
CREATE TABLE public.booking_payment_requests (
 request_id uuid PRIMARY KEY,
 booking_id bigint NOT NULL,
 amount numeric(12,2) NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_payment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_payment_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.booking_payment_requests TO service_role;
CREATE FUNCTION public.collect_booking_payment(p_booking_id bigint,p_amount numeric,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.bookings%ROWTYPE; receipt public.booking_payment_requests%ROWTYPE; due numeric;
BEGIN
 IF p_booking_id IS NULL OR p_booking_id<=0 OR p_request_id IS NULL OR p_amount IS NULL
  OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount>1000000 OR trunc(p_amount,2)<>p_amount THEN
  RAISE EXCEPTION 'Enter a valid payment amount greater than zero (up to two decimal places).';
 END IF;
 -- Serialize retries of the same request, even if sent for different bookings.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO receipt FROM public.booking_payment_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.booking_id<>p_booking_id OR receipt.amount<>p_amount THEN RAISE EXCEPTION 'This payment request was already used. Reopen the payment window.'; END IF;
  RETURN receipt.response;
 END IF;
 SELECT * INTO saved FROM public.bookings WHERE booking_id=p_booking_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking no longer exists.'; END IF;
 due:=round(coalesce(saved.base_amount,0)+coalesce(saved.gst,0)-coalesce(saved.payment_received,0),2);
 IF due<=0 THEN RAISE EXCEPTION 'This booking has no outstanding balance.'; END IF;
 IF p_amount>due THEN RAISE EXCEPTION 'Payment exceeds the outstanding balance of ₹%. Refresh the balance and try again.',due; END IF;
 UPDATE public.bookings SET payment_received=coalesce(payment_received,0)+p_amount,
  pending_amount=due-p_amount,
  payment_status=CASE WHEN due-p_amount<=5 THEN 'Paid' ELSE 'Part-Payment' END
 WHERE booking_id=p_booking_id RETURNING * INTO saved;
 -- Existing triggers record the changed booking amounts and dated receipt delta.
 INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,before_values,after_values,changed_fields)
 VALUES('create','payment',p_request_id::text,'Collected payment · ₹'||p_amount||' · Booking #'||p_booking_id||' · '||saved.booking_name,
  NULL,jsonb_build_object('booking_id',p_booking_id,'amount_paid',p_amount,'pending_amount',saved.pending_amount),ARRAY['amount_paid','pending_amount']);
 INSERT INTO public.booking_payment_requests(request_id,booking_id,amount,response)
 VALUES(p_request_id,p_booking_id,p_amount,to_jsonb(saved));
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.collect_booking_payment(bigint,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.collect_booking_payment(bigint,numeric,uuid) TO service_role;
COMMIT;
