const router=require('express').Router();
const {supabase}=require('../utils/supabase');
const {allRows}=require('../services/dashboardService');
const categories=['Product','Toiletries','Service','Fee','Event'];
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const id=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000&&Math.abs(value*100-Math.round(value*100))<1e-7;
const fail=(res,error)=>{const invalid=error.code==='P0001'||error.code==='23505';res.status(invalid?409:503).json({error:error.code==='23505'?'An item with this name already exists.':invalid?error.message:'Could not complete this request. Please retry.'});};
router.get('/extras/items',async(req,res)=>{try{res.set('Cache-Control','no-store').json(await allRows(()=>supabase.from('extra_items').select('*').order('name').order('item_id')));}catch(error){fail(res,error);}});
const saveItem=async(req,res)=>{
 const {name,category,price:amount,active}=req.body;
 if(typeof name!=='string'||!name.trim()||name.trim().length>100||!categories.includes(category)||(amount!==null&&!price(amount))||typeof active!=='boolean'||(req.params.id&&!id(req.params.id)))return res.status(400).json({error:'Enter an item name, category and valid price.'});
 const values={name:name.trim(),category,price:amount,active};
 const query=req.params.id?supabase.from('extra_items').update(values).eq('item_id',Number(req.params.id)):supabase.from('extra_items').insert(values);
 const {data,error}=await query.select().single();if(error)return fail(res,error);res.json(data);
};
router.post('/extras/items',saveItem);router.put('/extras/items/:id',saveItem);
router.get('/extras/sales',async(req,res)=>{
 const {start,end,item,status,page='1'}=req.query;
 const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if((start&&!date(start))||(end&&!date(end))||(start&&end&&start>end)||(item&&!id(item))||(status&&!['Recorded','Voided','Pending','Paid'].includes(status))||!id(page)||Number(page)>1000000)return res.status(400).json({error:'Choose valid history filters.'});
 const {data,error}=await supabase.rpc('list_extra_sales',{p_start:start||null,p_end:end||null,p_item_id:item?Number(item):null,p_status:status||null,p_page:Number(page)});
 if(error)return fail(res,error);res.set('Cache-Control','no-store').json(data);
});
router.post('/extras/sales',async(req,res)=>{
 const b=req.body;
 if(!uuid(b.request_id)||!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>50||b.lines.some(l=>!l||!id(l.item_id)||!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>1000||!price(l.unit_price))||typeof b.paid!=='boolean'||typeof b.paid_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.paid_on)||!['Cash','UPI','Card','Bank transfer','Other'].includes(b.method)||(b.booking_id!=null&&!id(b.booking_id))||typeof b.notes!=='string'||b.notes.length>500||typeof b.customer_name!=='string'||b.customer_name.length>100)return res.status(400).json({error:'Check the sale details.'});
 const {data,error}=await supabase.rpc('record_extra_order',{p_request_id:b.request_id,p_lines:b.lines,p_paid:b.paid,p_date:b.paid_on,p_method:b.method,p_booking_id:b.booking_id??null,p_notes:b.notes,p_customer:b.customer_name});if(error)return fail(res,error);res.json(data);
});
router.post('/extras/sales/:id/collect',async(req,res)=>{
 const b=req.body;if(!uuid(req.params.id)||!uuid(b.request_id)||!(typeof b.amount==='number'&&Number.isFinite(b.amount)&&b.amount>0&&b.amount<=10000000&&Math.abs(b.amount*100-Math.round(b.amount*100))<1e-7)||!['Cash','UPI','Card','Bank transfer','Other'].includes(b.method))return res.status(400).json({error:'Enter a valid amount and payment method.'});
 const {data,error}=await supabase.rpc('collect_extra_payment',{p_request_id:b.request_id,p_sale_id:req.params.id,p_amount:b.amount,p_method:b.method});if(error)return fail(res,error);res.json(data);
});
router.post('/extras/sales/:id/void',async(req,res)=>{if(!uuid(req.params.id)||typeof req.body.reason!=='string'||!req.body.reason.trim()||req.body.reason.length>500)return res.status(400).json({error:'Enter a reason for voiding this entry.'});const {data,error}=await supabase.rpc('void_extra_sale',{p_sale_id:req.params.id,p_reason:req.body.reason});if(error)return fail(res,error);res.json(data);});
module.exports=router;
