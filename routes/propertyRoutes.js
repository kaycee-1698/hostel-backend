const router=require('express').Router();
const {randomUUID}=require('node:crypto');
const {supabase}=require('../utils/supabase');
const {BUCKET,validateProperty,decorate,parsePhoto}=require('../services/propertyDetails');
for(const [path,isPublic] of [['/property',false],['/public/property',true]])router.get(path,async(req,res)=>{
 try{
  const {data,error}=await supabase.from('property_details').select('details,version').eq('id',1).single();
  if(error)throw error;
  res.set('Cache-Control','no-store').json(decorate(supabase,data,isPublic));
 }catch(error){console.error('Property load failed:',error.message);res.status(503).json({error:'Property details could not be loaded. Please try again.'});}
});
router.post('/property/photos',async(req,res)=>{
 try{
  const photo=parsePhoto(req.body?.photo),path=`property/${randomUUID()}.${photo.extension}`;
  const {error}=await supabase.storage.from(BUCKET).upload(path,photo.bytes,{contentType:photo.mime,upsert:false});
  if(error)throw error;
  res.status(201).json({path,url:supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl});
 }catch(error){res.status(error.status||503).json({error:error.status?error.message:'Could not upload photo. Your edits are still here; try saving again.'});}
});
router.put('/property',async(req,res)=>{
 try{
  const details=validateProperty(req.body?.details),version=req.body?.version;
  if(!Number.isSafeInteger(version)||version<1)return res.status(400).json({error:'Reload the property before saving.'});
  const {data,error}=await supabase.rpc('save_property_details',{p_details:details,p_version:version});
  if(error){if(error.code==='P0001')return res.status(409).json({error:'Property details changed elsewhere or a photo is unavailable. Reload the saved details before trying again. Your edits are still here.'});throw error;}
  res.json(decorate(supabase,Array.isArray(data)?data[0]:data));
 }catch(error){console.error('Property save failed:',error.message);res.status(error.status||503).json({error:error.status?error.message:'Could not save property details. Your edits are still here. Please try again.'});}
});
module.exports=router;
