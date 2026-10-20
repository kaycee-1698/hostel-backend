-- Requires 014. Existing sales remain fully paid, with their original prices.
BEGIN;
ALTER TABLE public.extra_items DROP CONSTRAINT extra_items_category_check;
ALTER TABLE public.extra_items ADD CHECK(category IN ('Product','Toiletries','Service','Fee','Event'));
UPDATE public.extra_items SET category='Toiletries' WHERE name IN ('Dental kit','Shampoo','Conditioner','Body wash');
ALTER TABLE public.extra_sales ADD COLUMN lines jsonb NOT NULL DEFAULT '[]', ADD COLUMN paid_amount numeric(14,2), ADD COLUMN customer_name text NOT NULL DEFAULT '';
ALTER TABLE public.extra_sales DISABLE TRIGGER extra_sale_activity;
UPDATE public.extra_sales SET paid_amount=total,lines=jsonb_build_array(jsonb_build_object('item_id',item_id,'name',item_name,'quantity',quantity,'unit_price',unit_price,'total',total));
ALTER TABLE public.extra_sales ENABLE TRIGGER extra_sale_activity;
ALTER TABLE public.extra_sales ALTER COLUMN paid_amount SET DEFAULT 0, ALTER COLUMN paid_amount SET NOT NULL;
ALTER TABLE public.extra_sales ADD CHECK(paid_amount>=0 AND paid_amount<=total);
CREATE TABLE public.extra_collections(request_id uuid PRIMARY KEY,sale_id uuid NOT NULL REFERENCES public.extra_sales,amount numeric(14,2) NOT NULL CHECK(amount>0),method text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.extra_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extra_collections FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.extra_collections TO service_role;

CREATE OR REPLACE FUNCTION public.record_extra_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b jsonb; a jsonb; description text; kind text; rid text; changed text[];
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='extra_items' THEN
  kind:='extra_item';rid:=NEW.item_id::text;
  a:=jsonb_build_object('name',NEW.name,'category',NEW.category,'price',NEW.price,'active',NEW.active);
  IF TG_OP='UPDATE' THEN b:=jsonb_build_object('name',OLD.name,'category',OLD.category,'price',OLD.price,'active',OLD.active); END IF;
  description:=CASE TG_OP WHEN 'INSERT' THEN 'Created extra item · ' ELSE 'Updated extra item · ' END||NEW.name;
 ELSE
  kind:='extra_sale';rid:=NEW.sale_id::text;
  a:=to_jsonb(NEW)-'request_payload'-'notes'-'customer_name';
  IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD)-'request_payload'-'notes'-'customer_name'; END IF;
  description:=CASE WHEN TG_OP='INSERT' THEN 'Created extras sale · ' WHEN NEW.status='Voided' THEN 'Voided extras sale · ' ELSE 'Collected extras payment · ' END||NEW.item_name||' · ₹'||CASE WHEN TG_OP='UPDATE' AND NEW.status<>'Voided' THEN NEW.paid_amount-OLD.paid_amount ELSE NEW.total END;
 END IF;
 SELECT array_agg(key ORDER BY key) INTO changed FROM jsonb_object_keys(a) keys(key) WHERE b->key IS DISTINCT FROM a->key;
 INSERT INTO public.activity_logs(action,entity_type,entity_id,summary,before_values,after_values,changed_fields) VALUES(CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,kind,rid,description,b,a,coalesce(changed,'{}'));
 RETURN NEW;
