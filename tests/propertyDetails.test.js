const test=require('node:test');const assert=require('node:assert/strict');
const {validateProperty,decorate}=require('../services/propertyDetails');
const valid={name:'Unpack',description:'Home',address:'Street',city:'Pondy',postcode:'605003',country:'India',phone:'+91 8169791517',email:'hello@example.com',directions:'https://maps.example.com',checkIn:'13:00',checkOut:'10:00',amenities:['Wi-Fi'],customAmenities:[],photos:[]};
test('property validation rejects unsafe links, invalid times and foreign photos',()=>{
 for(const change of [{directions:'javascript:alert(1)'},{checkIn:'25:00'},{amenities:['x'.repeat(61)]},{name:' '},{photos:[{path:'../../private.jpg',caption:''}]}])assert.throws(()=>validateProperty({...valid,...change}));
 assert.equal(validateProperty({...valid,version:100,secret:'hidden'}).secret,undefined);
});
test('public property contains ordered photo URLs, no storage paths or revision metadata',()=>{
 const storage={storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://photos/'+path}})})}};
 const row={version:3,details:{...valid,photos:[{path:'b',caption:'Roof'},{path:'a',caption:'Entrance'}]}};
 const result=decorate(storage,row,true);
 assert.deepEqual(result.photos,[{caption:'Roof',url:'https://photos/b'},{caption:'Entrance',url:'https://photos/a'}]);
 assert.equal(result.version,undefined);assert.equal(result.customAmenities,undefined);
 assert.equal(decorate(storage,row).version,3);
});
