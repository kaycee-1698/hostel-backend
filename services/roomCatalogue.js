const crypto = require('node:crypto');
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = 'room-photos';
function parsePhoto(value) {
 const match = typeof value === 'string' && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if (!match) throw Object.assign(new Error('Choose a JPG, PNG or WebP photo.'), {status:400});
 const bytes = Buffer.from(match[2], 'base64');
 const mime = match[1];
 const valid = mime === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
  : mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
 if (!valid || bytes.length>MAX_BYTES || bytes.toString('base64')!==match[2]) throw Object.assign(new Error('Choose a valid photo up to 5 MB.'),{status:400});
 return {bytes,mime,extension: mime==='image/jpeg'?'jpg':mime.split('/')[1]};
}
function roomDetails(input, partial=false) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Enter valid room details.');
 const output={};
 if (!partial || 'room_name' in input) {
  if(typeof input.room_name!=='string'||!input.room_name.trim()||input.room_name.length>150) throw new Error('Enter a room name (up to 150 characters).');
  output.room_name=input.room_name.trim();
 }
 if (!partial || 'base_rate' in input) {
  if(!require('./rateValidation').validAmount(input.base_rate)) throw new Error('Enter a valid base rate.');
  output.base_rate=input.base_rate;
 }
 if (!partial || 'room_type' in input) {
  const type=input.room_type??'dormitory';
  if(!['dormitory','private'].includes(type))throw new Error('Choose Dormitory or Private room.');
  output.room_type=type;
 }
 if ('description' in input) {
  if(typeof input.description!=='string'||input.description.length>3000)throw new Error('Keep the description within 3,000 characters.');
  output.description=input.description.trim();
 }
 return output;
}
function decorateRoom(supabase,room) {
 return {...room,photos:(room.photo_paths||[]).map(path=>({path,url:supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}))};
}
function publicRoom(supabase,room) {
 const r=decorateRoom(supabase,room);
 return {room_id:r.room_id,room_name:r.room_name,room_type:r.room_type,description:r.description,
 capacity:(r.beds||[]).length,base_rate:Number(r.base_rate),price_unit:r.room_type==='private'?'room':'bed',photos:r.photos.map(p=>({url:p.url}))};
}
function availabilityFor(room,occupied) {
 const beds=room.beds||[];const free=beds.filter(b=>!occupied.has(b.bed_id)).length;
 return room.room_type==='private' ? (beds.length>0 && free===beds.length ? 1 : 0) : free;
}
function photoPath(roomId,extension){return `${roomId}/${crypto.randomUUID()}.${extension}`;}
module.exports={BUCKET,parsePhoto,roomDetails,decorateRoom,publicRoom,availabilityFor,photoPath};
