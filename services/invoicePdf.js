const PDFDocument = require('pdfkit');
const path = require('path');
const money = value => 'INR ' + Number(value).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const date = value => value ? new Intl.DateTimeFormat('en-GB', {day:'2-digit', month:'short', year:'numeric', timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')) : '';

function invoicePdf(invoice) {
 return new Promise((resolve, reject) => {
  const doc = new PDFDocument({size:'A4', margin:44, bufferPages:true, info:{Title:`Invoice ${invoice.invoice_number}`, Author:'Unpack Hostel'}});
  const chunks=[];
  doc.on('data', chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  doc.registerFont('Body',path.join(__dirname,'../assets/fonts/LiberationSans-Regular.ttf'));
  doc.registerFont('Bold',path.join(__dirname,'../assets/fonts/LiberationSans-Bold.ttf'));
  const s=invoice.snapshot,b=s.business;
  const left=44,right=551,width=507,ink='#202D39',muted='#61717D',accent='#91384C',line='#DEE4E7';
  let y=44;
  const text=(value,x,top,w,size=10,bold=false,color=ink,align='left')=>{
   doc.font(bold?'Bold':'Body').fontSize(size).fillColor(color).text(String(value??''),x,top,{width:w,align,lineGap:3});
  };
  const height=(value,w,size=10)=>doc.font('Body').fontSize(size).heightOfString(value,{width:w,lineGap:3});
  const rule=(top,x=left,w=width)=>doc.moveTo(x,top).lineTo(x+w,top).lineWidth(0.6).strokeColor(line).stroke();
  const ensure=h=>{if(y+h>748){doc.addPage();text('UNPACK HOSTEL',left,40,240,10,true);text(invoice.invoice_number,300,40,251,9,false,muted,'right');rule(64);y=84;}};

  doc.rect(left,36,32,3).fill(accent);
  doc.image(path.join(__dirname,'../assets/unpack-logo.jpg'),left,51,{width:60});
  text(b.name,116,55,240,23,true);
  text(b.legal_name,117,86,240,10,false,muted);
  text('TAX INVOICE',382,57,169,10,true,accent,'right');
  text(invoice.invoice_number,357,78,194,11,true,ink,'right');
  text('Invoice date  '+date(s.issue_date),357,100,194,9,false,muted,'right');

  text(b.address,left,130,270,9,false,muted);
  text('GSTIN  '+b.gstin,333,130,218,9,true,ink,'right');
  text(b.email,333,151,218,9,false,muted,'right');
  text(b.phone,333,168,218,9,false,muted,'right');
  rule(198);y=217;
  text('BILL TO',left,y,230,8.5,true,accent);
  text('STAY DETAILS',315,y,236,8.5,true,accent);y+=20;
  text(s.customer_name,left,y,245,12,true);
  const customer=[s.customer_address,s.customer_phone,s.customer_email,s.customer_gstin?'GSTIN  '+s.customer_gstin:''].filter(Boolean).join('\n');
  text(customer,left,y+23,245,9.5,false,muted);
  const stay=[s.check_in?'Check-in    '+date(s.check_in):'',s.check_out?'Check-out  '+date(s.check_out):'',s.guests?'Guests       '+s.guests:'',s.stay_details].filter(Boolean).join('\n');
  text(stay,315,y,236,10);
  y+=Math.max(23+height(customer,245,9.5),height(stay,236))+27;

  const header=()=>{
   ensure(55);doc.rect(left,y,width,29).fill('#F1F4F5');
   text('DESCRIPTION',54,y+9,141,8,true,muted);text('QTY',199,y+9,26,8,true,muted,'right');
   text('UNIT PRICE',230,y+9,70,8,true,muted,'right');text('BASE',305,y+9,75,8,true,muted,'right');text('GST',385,y+9,68,8,true,muted,'right');text('AMOUNT',458,y+9,83,8,true,muted,'right');y+=39;
  };
  header();
  for(const item of s.lines){
   const description=item.description+(item.discount&&s.discount_basis!=='after_tax'?'\nDiscount: '+money(item.discount):'');
   const rowHeight=Math.max(40,height(description,141,10)+20);
   if(y+rowHeight>748){ensure(rowHeight+39);header();}
   text(description,54,y,141,10);text(item.quantity,199,y,26,9.5,false,ink,'right');
   text(money(item.unit_price),230,y,70,8,false,ink,'right');text(item.tax_basis==='inclusive'?'Incl. tax':'Excl. tax',230,y+14,70,7,false,muted,'right');text(money(item.taxable),305,y,75,8,false,ink,'right');text(money(item.tax),385,y,68,8,false,ink,'right');text(item.tax_rate+'%',385,y+14,68,7,false,muted,'right');text(money(s.discount_basis==='after_tax'?item.total+item.discount:item.total),458,y,83,8,true,ink,'right');
   y+=rowHeight;rule(y-9);
  }
  ensure((s.credit?240:215)+(s.payment_mode?24:0)+(s.discount_basis==='after_tax'&&s.discount?48:0));y+=12;
  const summary=(label,amount,bold=false)=>{text(label,310,y,122,10,bold,bold?ink:muted);text(money(amount),432,y,119,10,bold,ink,'right');y+=24;};
  summary('Taxable subtotal',s.subtotal);
  if(s.tax_mode==='split'){
   const cgst=Math.floor(Math.round(s.tax*100)/2)/100;
   summary('CGST',cgst);summary('SGST',Math.round((s.tax-cgst)*100)/100);
  }else summary('IGST',s.tax);
  if(s.discount_basis==='after_tax'&&s.discount){summary('Total incl. tax',Math.round((s.subtotal+s.tax)*100)/100);summary('Discount after tax',-s.discount);}
  rule(y-4,310,241);y+=7;summary('Invoice total',s.total,true);summary('Amount paid',s.amount_paid);
  if(s.payment_mode){text('Payment mode',310,y,122,10,false,muted);text(s.payment_mode,432,y,119,10,false,ink,'right');y+=24;}
  doc.roundedRect(300,y,251,42,5).fill('#F6ECEF');
  text('BALANCE DUE',313,y+15,110,9,true,accent);text(money(s.balance_due),419,y+13,119,12,true,accent,'right');y+=56;
  if(s.credit)summary('Credit / overpayment',s.credit);
  if(s.notes){const h=height(s.notes,width,9);ensure(h+44);text('NOTES',left,y,width,8,true,accent);y+=18;text(s.notes,left,y,width,9,false,muted);y+=h+18;}
  ensure(20);text('Thank you for staying with Unpack Hostel.',left,y,width,10,true);
  const pages=doc.bufferedPageRange();
  for(let i=0;i<pages.count;i++){
   doc.switchToPage(i);rule(768);text('UNPACK HOSTEL  /  '+invoice.invoice_number,left,778,420,7.5,false,muted);text(`${i+1} / ${pages.count}`,484,778,67,8,false,muted,'right');
  }
  doc.end();
 });
}
module.exports={invoicePdf};
