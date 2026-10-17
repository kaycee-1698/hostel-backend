const validAmount=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1000000 && Math.abs(value*100-Math.round(value*100))<0.000001;
function validateRates(updates){
 if(!Array.isArray(updates)||!updates.length||updates.length>10000)return 'Save between 1 and 10,000 daily rates at a time.';
 const seen=new Set();
 for(const row of updates){
  if(!row||!Number.isSafeInteger(row.room_id)||row.room_id<=0||(row.rate!==null&&!validAmount(row.rate))||typeof row.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date))||new Date(row.date).toISOString().slice(0,10)!==row.date)return 'Enter valid rooms, dates and rates (up to two decimal places).';
  const key=`${row.room_id}:${row.date}`;if(seen.has(key))return 'Each room and date must appear only once.';seen.add(key);
 }
 return null;
}
module.exports={validateRates,validAmount};
