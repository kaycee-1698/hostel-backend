-- ONLY for an empty disposable PostgreSQL database, never the live project:
-- psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/guestDocuments.sql
BEGIN;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE public.bookings (booking_id bigint PRIMARY KEY);
CREATE TABLE public.guests (
  guest_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz,
  first_name text, last_name text, birthday date, email text, phone text, city text,
  country text, gender text, travelling_as text, purpose_of_visit text,
  how_heard_about_us text, stayed_before boolean, id_type text, id_number text,
  agree_tnc boolean, agree_checkout boolean, booking_id bigint REFERENCES public.bookings
);
CREATE TABLE public.images (
  image_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guest_id bigint REFERENCES public.guests, image_type text, "imageURL" text
);
\ir ../migrations/002_guest_documents.sql
INSERT INTO public.bookings VALUES (1);
DO $$
DECLARE
  result jsonb;
  failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_guest_with_images('{"first_name":"Rollback","booking_id":1}',
      '[{"image_type":"signature","imageURL":"invalid"}]');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Invalid check-in image reference' THEN RAISE; END IF;
    failed := true;
  END;
  IF NOT failed OR EXISTS (SELECT 1 FROM public.guests) OR EXISTS (SELECT 1 FROM public.images) THEN
    RAISE EXCEPTION 'Failed image insert must roll back the guest';
  END IF;
  result := public.create_guest_with_images('{"first_name":"Saved","booking_id":1}',
    '[{"image_type":"signature","imageURL":"guest-documents/00000000-0000-0000-0000-000000000001/signature.png"}]');
  IF NOT EXISTS (SELECT 1 FROM public.images WHERE guest_id = (result->>'guest_id')::bigint
    AND image_type = 'signature') THEN
    RAISE EXCEPTION 'Image must be linked to the newly created guest';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE public) THEN
    RAISE EXCEPTION 'Guest documents must stay private';
  END IF;
END;
$$;
ROLLBACK;
