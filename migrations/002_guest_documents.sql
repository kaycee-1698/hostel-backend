-- Install before deploying guestService.js. Existing guest records are unchanged.
-- IDs and signatures must not be placed in a public bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('guest-documents', 'guest-documents', false, 5242880, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'guest-documents' AND public) THEN
    RAISE EXCEPTION 'guest-documents must be a private bucket';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_guest_with_images(p_guest jsonb, p_images jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  guest_input public.guests%ROWTYPE;
  saved_guest public.guests%ROWTYPE;
  image jsonb;
BEGIN
  IF jsonb_typeof(p_guest) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_images) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid check-in details';
  END IF;
  SELECT * INTO guest_input FROM jsonb_populate_record(NULL::public.guests, p_guest);
  IF coalesce(trim(guest_input.first_name), '') = '' OR guest_input.booking_id IS NULL THEN
    RAISE EXCEPTION 'First name and booking are required';
  END IF;
  PERFORM 1 FROM public.bookings WHERE booking_id = guest_input.booking_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF jsonb_array_length(p_images) > 3 THEN RAISE EXCEPTION 'Too many check-in images'; END IF;
  IF (SELECT count(DISTINCT value->>'image_type') FROM jsonb_array_elements(p_images))
    <> jsonb_array_length(p_images) THEN RAISE EXCEPTION 'Duplicate or missing image types'; END IF;

  INSERT INTO public.guests (created_at, first_name, last_name, birthday, email, phone,
    city, country, gender, travelling_as, purpose_of_visit, how_heard_about_us,
    stayed_before, id_type, id_number, agree_tnc, agree_checkout, booking_id)
  VALUES (now(), guest_input.first_name, guest_input.last_name, guest_input.birthday,
    guest_input.email, guest_input.phone, guest_input.city, guest_input.country,
    guest_input.gender, guest_input.travelling_as, guest_input.purpose_of_visit,
    guest_input.how_heard_about_us, guest_input.stayed_before, guest_input.id_type,
    guest_input.id_number, guest_input.agree_tnc, guest_input.agree_checkout, guest_input.booking_id)
  RETURNING * INTO saved_guest;

  FOR image IN SELECT value FROM jsonb_array_elements(p_images) LOOP
    IF coalesce(image->>'image_type', '') NOT IN ('id_front', 'id_back', 'signature')
      OR coalesce(image->>'imageURL', '') !~ '^guest-documents/[0-9a-f-]{36}/(id_front|id_back|signature)\.(png|jpg)$' THEN
      RAISE EXCEPTION 'Invalid check-in image reference';
    END IF;
    INSERT INTO public.images (guest_id, image_type, "imageURL")
    VALUES (saved_guest.guest_id, image->>'image_type', image->>'imageURL');
  END LOOP;
  RETURN to_jsonb(saved_guest);
END;
$$;
