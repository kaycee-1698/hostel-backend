-- Requires 004. Creates request receipts; existing bookings are unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.booking_creation_requests (
  request_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  booking_id bigint REFERENCES public.bookings(booking_id) ON DELETE SET NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_creation_requests ENABLE ROW LEVEL SECURITY;
-- Only the trusted backend service role should create/retrieve these receipts.
GRANT SELECT,INSERT,UPDATE ON public.booking_creation_requests TO service_role;
CREATE OR REPLACE FUNCTION public.create_booking_once(p_request_id uuid,p_booking jsonb,p_guests_per_room jsonb,p_preferred_bed_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE receipt public.booking_creation_requests%ROWTYPE; payload jsonb; saved jsonb;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A request ID is required'; END IF;
  LOCK TABLE public.bookings,public.booking_rooms,public.booking_beds,public.rooms,public.beds IN SHARE ROW EXCLUSIVE MODE;
  payload := jsonb_build_object('booking',p_booking,'rooms',p_guests_per_room,'bed',p_preferred_bed_id);
  SELECT * INTO receipt FROM public.booking_creation_requests WHERE request_id=p_request_id;
  IF FOUND THEN
    IF receipt.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'This request ID was already used for different booking details'; END IF;
    IF receipt.booking_id IS NULL THEN RAISE EXCEPTION 'This booking was already created and later deleted. Start a new booking.'; END IF;
    RETURN receipt.response;
  END IF;
  saved := public.create_booking_with_assignments(p_booking,p_guests_per_room,p_preferred_bed_id);
  INSERT INTO public.booking_creation_requests(request_id,payload,booking_id,response)
  VALUES(p_request_id,payload,(saved->>'booking_id')::bigint,saved);
  RETURN saved;
END;
$$;
COMMIT;
