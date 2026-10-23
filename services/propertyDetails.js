const {parsePhoto}=require('./roomCatalogue');
const BUCKET='property-photos';
const fields={name:150,description:3000,address:300,city:100,postcode:20,country:100,phone:40,email:200,directions:500,checkIn:5,checkOut:5};
function validateProperty(value){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!value||typeof value!=='object')fail('Enter valid property details.');
 const result={};
 for(const [key,max] of Object.entries(fields)){
  if(typeof value[key]!=='string'||value[key].length>max)fail(`Check the ${key} field.`);
  result[key]=value[key].trim();
 }
 if(!result.name)fail('Enter a property name.');
 if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))fail('Enter a valid email.');
 if(result.phone&&!/^\+?[\d ()-]{6,40}$/.test(result.phone))fail('Enter a valid contact number.');
 if(result.directions){try{const url=new URL(result.directions);if(url.protocol!=='https:')throw Error();}catch{fail('Enter an HTTPS map link.');}}
 for(const key of ['checkIn','checkOut'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(result[key]))fail('Enter check-in and check-out times.');
 for(const key of ['amenities','customAmenities']){
  if(!Array.isArray(value[key])||value[key].length>100||value[key].some(a=>typeof a!=='string'||!a.trim()||a.length>60))fail('Check the amenities (up to 100, 60 characters each).');
  result[key]=[...new Set(value[key].map(a=>a.trim()))];
 }
 if(!Array.isArray(value.photos)||value.photos.length>12)fail('Choose up to 12 photos.');
 result.photos=value.photos.map(p=>{
  if(!p||typeof p.path!=='string'||!/^property\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(p.path)||typeof p.caption!=='string'||p.caption.length>160)fail('Check your property photos.');
  return {path:p.path,caption:p.caption.trim()};
 });
 if(new Set(result.photos.map(p=>p.path)).size!==result.photos.length)fail('Each photo can only appear once.');
 return result;
}
function decorate(supabase,row,publicView=false){
 const details={...row.details,photos:row.details.photos.map(p=>({...(!publicView?{path:p.path}:{}),caption:p.caption,url:supabase.storage.from(BUCKET).getPublicUrl(p.path).data.publicUrl}))};
 if(publicView)delete details.customAmenities;
 return publicView?details:{details,version:row.version};
}
module.exports={BUCKET,validateProperty,decorate,parsePhoto};
