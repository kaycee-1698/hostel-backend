-- Requires 011. Adds a separate extras ledger; does not alter booking balances.
BEGIN;
CREATE TABLE public.extra_items (
 item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 category text NOT NULL CHECK(category IN ('Product','Service','Fee','Event')),
 price numeric(12,2) CHECK(price>=0 AND price<=1000000),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX extra_items_name_unique ON public.extra_items(lower(trim(name)));
CREATE TABLE public.extra_sales (
 sale_id uuid PRIMARY KEY,
 item_id bigint NOT NULL REFERENCES public.extra_items,
 item_name text NOT NULL, category text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 unit_price numeric(12,2) NOT NULL CHECK(unit_price>=0 AND unit_price<=1000000),
 total numeric(14,2) NOT NULL CHECK(total>=0 AND total<=10000000),
 paid_on date NOT NULL,
 payment_method text NOT NULL CHECK(payment_method IN ('Cash','UPI','Card','Bank transfer','Other')),
 booking_id bigint, booking_name text,
 notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Recorded' CHECK(status IN ('Recorded','Voided')),
 void_reason text, voided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 request_payload jsonb NOT NULL
);
CREATE INDEX extra_sales_date_idx ON public.extra_sales(paid_on DESC,created_at DESC,sale_id);
CREATE INDEX extra_sales_item_date_idx ON public.extra_sales(item_id,paid_on DESC);
ALTER TABLE public.extra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extra_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extra_items,public.extra_sales FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.extra_items TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.extra_items_item_id_seq TO service_role;
GRANT SELECT ON public.extra_sales TO service_role;

-- User-supplied initial prices. Other categories remain unpriced until configured.
INSERT INTO public.extra_items(name,category,price) VALUES
 ('Towel','Service',50),('Dental kit','Product',30),('Shampoo','Product',20),
 ('Conditioner','Product',20),('Body wash','Product',20),('Lock','Product',80),
 ('Early check-in','Service',200),('Laundry','Service',350),
 ('Merchandise','Product',NULL),('Fine','Fee',NULL),('Event','Event',NULL);

CREATE FUNCTION public.record_extra_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE before_data jsonb; after_data jsonb; description text; kind text; record_id text; changed text[];
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='extra_items' THEN
  kind:='extra_item';record_id:=NEW.item_id::text;
  after_data:=jsonb_build_object('name',NEW.name,'category',NEW.category,'price',NEW.price,'active',NEW.active);
  IF TG_OP='UPDATE' THEN before_data:=jsonb_build_object('name',OLD.name,'category',OLD.category,'price',OLD.price,'active',OLD.active); END IF;
  description:=CASE TG_OP WHEN 'INSERT' THEN 'Created extra item · ' ELSE 'Updated extra item · ' END||NEW.name;
 ELSE
  kind:='extra_sale';record_id:=NEW.sale_id::text;
  after_data:=jsonb_build_object('item',NEW.item_name,'quantity',NEW.quantity,'unit_price',NEW.unit_price,'total',NEW.total,'paid_on',NEW.paid_on,'payment_method',NEW.payment_method,'booking_id',NEW.booking_id,'status',NEW.status);
  IF TG_OP='UPDATE' THEN before_data:=after_data||jsonb_build_object('status',OLD.status); END IF;
  description:=CASE TG_OP WHEN 'INSERT' THEN 'Recorded extras payment · ' ELSE 'Voided extras payment · ' END||NEW.item_name||' × '||NEW.quantity||' · ₹'||NEW.total;
 END IF;
 SELECT array_agg(key ORDER BY key) INTO changed FROM jsonb_object_keys(after_data) keys(key) WHERE before_data->key IS DISTINCT FROM after_data->key;
 INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,before_values,after_values,changed_fields)
 VALUES(CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,kind,record_id,description,before_data,after_data,coalesce(changed,'{}'));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_extra_activity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER extra_item_activity AFTER INSERT OR UPDATE ON public.extra_items FOR EACH ROW EXECUTE FUNCTION public.record_extra_activity();
CREATE TRIGGER extra_sale_activity AFTER INSERT OR UPDATE ON public.extra_sales FOR EACH ROW EXECUTE FUNCTION public.record_extra_activity();