END $$;
CREATE FUNCTION public.record_extra_order(p_request_id uuid,p_lines jsonb,p_paid boolean,p_date date,p_method text,p_booking_id bigint DEFAULT NULL,p_notes text DEFAULT '',p_customer text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE payload jsonb; sale public.extra_sales%ROWTYPE; item public.extra_items%ROWTYPE; line jsonb; snapshot jsonb:='[]'; qty integer; price numeric; amount numeric:=0; guest text; label text;
BEGIN
 IF p_request_id IS NULL OR p_paid IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose items for this sale.'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 OR p_date IS NULL OR p_date<date '2000-01-01' OR p_date>(now() AT TIME ZONE 'Asia/Kolkata')::date OR p_method IS NULL OR p_method NOT IN ('Cash','UPI','Card','Bank transfer','Other') OR length(coalesce(p_notes,''))>500 OR length(coalesce(p_customer,''))>100 THEN RAISE EXCEPTION 'Check the sale details.'; END IF;
 payload:=jsonb_build_object('lines',p_lines,'paid',p_paid,'date',p_date,'method',p_method,'booking',p_booking_id,'notes',coalesce(p_notes,''),'customer',trim(coalesce(p_customer,'')));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO sale FROM public.extra_sales WHERE sale_id=p_request_id;
 IF FOUND THEN
  IF sale.request_payload<>payload THEN RAISE EXCEPTION 'This request was already used for different details.'; END IF;
  RETURN to_jsonb(sale)-'request_payload';
 END IF;
 IF NOT p_paid AND p_booking_id IS NULL AND trim(coalesce(p_customer,''))='' THEN RAISE EXCEPTION 'Add a customer name or link a booking for an unpaid sale.'; END IF;
 IF p_booking_id IS NOT NULL THEN
  SELECT booking_name INTO guest FROM public.bookings WHERE booking_id=p_booking_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected booking no longer exists.'; END IF;
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY (value->>'item_id')::bigint LOOP
  IF (line->>'quantity')::numeric IS NULL OR (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) THEN RAISE EXCEPTION 'Enter a whole quantity.'; END IF;
  qty:=(line->>'quantity')::integer;price:=(line->>'unit_price')::numeric;
  IF qty NOT BETWEEN 1 AND 1000 OR price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price<0 OR price>1000000 OR price<>trunc(price,2) THEN RAISE EXCEPTION 'Enter valid quantities and prices.'; END IF;
  SELECT * INTO item FROM public.extra_items WHERE item_id=(line->>'item_id')::bigint FOR SHARE;
  IF NOT FOUND OR NOT item.active OR item.price IS NULL THEN RAISE EXCEPTION 'Choose active items with configured prices.'; END IF;
  snapshot:=snapshot||jsonb_build_array(jsonb_build_object('item_id',item.item_id,'name',item.name,'quantity',qty,'unit_price',price,'total',qty*price));
  amount:=amount+qty*price;
 END LOOP;
 IF amount>10000000 THEN RAISE EXCEPTION 'Sale total is too large.'; END IF;
 SELECT string_agg(value->>'name',' + ') INTO label FROM jsonb_array_elements(snapshot);
 INSERT INTO public.extra_sales(sale_id,item_id,item_name,category,quantity,unit_price,total,paid_amount,lines,paid_on,payment_method,booking_id,booking_name,customer_name,notes,request_payload)
 VALUES(p_request_id,(snapshot->0->>'item_id')::bigint,label,CASE WHEN jsonb_array_length(snapshot)>1 THEN 'Multiple items' ELSE item.category END,(snapshot->0->>'quantity')::integer,(snapshot->0->>'unit_price')::numeric,amount,CASE WHEN p_paid THEN amount ELSE 0 END,snapshot,p_date,p_method,p_booking_id,guest,trim(coalesce(p_customer,'')),coalesce(p_notes,''),payload) RETURNING * INTO sale;
 RETURN to_jsonb(sale)-'request_payload';
END $$;
CREATE FUNCTION public.collect_extra_payment(p_request_id uuid,p_sale_id uuid,p_amount numeric,p_method text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.extra_collections%ROWTYPE; sale public.extra_sales%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount>10000000 OR p_amount<>trunc(p_amount,2) OR p_method IS NULL OR p_method NOT IN ('Cash','UPI','Card','Bank transfer','Other') THEN RAISE EXCEPTION 'Enter a valid amount and payment method.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO receipt FROM public.extra_collections WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.sale_id<>p_sale_id OR receipt.amount<>p_amount OR receipt.method<>p_method THEN RAISE EXCEPTION 'This payment request was already used.'; END IF;
  SELECT * INTO sale FROM public.extra_sales WHERE sale_id=p_sale_id;
  RETURN to_jsonb(sale)-'request_payload';
 END IF;
 SELECT * INTO sale FROM public.extra_sales WHERE sale_id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR sale.status='Voided' THEN RAISE EXCEPTION 'This sale is no longer available for collection.'; END IF;
 IF p_amount>sale.total-sale.paid_amount THEN RAISE EXCEPTION 'Amount exceeds the remaining balance. Refresh and try again.'; END IF;
 INSERT INTO public.extra_collections(request_id,sale_id,amount,method) VALUES(p_request_id,p_sale_id,p_amount,p_method);
 UPDATE public.extra_sales SET paid_amount=paid_amount+p_amount,payment_method=p_method WHERE sale_id=p_sale_id RETURNING * INTO sale;
 RETURN to_jsonb(sale)-'request_payload';
END $$;
CREATE OR REPLACE FUNCTION public.list_extra_sales(p_start date DEFAULT NULL,p_end date DEFAULT NULL,p_item_id bigint DEFAULT NULL,p_status text DEFAULT NULL,p_page integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF p_page IS NULL OR p_page<1 OR p_page>1000000 OR (p_start IS NOT NULL AND p_end IS NOT NULL AND p_end<p_start) OR (p_status IS NOT NULL AND p_status NOT IN ('Recorded','Voided','Pending','Paid')) THEN RAISE EXCEPTION 'Invalid history filters.'; END IF;
 WITH filtered AS MATERIALIZED (
 SELECT * FROM public.extra_sales WHERE (p_start IS NULL OR paid_on>=p_start) AND (p_end IS NULL OR paid_on<=p_end)
 AND (p_item_id IS NULL OR item_id=p_item_id OR lines @> jsonb_build_array(jsonb_build_object('item_id',p_item_id)))
 AND (p_status IS NULL OR status=p_status OR (p_status='Pending' AND status='Recorded' AND paid_amount<total) OR (p_status='Paid' AND status='Recorded' AND paid_amount=total))
 ), page_rows AS (SELECT * FROM filtered ORDER BY paid_on DESC,created_at DESC,sale_id DESC LIMIT 50 OFFSET (p_page-1)*50)
 SELECT jsonb_build_object('sales',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'request_payload' ORDER BY paid_on DESC,created_at DESC,sale_id DESC),'[]') FROM page_rows r),'count',(SELECT count(*) FROM filtered),'total',(SELECT coalesce(sum(paid_amount) FILTER(WHERE status='Recorded'),0) FROM filtered),'pending',(SELECT coalesce(sum(total-paid_amount) FILTER(WHERE status='Recorded'),0) FROM filtered),'page',p_page,'pageSize',50) INTO result;
 RETURN result;
END $$;
-- Retain old clients with fully-paid semantics and original retry payloads.
CREATE FUNCTION public.fill_legacy_extra_sale() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF NEW.lines='[]'::jsonb THEN
 NEW.lines:=jsonb_build_array(jsonb_build_object('item_id',NEW.item_id,'name',NEW.item_name,'quantity',NEW.quantity,'unit_price',NEW.unit_price,'total',NEW.total)); NEW.paid_amount:=NEW.total;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER fill_legacy_extra_sale BEFORE INSERT ON public.extra_sales FOR EACH ROW EXECUTE FUNCTION public.fill_legacy_extra_sale();
REVOKE ALL ON FUNCTION public.fill_legacy_extra_sale() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_extra_order(uuid,jsonb,boolean,date,text,bigint,text,text),public.collect_extra_payment(uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_extra_order(uuid,jsonb,boolean,date,text,bigint,text,text),public.collect_extra_payment(uuid,uuid,numeric,text) TO service_role;
COMMIT;
