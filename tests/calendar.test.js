const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function service(supabase) {
  const context = {module:{exports:{}},console,require(name){
    if(name === '../utils/supabase') return {supabase};
    if(name.endsWith('validateBookingData')) return require('../utils/bookings/validateBookingData');
    if(name.endsWith('financials')) return {calculateFinancials:()=>({pending_amount:100})};
    return {};
  }};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../services/bookingService.js','utf8'),context);
  return context.module.exports;
}
test('creation automatically allocates dorm beds even when an older client sends a preferred bed',async()=>{
  let calls=0;
  const api=service({rpc:async(name,args)=>{
    calls++; assert.equal(name,'create_booking_once');
    assert.equal(args.p_preferred_bed_id,null);
    assert.equal(args.p_booking.preferred_bed_id,undefined);
    assert.equal(args.p_booking.pending_amount,100);
    return {data:{booking_id:1}};
  }});
  const booking={booking_name:'Test',ota_name:'Direct',number_of_adults:1,check_in:'2026-10-10',check_out:'2026-10-13',base_amount:100,payment_received:0,create_request_id:'11111111-1111-4111-8111-111111111111',preferred_bed_id:12,guests_per_room:{2:1}};
  assert.equal((await api.createBookingService(booking)).booking_id,1);
  assert.equal(calls,1);

});
test('calendar uses assignment dates rather than parent dates and returns stable assignment IDs',async()=>{
  const rows = [{booking_bed_id:9, booking_id:1, bed_id:4, check_in:'2026-10-10', check_out:'2026-10-17', bookings:{booking_name:'Guest'}}];
  const db={from(table){assert.equal(table,'booking_beds');return this;},select(){return this;},lte(){return this;},gt:async()=>({data:rows})};
  const result=await service(db).getBookingsByBedAndDateRangeService('2026-10-16','2026-10-17');
  assert.equal(result.calendarBookings[4]['2026-10-16'].check_in,'2026-10-10');
  assert.equal(result.calendarBookings[4]['2026-10-16'].booking_bed_id,9);
  assert.equal(result.calendarBookings[4]['2026-10-17'],undefined);
  assert.equal(Object.keys(result.calendarBookings[4]).length,1);
  assert.equal(result.unassignedBookings,undefined);
});

test('creation hides database permission details from staff',async()=>{
  const api=service({rpc:async()=>({error:{code:'42501',message:'new row violates row-level security policy for table booking_creation_requests'}})});
  await assert.rejects(api.createBookingService({booking_name:'Test',ota_name:'Direct',number_of_adults:1,check_in:'2026-10-10',check_out:'2026-10-13',base_amount:100,payment_received:0,create_request_id:'11111111-1111-4111-8111-111111111111',guests_per_room:{2:1}}),error=>/system setup issue/.test(error.message) && !/booking_creation_requests|row-level/.test(error.message));
});
