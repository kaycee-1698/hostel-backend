const router=require('express').Router();
const {supabase}=require('../utils/supabase');
const {validateRates}=require('../services/rateValidation');
const {validRange,loadRates,calculateQuote}=require('../services/rateService');
router.get('/room-rates',async(req,res)=>{
 const {start,end}=req.query;
 if(!validRange(start,end))return res.status(400).json({error:'Choose a valid rate date range.'});
 try{res.json({rates:await loadRates(start,end)});}
 catch(error){console.error('Rate load failed',error);res.status(500).json({error:'Could not load room rates. Please try again.'});}
});
router.post('/room-rates/quote',async(req,res)=>{
 const {check_in,check_out,guests_per_room}=req.body||{};
 if(!validRange(check_in,check_out)||check_in===check_out||(Date.parse(check_out)-Date.parse(check_in))/86400000>3660||!guests_per_room||Array.isArray(guests_per_room)||typeof guests_per_room!=='object'||!Object.keys(guests_per_room).length||Object.entries(guests_per_room).some(([id,count])=>!(/^[1-9][0-9]*$/.test(id))||!Number.isSafeInteger(count)||count<1||count>1000))return res.status(400).json({error:'Choose valid dates and rooms for a price estimate.'});
 try{
  const lastNight=new Date(Date.parse(check_out)-86400000).toISOString().slice(0,10);
  const rates=await loadRates(check_in,lastNight);
  res.json({base_amount:calculateQuote(rates,check_in,check_out,guests_per_room)});
 }catch(error){console.error('Quote failed',error);res.status(500).json({error:'Could not calculate the default price. You can enter a price manually.'});}
});
router.put('/room-rates',async(req,res)=>{
 const message=validateRates(req.body?.updates);
 if(message)return res.status(400).json({error:message});
 const {data,error}=await supabase.rpc('save_room_daily_rates',{p_updates:req.body.updates});
 if(error){console.error('Rate save failed',error);return res.status(500).json({error:'Could not save rates. Check that rate setup is complete and try again.'});}
 res.json({saved:data});
});
module.exports=router;
