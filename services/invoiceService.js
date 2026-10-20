const business={name:'Unpack Hostel',legal_name:'Kanak Alliance LLP',gstin:'34ABAFK7934L1Z1',address:'96 Saint Rozario Street\nPuducherry, Puducherry 605003\nIndia',email:'unpackhostels@gmail.com',phone:'+91 8169791517'};
const cents=n=>Math.round(Number(n)*100);
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function calculateInvoice(input){
 const text=(v,max=200)=>typeof v==='string'&&v.length<=max?v.trim():'';
 const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 if(!text(input.customer_name)||!date(input.issue_date)||!date(input.due_date)||input.due_date<input.issue_date||!['split','igst'].includes(input.tax_mode)||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)fail('Enter the customer, invoice dates and at least one item.');
 if(!date(input.check_in)||!date(input.check_out)||input.check_out<=input.check_in)fail('Enter valid check-in and check-out dates.');
 const guests=Number(input.guests);
 if(!Number.isInteger(guests)||guests<1||guests>1000)fail('Enter a whole number of guests between 1 and 1000.');
 const beds=input.stay_beds;
 if(!Array.isArray(beds)||beds.length!==guests||beds.some(b=>!b||!Number.isSafeInteger(b.bed_id)||b.bed_id<1||!text(b.room_name)||!text(b.bed_name))||new Set(beds.map(b=>b.bed_id)).size!==guests)fail('Select a different room / bed for each guest.');
 const counts=new Map();for(const bed of beds)counts.set(bed.room_name,(counts.get(bed.room_name)||0)+1);
 const stayDetails=[...counts].map(([name,n])=>`${n} ${n===1?'bed':'beds'} in ${name}`).join('\n');
 let phone='';
 if(input.customer_phone){const numeric=typeof input.customer_phone==='string'?input.customer_phone.replace(/[\s()-]/g,''):'';if(!/^\+?[0-9]+$/.test(numeric))fail('Phone number must contain numbers only.');phone=numeric;}
 if(input.payment_mode&&!['Cash','UPI','Card','Bank transfer','OTA','Mixed','Other'].includes(input.payment_mode))fail('Choose a valid payment mode.');
 let subtotal=0,tax=0,discount=0;
 const lines=input.lines.map(l=>{
  if(!text(l.description,300)||!Number.isFinite(l.quantity)||l.quantity<=0||l.quantity>10000||!Number.isFinite(l.unit_price)||l.unit_price<0||l.unit_price>10000000||!Number.isFinite(l.tax_rate)||l.tax_rate<0||l.tax_rate>100||!Number.isFinite(l.discount)||l.discount<0||!['inclusive','exclusive'].includes(l.tax_basis))fail('Check item quantities, prices, discounts and tax rates.');
  const gross=cents(l.quantity*l.unit_price),off=(l.kind==='accommodation'||(!l.kind&&/^accommodation/i.test(l.description)))?cents(l.discount):0;
  const net=gross;const base=l.tax_basis==='inclusive'?Math.round(net/(1+l.tax_rate/100)):net;
  const levy=l.tax_basis==='inclusive'?net-base:Math.round(base*l.tax_rate/100);
  if(off>base+levy)fail('Discount cannot exceed the item amount including tax.');
  subtotal+=base;tax+=levy;discount+=off;
  return {description:text(l.description,300),kind:l.kind||(/^accommodation/i.test(l.description)?'accommodation':'extra'),quantity:l.quantity,unit_price:l.unit_price,discount:off/100,tax_rate:l.tax_rate,tax_basis:l.tax_basis,taxable:base/100,tax:levy/100,total:(base+levy-off)/100};
 });
 if(subtotal+tax>1000000000||!Number.isFinite(input.amount_paid)||input.amount_paid<0||input.amount_paid>10000000)fail('Check invoice totals and amount paid.');
 const paid=cents(input.amount_paid),balance=subtotal+tax-discount-paid;
 return {business,discount_basis:'after_tax',...(input.payment_mode?{payment_mode:input.payment_mode}:{}),customer_name:text(input.customer_name),customer_phone:phone,customer_email:text(input.customer_email),customer_address:text(input.customer_address,500),customer_gstin:text(input.customer_gstin,30),issue_date:input.issue_date,due_date:input.due_date,check_in:input.check_in||'',check_out:input.check_out||'',guests:String(guests),stay_beds:beds,stay_details:stayDetails,notes:text(input.notes,1000),tax_mode:input.tax_mode,lines,subtotal:subtotal/100,tax:tax/100,discount:discount/100,total:(subtotal+tax-discount)/100,amount_paid:paid/100,balance_due:Math.max(0,balance)/100,credit:Math.max(0,-balance)/100};
}
function roomStayDetails(assignments){
 const rooms=new Map();
 for(const assignment of assignments){
  const bed=assignment.beds;if(!bed)continue;
  const key=bed.room_id;
  if(!rooms.has(key))rooms.set(key,{name:bed.rooms?.room_name||'Unknown room',beds:new Set()});
  rooms.get(key).beds.add(assignment.bed_id);
 }
 return [...rooms.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(room=>`${room.beds.size} ${room.beds.size===1?'bed':'beds'} in ${room.name}`).join('\n');
}
async function bookingDraft(id){
 const {supabase}=require('../utils/supabase');const {allRows,indiaToday}=require('./dashboardService');
 const {data:b,error}=await supabase.from('bookings').select('*').eq('booking_id',id).single();if(error||!b)fail('Booking not found.');
 const extras=await allRows(()=>supabase.from('extra_sales').select('sale_id,item_name,lines,total,paid_amount').eq('booking_id',id).eq('status','Recorded').order('sale_id'));
 const assignments=await allRows(()=>supabase.from('booking_beds').select('booking_bed_id,bed_id,beds(bed_name,room_id,rooms(room_name))').eq('booking_id',id).order('booking_bed_id'));
 const stayDetails=roomStayDetails(assignments);
 const total=Number(b.base_amount);
 const lines=[{kind:'accommodation',description:'Accommodation',sac:'',quantity:1,unit_price:total,discount:0,tax_rate:5,tax_basis:'exclusive'}];
 for(const sale of extras)for(const l of sale.lines)lines.push({kind:'extra',description:l.name,sac:'',quantity:l.quantity,unit_price:l.unit_price,discount:0,tax_rate:5,tax_basis:'inclusive'});
 return {booking_id:Number(id),customer_name:b.booking_name,customer_phone:b.contact_number||'',customer_email:'',customer_address:'',customer_gstin:'',place_of_supply:'Puducherry',issue_date:indiaToday(),due_date:indiaToday(),check_in:b.check_in,check_out:b.check_out,guests:String(b.number_of_adults),stay_beds:assignments.filter(a=>a.beds).map(a=>({bed_id:a.bed_id,room_name:a.beds.rooms?.room_name||'Unknown room',bed_name:a.beds.bed_name})),stay_details:stayDetails||'No beds assigned',notes:'',tax_mode:'split',lines,amount_paid:Number(b.payment_received||0)+extras.reduce((sum,e)=>sum+Number(e.paid_amount),0),source_balance:Number(b.pending_amount||0)+extras.reduce((sum,e)=>sum+Number(e.total)-Number(e.paid_amount),0)};
}
module.exports={calculateInvoice,bookingDraft,business,roomStayDetails};
