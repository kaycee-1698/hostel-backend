const {supabase}=require('../utils/supabase');
const dayAfter=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const money=value=>Math.round((Number(value)||0)*100)/100;
const balance=booking=>Math.max(0,money(booking.pending_amount));
const indiaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function allRows(makeQuery){
 const rows=[];
 for(let offset=0;;offset+=1000){const {data,error}=await makeQuery().range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}
}
function summarize({today,rooms,beds,assignments,bookings,rates,events,undatedCount}){
 const monthStart=today.slice(0,7)+'-01';const monthEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1)).toISOString().slice(0,10);
 const bedIds=new Set(beds.map(b=>b.bed_id));
 const occupied=day=>new Set(assignments.filter(a=>a.check_in<=day&&a.check_out>day&&bedIds.has(a.bed_id)).map(a=>a.bed_id));
 const occupiedToday=occupied(today);
 const roomNames=new Map(rooms.map(r=>[r.room_id,r.room_name]));
 const stay=b=>({id:b.booking_id,name:b.booking_name,guests:b.number_of_adults,room:(b.booking_rooms||[]).map(r=>roomNames.get(r.room_id)||'Unknown room').join(', ')||'Not assigned',balance:balance(b),check_in:b.check_in,check_out:b.check_out});
 const arrivals=bookings.filter(b=>b.check_in===today).map(stay).sort((a,b)=>a.name.localeCompare(b.name));
 const departures=bookings.filter(b=>b.check_out===today).map(stay).sort((a,b)=>a.name.localeCompare(b.name));
 const monthBookings=bookings.filter(b=>b.check_in<monthEnd&&b.check_out>monthStart);
 const sales=monthBookings.reduce((sum,b)=>{
  const nights=(Date.parse(b.check_out)-Date.parse(b.check_in))/86400000;
  const included=(Date.parse(b.check_out<monthEnd?b.check_out:monthEnd)-Date.parse(b.check_in>monthStart?b.check_in:monthStart))/86400000;
  return sum+(nights>0?Number(b.base_amount||0)*included/nights:0);
 },0);
 const roomRows=rooms.map(r=>{const ids=beds.filter(b=>b.room_id===r.room_id).map(b=>b.bed_id);return {id:r.room_id,name:r.room_name,rate:Number(rates.find(rate=>rate.room_id===r.room_id)?.rate??r.base_rate),total:ids.length,free:ids.filter(id=>!occupiedToday.has(id)).length};});
 return {today,rooms:roomRows,arrivals,departures,total:beds.length,occupied:occupiedToday.size,available:beds.length-occupiedToday.size,
  occupancy:beds.length?Math.round(occupiedToday.size/beds.length*100):0,
  monthly:{sales:money(sales),received:money(events.reduce((sum,event)=>sum+Number(event.amount),0)),outstanding:money(monthBookings.reduce((sum,b)=>sum+balance(b),0)),undatedCount},
  week:Array.from({length:7},(_,index)=>{const date=dayAfter(today,index);return {date,free:beds.length-occupied(date).size};}),
  demoBookings:monthBookings.filter(b=>(b.other_info||'').includes('[dashboard-demo:')).length};
}
async function getDashboard(today=indiaToday()){
 const monthStart=today.slice(0,7)+'-01';const monthEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1)).toISOString().slice(0,10);
 const nextWeek=dayAfter(today,7),end=nextWeek>monthEnd?nextWeek:monthEnd;
 const [rooms,beds,assignments,bookings,rates,events,undated]=await Promise.all([
  allRows(()=>supabase.from('rooms').select('room_id,room_name,base_rate').order('room_id')),
  allRows(()=>supabase.from('beds').select('bed_id,room_id').order('bed_id')),
  allRows(()=>supabase.from('booking_beds').select('booking_bed_id,bed_id,check_in,check_out').lte('check_in',dayAfter(today,6)).gt('check_out',today).order('booking_bed_id')),
  allRows(()=>supabase.from('bookings').select('booking_id,booking_name,number_of_adults,check_in,check_out,base_amount,pending_amount,other_info,booking_rooms(room_id)').lt('check_in',end).gte('check_out',monthStart).order('booking_id')),
  allRows(()=>supabase.from('room_daily_rates').select('room_id,rate').eq('stay_date',today).order('room_id')),
  allRows(()=>supabase.from('booking_payment_events').select('event_id,amount').gte('received_at',monthStart+'T00:00:00+05:30').lt('received_at',monthEnd+'T00:00:00+05:30').order('event_id')),
  supabase.from('booking_payment_events').select('event_id',{count:'exact',head:true}).is('received_at',null)
 ]);
 if(undated.error)throw undated.error;
 return summarize({today,rooms,beds,assignments,bookings,rates,events,undatedCount:undated.count||0});
}
module.exports={getDashboard,summarize,indiaToday,allRows};