CREATE FUNCTION public.record_extra_sale(p_request_id uuid,p_item_id bigint,p_quantity integer,p_unit_price numeric,p_paid_on date,p_method text,p_booking_id bigint DEFAULT NULL,p_notes text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item public.extra_items%ROWTYPE; sale public.extra_sales%ROWTYPE; payload jsonb; guest_booking_name text;
BEGIN
 IF p_request_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000
  OR p_unit_price IS NULL OR p_unit_price::text IN ('NaN','Infinity','-Infinity') OR p_unit_price<0 OR p_unit_price>1000000 OR trunc(p_unit_price,2)<>p_unit_price
  OR p_quantity*p_unit_price>10000000 OR p_paid_on IS NULL OR p_paid_on<date '2000-01-01' OR p_paid_on>(now() AT TIME ZONE 'Asia/Kolkata')::date
  OR p_method IS NULL OR p_method NOT IN ('Cash','UPI','Card','Bank transfer','Other') OR length(coalesce(p_notes,''))>500 THEN
  RAISE EXCEPTION 'Check the item, quantity, price, payment date and method.';
 END IF;
 payload:=jsonb_build_object('item_id',p_item_id,'quantity',p_quantity,'unit_price',p_unit_price,'paid_on',p_paid_on,'method',p_method,'booking_id',p_booking_id,'notes',coalesce(p_notes,''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO sale FROM public.extra_sales WHERE sale_id=p_request_id;
 IF FOUND THEN
  IF sale.request_payload<>payload THEN RAISE EXCEPTION 'This payment request has already been used. Close and reopen the form.'; END IF;
  RETURN to_jsonb(sale)-'request_payload';
 END IF;
 SELECT * INTO item FROM public.extra_items WHERE item_id=p_item_id FOR SHARE;
 IF NOT FOUND OR NOT item.active OR item.price IS NULL THEN RAISE EXCEPTION 'Choose an active item with a configured price.'; END IF;
 IF p_booking_id IS NOT NULL THEN
  SELECT booking_name INTO guest_booking_name FROM public.bookings WHERE booking_id=p_booking_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected booking no longer exists.'; END IF;
 END IF;
 INSERT INTO public.extra_sales(sale_id,item_id,item_name,category,quantity,unit_price,total,paid_on,payment_method,booking_id,booking_name,notes,request_payload)
 VALUES(p_request_id,item.item_id,item.name,item.category,p_quantity,p_unit_price,p_quantity*p_unit_price,p_paid_on,p_method,p_booking_id,guest_booking_name,coalesce(p_notes,''),payload)
 RETURNING * INTO sale;
 RETURN to_jsonb(sale)-'request_payload';
END $$;
CREATE FUNCTION public.void_extra_sale(p_sale_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sale public.extra_sales%ROWTYPE;
BEGIN
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Enter a reason for voiding this entry.'; END IF;
 SELECT * INTO sale FROM public.extra_sales WHERE sale_id=p_sale_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment entry not found.'; END IF;
 IF sale.status='Recorded' THEN
  UPDATE public.extra_sales SET status='Voided',void_reason=trim(p_reason),voided_at=now() WHERE sale_id=p_sale_id RETURNING * INTO sale;
 END IF;
 RETURN to_jsonb(sale)-'request_payload';
END $$;
CREATE FUNCTION public.list_extra_sales(p_start date DEFAULT NULL,p_end date DEFAULT NULL,p_item_id bigint DEFAULT NULL,p_status text DEFAULT NULL,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF p_page IS NULL OR p_page<1 OR p_page>1000000 OR (p_start IS NOT NULL AND p_end IS NOT NULL AND p_end<p_start)
  OR (p_status IS NOT NULL AND p_status NOT IN ('Recorded','Voided')) THEN RAISE EXCEPTION 'Invalid history filters.'; END IF;
 WITH filtered AS MATERIALIZED (
  SELECT * FROM public.extra_sales WHERE (p_start IS NULL OR paid_on>=p_start) AND (p_end IS NULL OR paid_on<=p_end)
   AND (p_item_id IS NULL OR item_id=p_item_id) AND (p_status IS NULL OR status=p_status)
 ), page_rows AS (SELECT * FROM filtered ORDER BY paid_on DESC,created_at DESC,sale_id DESC LIMIT 50 OFFSET (p_page-1)*50)
 SELECT jsonb_build_object('sales',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'request_payload' ORDER BY paid_on DESC,created_at DESC,sale_id DESC),'[]') FROM page_rows r),
  'count',(SELECT count(*) FROM filtered),'total',(SELECT coalesce(sum(total) FILTER(WHERE status='Recorded'),0) FROM filtered),'page',p_page,'pageSize',50) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_extra_sale(uuid,bigint,integer,numeric,date,text,bigint,text),public.void_extra_sale(uuid,text),public.list_extra_sales(date,date,bigint,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_extra_sale(uuid,bigint,integer,numeric,date,text,bigint,text),public.void_extra_sale(uuid,text),public.list_extra_sales(date,date,bigint,text,integer) TO service_role;
COMMIT;
