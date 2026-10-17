const {supabase}=require('../utils/supabase');

async function searchBookings(query, client=supabase) {
  const term=typeof query==='string'?query.trim():'';
  if(term.length<2 || term.length>100) return [];
  // Treat SQL wildcard characters as literal text; never interpolate a PostgREST filter.
  const literal=term.replace(/[\\%_]/g,'\\$&');
  const fields='booking_id,booking_name,contact_number,check_in,check_out,number_of_adults,pending_amount';
  const find=(column,pattern)=>client.from('bookings').select(fields).ilike(column,pattern)
    .order('check_in',{ascending:false}).order('booking_id',{ascending:false}).limit(20);
  const digits=term.replace(/\D/g,'');
  const phone=/^[+\d\s().-]+$/.test(term)&&digits.length>=2
    ? `%${digits.split('').join('%')}%` : `%${literal}%`;
  const responses=await Promise.all([find('booking_name',`%${literal}%`),find('contact_number',phone)]);
  for(const response of responses) if(response.error) throw response.error;
  const unique=new Map(responses.flatMap(r=>r.data).map(b=>[b.booking_id,b]));
  return [...unique.values()].sort((a,b)=>b.check_in.localeCompare(a.check_in)||b.booking_id-a.booking_id).slice(0,20);
}
module.exports={searchBookings};
