// Run from backend: node scripts/seedDashboardMonth.js 2026-10 [--apply]
// Uses existing atomic booking creation. Never edits/deletes existing bookings.
const crypto=require('node:crypto');
const {supabase}=require('../utils/supabase');
const {allRows,indiaToday}=require('../services/dashboardService');
const {calculateFinancials}=require('../utils/bookings/financials');
const {loadRates,calculateQuote}=require('../services/rateService');
async function main(){
 const month=process.argv[2],apply=process.argv.includes('--apply');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Provide YYYY-MM');
 const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
 const marker=`[dashboard-demo:${month}]`;
 const history=await supabase.from('booking_payment_events').select('event_id').limit(1);if(history.error)throw Error('Install migration 010 before seeding.');
 const rooms=await allRows(()=>supabase.from('rooms').select('room_id,base_rate,beds(bed_id)').order('room_id'));
 rooms.forEach(room=>room.beds.sort((a,b)=>a.bed_id-b.bed_id));
 const existing=await allRows(()=>supabase.from('bookings').select('booking_id,other_info').like('other_info',`%${marker}%`).order('booking_id'));
 const tags=new Set(existing.map(b=>b.other_info));
 const occupied=await allRows(()=>supabase.from('booking_beds').select('booking_bed_id,bed_id,check_in,check_out').lt('check_in',end).gt('check_out',start).order('booking_bed_id'));
 const rates=await loadRates(start,end);
 let created=0,skipped=0,bedNights=0;
 const nightsInMonth=(Date.parse(end)-Date.parse(start))/86400000;
 const plus=(date,n)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
 for(let day=0;day<nightsInMonth;day++){
  const check_in=plus(start,day);
  for(let i=0;i<rooms.length;i++){
   const room=rooms[i];if(!room.beds.length)continue;
   const tag=`${marker} slot=${day}-${room.room_id}`;
   if(tags.has(tag)){skipped++;continue;}
   const nights=Math.min(1+(day+i)%4,nightsInMonth-day),check_out=plus(check_in,nights);
   const available=room.beds.filter(b=>!occupied.some(a=>a.bed_id===b.bed_id&&a.check_in<check_out&&a.check_out>check_in));
   // Leave space for further manual testing; never exceed actual room capacity.
   const desired=1+(day+i)%3;
   if(available.length<desired+Math.max(1,Math.floor(room.beds.length*0.2)))continue;
   const guests_per_room={[room.room_id]:desired};
   const base_amount=calculateQuote(rates,check_in,check_out,guests_per_room);
   const ota_name=['Direct','Booking.com','Website'][day%3];
   const gross=base_amount+calculateFinancials({ota_name,base_amount,payment_received:0}).gst;
   const payment_received=(day+i)%5===0?0:(day+i)%3===0?Math.round(gross/2):gross;
   const booking={booking_name:`Demo ${String(day+1).padStart(2,'0')} · Room ${room.room_id}`,ota_name,check_in,check_out,number_of_adults:desired,base_amount,payment_received,other_info:tag,...calculateFinancials({ota_name,base_amount,payment_received})};
   if(apply){
    const hash=crypto.createHash('sha256').update(tag).digest('hex').slice(0,32);
    const requestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    const {data,error}=await supabase.rpc('create_booking_once',{p_request_id:requestId,p_booking:booking,p_guests_per_room:guests_per_room,p_preferred_bed_id:null});
    if(error)throw Error(`Seed stopped at day ${day+1}, room ${room.room_id}: ${error.message}`);
    // Dates are fictional and explicitly part of this demo fixture. Future stays
    // have deposits today; past stays have receipts on their arrival date.
    const receiptDate=check_in>indiaToday()?indiaToday():check_in;
    const result=await supabase.from('booking_payment_events').update({received_at:receiptDate+'T12:00:00+05:30'}).eq('booking_id',data.booking_id).eq('event_kind','payment_change');
    if(result.error)throw Error('Booking created but its demo receipt date could not be set. Inspect the seed before retrying.');
   }
   for(const bed of available.slice(0,desired))occupied.push({bed_id:bed.bed_id,check_in,check_out});
   created++;bedNights+=desired*nights;
  }
 }
 console.log(JSON.stringify({month,mode:apply?'created':'dry-run',bookings:created,bedNights,alreadyPresent:skipped}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
