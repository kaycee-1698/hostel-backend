const {supabase}=require('../utils/supabase');
async function collectPayment(id,body,client=supabase){
 const bookingId=Number(id),amount=body?.amount,requestId=body?.request_id;
 if(!Number.isSafeInteger(bookingId)||bookingId<=0||typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1000000||Math.abs(amount*100-Math.round(amount*100))>1e-7||typeof requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)){
  const error=new Error('Enter a valid payment amount with up to two decimal places.');error.status=400;throw error;
 }
 const {data,error}=await client.rpc('collect_booking_payment',{p_booking_id:bookingId,p_amount:amount,p_request_id:requestId});
 if(error){
  const failure=new Error(error.code==='P0001'?error.message:'Could not confirm the payment. Retry this payment to avoid recording it twice.');
  failure.status=error.code==='P0001'?409:503;throw failure;
 }
 return data;
}
module.exports={collectPayment};
