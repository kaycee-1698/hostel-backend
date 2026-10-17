const {supabase}=require('../utils/supabase');
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function validRange(start,end){return validDate(start)&&validDate(end)&&end>=start;}
async function loadRates(start,end){
 const {data:rooms,error}=await supabase.from('rooms').select('room_id,base_rate');
 if(error)throw error;
 const rates=Object.fromEntries(rooms.map(room=>[room.room_id,Number(room.base_rate)]));
 for(let offset=0;;offset+=1000){
  const result=await supabase.from('room_daily_rates').select('*').gte('stay_date',start).lte('stay_date',end).order('room_id').order('stay_date').range(offset,offset+999);
  if(result.error)throw result.error;
  for(const row of result.data)rates[`${row.room_id}:${row.stay_date}`]=Number(row.rate);
  if(result.data.length<1000)break;
 }
 return rates;
}
function calculateQuote(rates,start,end,rooms){
 let cents=0;
 for(let day=new Date(`${start}T00:00:00Z`);day<new Date(`${end}T00:00:00Z`);day.setUTCDate(day.getUTCDate()+1)){
  const date=day.toISOString().slice(0,10);
  for(const [room,count] of Object.entries(rooms)){
   const rate=rates[`${room}:${date}`]??rates[room];
   if(!Number.isFinite(rate))throw new Error('Room rate unavailable');
   cents+=Math.round(rate*100)*count;
  }
 }
 return cents/100;
}
module.exports={validRange,loadRates,calculateQuote};
