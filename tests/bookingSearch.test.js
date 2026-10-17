const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={module:{exports:{}},require:()=>({supabase:{}})};
vm.runInNewContext(fs.readFileSync(__dirname+'/../services/bookingSearchService.js','utf8'),scope);
const {searchBookings}=scope.module.exports;
function client(responses){const calls=[];return {calls,from(){const call={};calls.push(call);return {select(){return this;},ilike(column,pattern){Object.assign(call,{column,pattern});return this;},order(){return this;},limit(limit){call.limit=limit;return Promise.resolve(responses[calls.length-1]);}};}};}
test('booking search merges matches without duplicates and sorts newest first',async()=>{
 const first={booking_id:1,check_in:'2026-10-01'},second={booking_id:2,check_in:'2026-10-02'};
 const db=client([{data:[first]},{data:[second,first]}]);
 const result=await searchBookings('Test',db);
 assert.deepEqual(Array.from(result,r=>r.booking_id),[2,1]);assert.equal(db.calls[0].pattern,'%Test%');
});
test('booking search escapes wildcards and tolerates phone formatting',async()=>{
 const db=client([{data:[]},{data:[]}]);await searchBookings('50%_off',db);
 assert.equal(db.calls[0].pattern,'%50\\%\\_off%');
 const phone=client([{data:[]},{data:[]}]);await searchBookings('+91 987',phone);
 assert.equal(phone.calls[1].pattern,'%9%1%9%8%7%');
});
test('booking search rejects unsuitable input and surfaces database failures',async()=>{
 const db=client([]);assert.equal((await searchBookings(' ',db)).length,0);assert.equal((await searchBookings(['name'],db)).length,0);assert.equal(db.calls.length,0);
 await assert.rejects(searchBookings('name',client([{error:Error('offline')},{data:[]}])) ,/offline/);
});
