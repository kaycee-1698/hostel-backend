const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function load(rpc) {
  const scope = {module:{exports:{}},require:() => ({supabase:{rpc}})};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../services/bedMoveService.js','utf8'),scope);
  return scope.module.exports.moveBedAssignment;
}
const input={bed_id:2,check_in:'2026-10-10',expected_bed_id:1,expected_check_in:'2026-10-10',expected_check_out:'2026-10-13'};
test('move sends one atomic request with expected source state',async()=>{
  let calls=0;
  const move=load(async(name,args)=>{
    calls++; assert.equal(name,'reassign_booking_bed'); assert.equal(args.p_assignment_id,11);
    assert.equal(args.p_check_in,undefined); assert.equal(args.p_expected_check_out,'2026-10-13');
    return {data:{booking_bed_id:11,bed_id:2}};
  });
  assert.equal((await move('11',input)).bed_id,2); assert.equal(calls,1);
});
test('invalid move dates and IDs never reach the database',async()=>{
  const move=load(()=>{throw Error('Unexpected database call');});
  for(const patch of [{bed_id:0},{bed_id:'2'},{check_in:'2026-02-30'},{expected_check_in:null},{expected_check_out:'2026-10-09'}]) {
    await assert.rejects(move(11,{...input,...patch}),error=>error.status===400);
  }
  await assert.rejects(move('bad',input),error=>error.status===400);
});
test('conflicts and stale assignments return clear errors without fallback updates',async()=>{
  const move=load(async()=>({error:{code:'P0001',message:'This bed is occupied. Nothing was moved.'}}));
  await assert.rejects(move(11,input),error=>error.status===409 && /occupied/.test(error.message));
});

test('date changes and unconfirmed exchanges never reach the database',async()=>{
  const move=load(()=>{throw Error('Unexpected database call');});
  await assert.rejects(move(11,{...input,check_in:'2026-10-11'}),/Edit Booking/);
  await assert.rejects(move(11,{...input,swap_assignment_id:12}),/Confirm/);
});
test('confirmed exchanges include both expected stays',async()=>{
  const move=load(async(name,args)=>{
    assert.equal(args.p_swap_assignment_id,12); assert.equal(args.p_confirm_swap,true);
    assert.equal(args.p_swap_check_out,'2026-10-14');return {data:{swapped:true}};
  });
  assert.equal((await move(11,{...input,swap_assignment_id:12,swap_check_in:'2026-10-11',swap_check_out:'2026-10-14',confirm_swap:true})).swapped,true);
});
