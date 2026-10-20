\ir extras.sql
\ir ../migrations/015_extras_orders.sql
SET ROLE service_role;
DO $$ DECLARE sale jsonb; result jsonb; lines jsonb; id uuid:='33333333-3333-4333-8333-333333333333'; BEGIN
 SELECT jsonb_agg(jsonb_build_object('item_id',item_id,'quantity',2,'unit_price',price) ORDER BY item_id) INTO lines FROM extra_items WHERE name IN ('Dental kit','Shampoo');
 sale:=record_extra_order(id,lines,false,current_date,'Cash',1,'','');
 IF (sale->>'total')::numeric<>100 OR (sale->>'paid_amount')::numeric<>0 OR jsonb_array_length(sale->'lines')<>2 THEN RAISE EXCEPTION 'Incorrect unpaid basket'; END IF;
 PERFORM record_extra_order(id,lines,false,current_date,'Cash',1,'','');
 IF (SELECT count(*) FROM extra_sales WHERE sale_id=id)<>1 THEN RAISE EXCEPTION 'Duplicate order'; END IF;
 result:=list_extra_sales(NULL,NULL,NULL,'Pending');
 IF (result->>'pending')::numeric<>100 OR (result->>'count')::int<>1 THEN RAISE EXCEPTION 'Pending summary incorrect'; END IF;
 result:=list_extra_sales(NULL,NULL,(lines->1->>'item_id')::bigint,'Pending');
 IF (result->>'count')::int<>1 THEN RAISE EXCEPTION 'Second item filter failed'; END IF;
 PERFORM collect_extra_payment('44444444-4444-4444-8444-444444444444',id,30,'UPI');
 PERFORM collect_extra_payment('44444444-4444-4444-8444-444444444444',id,30,'UPI');
 IF (SELECT paid_amount FROM extra_sales WHERE sale_id=id)<>30 THEN RAISE EXCEPTION 'Duplicate collection'; END IF;
 BEGIN
 PERFORM collect_extra_payment('55555555-5555-4555-8555-555555555555',id,80,'Cash');
 RAISE EXCEPTION 'Expected overpayment rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 UPDATE extra_items SET price=60 WHERE name='Dental kit';
 IF (SELECT total FROM extra_sales WHERE sale_id=id)<>100 THEN RAISE EXCEPTION 'Reprice changed order'; END IF;
 PERFORM collect_extra_payment('66666666-6666-4666-8666-666666666666',id,70,'Cash');
 IF (list_extra_sales(NULL,NULL,NULL,'Pending')->>'count')::int<>0 THEN RAISE EXCEPTION 'Paid sale remains pending'; END IF;
 IF (list_extra_sales(NULL,NULL,NULL,'Paid')->>'total')::numeric<>100 THEN RAISE EXCEPTION 'Paid total incorrect'; END IF;
 PERFORM void_extra_sale(id,'Test correction');
 IF (list_extra_sales()->>'total')::numeric<>0 THEN RAISE EXCEPTION 'Void counted'; END IF;
 BEGIN
 PERFORM collect_extra_payment('77777777-7777-4777-8777-777777777777',id,1,'Cash');
 RAISE EXCEPTION 'Expected void rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
 PERFORM record_extra_order('88888888-8888-4888-8888-888888888888',lines,false,current_date,'Cash');
 RAISE EXCEPTION 'Expected unidentified debtor rejection' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 sale:=record_extra_order('99999999-9999-4999-8999-999999999999',lines,true,current_date,'Card');
 IF (sale->>'paid_amount')::numeric<>100 THEN RAISE EXCEPTION 'Paid-now basket failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT pending_amount FROM bookings WHERE booking_id=1)<>1000 THEN RAISE EXCEPTION 'Accommodation balance changed'; END IF;
 IF (SELECT count(*) FROM extra_collections)<>2 THEN RAISE EXCEPTION 'Wrong receipt count'; END IF;
 IF (SELECT count(*) FROM activity_logs WHERE summary LIKE 'Collected extras payment%')<>2 THEN RAISE EXCEPTION 'Incorrect collection audit'; END IF;
 IF has_table_privilege('service_role','extra_collections','INSERT') OR has_function_privilege('anon','public.collect_extra_payment(uuid,uuid,numeric,text)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe permissions'; END IF;
END $$;
