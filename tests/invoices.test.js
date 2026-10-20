const test=require('node:test'),assert=require('node:assert/strict');
const {calculateInvoice}=require('../services/invoiceService');
const draft=()=>({customer_name:'Example Guest',issue_date:'2026-10-20',due_date:'2026-10-20',tax_mode:'split',check_in:'2026-10-20',check_out:'2026-10-23',guests:'1',stay_beds:[{bed_id:1,room_name:'6 bed mixed dorm',bed_name:'bed-1'}],amount_paid:1000,lines:[{description:'Accommodation',sac:'',quantity:1,unit_price:3000,discount:0,tax_rate:5,tax_basis:'exclusive'},{description:'Dental kit',sac:'',quantity:2,unit_price:30,discount:0,tax_rate:5,tax_basis:'exclusive'}]});
test('invoice combines accommodation and extras with 5% exclusive GST and paid balance',()=>{const r=calculateInvoice(draft());assert.equal(r.subtotal,3060);assert.equal(r.tax,153);assert.equal(r.total,3213);assert.equal(r.balance_due,2213);});
test('inclusive tax, discounts, and overpayments reconcile in cents',()=>{const d=draft();d.lines=[{...d.lines[0],unit_price:1100,discount:50,tax_basis:'inclusive'}];d.amount_paid=1100;const r=calculateInvoice(d);assert.equal(r.subtotal,1047.62);assert.equal(r.tax,52.38);assert.equal(r.balance_due,0);assert.equal(r.credit,50);});
test('invalid invoice values are rejected rather than producing incorrect documents',()=>{for(const change of [d=>d.lines[0].tax_rate=null,d=>d.lines[0].quantity=-1,d=>d.lines[0].discount=4000,d=>d.amount_paid=-1,d=>d.customer_name='',d=>d.check_out=d.check_in,d=>d.issue_date='2026-02-30']){const d=draft();change(d);assert.throws(()=>calculateInvoice(d));}});
module.exports={draft};
test('exclusive accommodation discount is deducted after GST',()=>{
 const d=draft();
 d.lines=[{...d.lines[0],unit_price:1000,discount:100}];
 const result=calculateInvoice(d);
 assert.equal(result.subtotal,1000);
 assert.equal(result.tax,50);
 assert.equal(result.total,950);
});
test('payment mode is saved when provided and remains compatible with older invoices',()=>{
 const d=draft();
 assert.equal(Object.hasOwn(calculateInvoice(d),'payment_mode'),false);
 for(const mode of ['Cash','UPI','Card','Bank transfer','OTA','Mixed','Other']){
  assert.equal(calculateInvoice({...d,payment_mode:mode}).payment_mode,mode);
 }
 assert.throws(()=>calculateInvoice({...d,payment_mode:'invalid'}),/payment mode/);
});
test('invoice stay details group actual beds by dorm with singular and plural labels',()=>{
 const {roomStayDetails}=require('../services/invoiceService');
 const bed=(id,room_id,name)=>({bed_id:id,beds:{room_id,rooms:{room_name:name}}});
 const result=roomStayDetails([bed(1,1,'6 bed mixed dorm'),bed(2,1,'6 bed mixed dorm'),bed(3,2,'6 bed female dorm'),bed(1,1,'6 bed mixed dorm')]);
 assert.equal(result,'1 bed in 6 bed female dorm\n2 beds in 6 bed mixed dorm');
 assert.equal(roomStayDetails([]),'');
});

test('stay details require valid dates and one unique bed per guest',()=>{
 for(const change of [d=>d.guests='1.5',d=>d.guests='0',d=>d.check_in='',d=>d.stay_beds=[],d=>{d.guests='2';d.stay_beds.push(d.stay_beds[0]);}]){const d=draft();change(d);assert.throws(()=>calculateInvoice(d));}
 const d=draft();d.guests='2';d.stay_beds.push({bed_id:2,room_name:'6 bed mixed dorm',bed_name:'bed-2'});
 assert.equal(calculateInvoice(d).stay_details,'2 beds in 6 bed mixed dorm');
});
test('phone is optional and checks digits without country or length restrictions',()=>{
 assert.equal(calculateInvoice(draft()).customer_phone,'');
 assert.equal(calculateInvoice({...draft(),customer_phone:'+91123',phone_country:'IN'}).customer_phone,'+91123');
 for(const phone of ['abc','+91hello','12.34'])assert.throws(()=>calculateInvoice({...draft(),customer_phone:phone,phone_country:'IN'}),/Phone number/);
});
