const router=require('express').Router();
const {supabase}=require('../utils/supabase');
const {BUCKET,parsePhoto,decorateRoom,publicRoom,availabilityFor,photoPath}=require('../services/roomCatalogue');
const {validRange,loadRates,calculateQuote}=require('../services/rateService');
const validId=id=>/^[1-9][0-9]*$/.test(String(id))&&Number.isSafeInteger(Number(id));
router.post('/rooms/:id/photos',async(req,res)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Invalid room.'});
 try{
  const photo=parsePhoto(req.body?.photo);
  const {data:room,error:lookupError}=await supabase.from('rooms').select('room_id,photo_paths').eq('room_id',req.params.id).single();
  if(lookupError||!room)return res.status(404).json({error:'Room not found. Refresh and try again.'});
  if(room.photo_paths.length>=12)return res.status(400).json({error:'A room can have up to 12 photos.'});
  const path=photoPath(room.room_id,photo.extension);
  const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,photo.bytes,{contentType:photo.mime,upsert:false});
  if(uploadError)throw new Error('Upload failed');
  const {data,error}=await supabase.rpc('add_room_photo',{p_room_id:room.room_id,p_path:path});
  // A transport failure may follow a committed write; retain the object on uncertain errors.
  if(error){if(error.code==='P0001')await supabase.storage.from(BUCKET).remove([path]);throw error;}
  res.status(201).json({room:decorateRoom(supabase,Array.isArray(data)?data[0]:data)});
 }catch(error){console.error('Room photo upload failed:',error.message);res.status(error.status||500).json({error:error.status?error.message:'Could not upload this photo. Refresh the room before trying again.'});}
});
router.put('/rooms/:id/photos',async(req,res)=>{
 const {expected,paths}=req.body||{};
 if(!validId(req.params.id)||![expected,paths].every(a=>Array.isArray(a)&&a.length<=12&&a.every(p=>typeof p==='string'&&p.length<250)))return res.status(400).json({error:'Invalid photo order.'});
 const {data,error}=await supabase.rpc('save_room_photos',{p_room_id:Number(req.params.id),p_expected:expected,p_paths:paths});
 if(error)return res.status(error.code==='P0001'?409:500).json({error:error.code==='P0001'?'Photos changed. Reload this room and try again.':'Could not save photos. Your changes are still here.'});
 const removed=expected.filter(p=>!paths.includes(p));
 if(removed.length){const {error:cleanupError}=await supabase.storage.from(BUCKET).remove(removed);if(cleanupError)console.error('Room photo cleanup failed:',cleanupError.message);}
 res.json({room:decorateRoom(supabase,Array.isArray(data)?data[0]:data)});
});
router.get('/public/rooms',async(req,res)=>{
 const {check_in,check_out}=req.query;
 const dated=check_in!==undefined||check_out!==undefined;
 if(dated&&(!validRange(check_in,check_out)||check_out<=check_in||(Date.parse(check_out)-Date.parse(check_in))/86400000>90))return res.status(400).json({error:'Choose a check-out after check-in, for up to 90 nights.'});
 try{
  const {data:rooms,error}=await supabase.from('rooms').select('room_id,room_name,room_type,description,base_rate,photo_paths,beds(bed_id)').order('room_id');
  if(error)throw error;
  let occupied=new Set(),rates;
  if(dated){
   for(let offset=0;;offset+=1000){
    const result=await supabase.from('booking_beds').select('bed_id,booking_bed_id').gt('check_out',check_in).lt('check_in',check_out).order('booking_bed_id').range(offset,offset+999);
    if(result.error)throw result.error;
    result.data.forEach(b=>occupied.add(b.bed_id));if(result.data.length<1000)break;
   }
   rates=await loadRates(check_in,new Date(Date.parse(check_out)-86400000).toISOString().slice(0,10));
  }
  res.set('Cache-Control','no-store').json({rooms:rooms.map(room=>({...publicRoom(supabase,room),...(dated?{available_units:availabilityFor(room,occupied),stay_total:calculateQuote(rates,check_in,check_out,{[room.room_id]:1})}: {})}))});
 }catch(error){console.error('Public catalogue failed:',error.message);res.status(503).json({error:'Rooms are temporarily unavailable. Please try again or contact our team.'});}
});
module.exports=router;
