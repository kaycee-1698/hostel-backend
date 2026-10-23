const test=require('node:test');
const assert=require('node:assert/strict');
const {parsePhoto,roomDetails,publicRoom,availabilityFor}=require('../services/roomCatalogue');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9AAAAABJRU5ErkJggg==';
test('room photos accept valid bytes and reject spoofed, oversized and unsupported files',()=>{
 assert.equal(parsePhoto(png).mime,'image/png');
 for(const photo of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8=',null,'https://example.com/image.jpg'])assert.throws(()=>parsePhoto(photo));
 const big=Buffer.alloc(5*1024*1024+1);Buffer.from([137,80,78,71,13,10,26,10]).copy(big);
 assert.throws(()=>parsePhoto('data:image/png;base64,'+big.toString('base64')),/5 MB/);
});
test('room editing only accepts supported catalogue fields',()=>{
 assert.deepEqual(roomDetails({room_type:'private',photo_paths:['foreign'],capacity:999},true),{room_type:'private'});
 assert.throws(()=>roomDetails({room_type:'hotel'},true));
 assert.throws(()=>roomDetails({description:'x'.repeat(3001)},true));
 assert.equal(roomDetails({room_name:' Room ',base_rate:600}).room_type,'dormitory');
});
test('public catalogue omits internal fields and retains photo order',()=>{
 const storage={storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://photos/'+path}})})}};
 const output=publicRoom(storage,{room_id:1,room_name:'Private',room_type:'private',base_rate:'1000',description:'Quiet',photo_paths:['1/b','1/a'],beds:[{bed_id:1},{bed_id:2}],secret:'never public'});
 assert.equal(output.secret,undefined);assert.equal(output.beds,undefined);assert.equal(output.photo_paths,undefined);
 assert.deepEqual(output.photos,[{url:'https://photos/1/b'},{url:'https://photos/1/a'}]);assert.equal(output.price_unit,'room');assert.equal(output.capacity,2);
});
test('one occupied bed blocks an entire private room but only one dorm bed',()=>{
 const room={room_type:'private',beds:[{bed_id:1},{bed_id:2}]};
 assert.equal(availabilityFor(room,new Set()),1);assert.equal(availabilityFor(room,new Set([1])),0);
 assert.equal(availabilityFor({...room,room_type:'dormitory'},new Set([1])),1);
 assert.equal(availabilityFor({...room,beds:[]},new Set()),0);
});
const fs=require('node:fs'),vm=require('node:vm');
test('private room quote charges once per night while dorm price multiplies by guests',()=>{
 const scope={module:{exports:{}},require:()=>({supabase:{}})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../services/rateService'),'utf8'),scope);
 const rates={1:1000,2:600,'1:2026-10-24':1200,room_types:{1:'private',2:'dormitory'}};
 assert.equal(scope.module.exports.calculateQuote(rates,'2026-10-23','2026-10-25',{1:2,2:3}),5800);
});
