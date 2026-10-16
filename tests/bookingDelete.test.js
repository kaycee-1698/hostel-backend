const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(rpc) {
  const scope = {module:{exports:{}},console,require:name => name === '../utils/supabase' ? {supabase:{rpc,from(){throw Error('Non-atomic deletion');}}} : {}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../services/bookingService.js','utf8'),scope);
  return scope.module.exports.deleteBookingService;
}
test('deletion uses one atomic call with validated booking ID', async () => {
  let calls = 0;
  const remove = load(async (name,args) => {
    calls++; assert.equal(name,'delete_booking_with_assignments'); assert.equal(args.p_booking_id,117);
    return {data:{deleted:true}};
  });
  assert.equal((await remove('117')).deleted,true);
  await assert.rejects(remove('invalid'), /Invalid booking ID/);
  assert.equal(calls,1);
});
test('deletion preserves clear linked-guest explanation without fallback writes', async () => {
  const remove = load(async () => ({error:{code:'P0001',message:'This booking has guest check-in records and cannot be deleted.'}}));
  await assert.rejects(remove(117), /guest check-in records/);
});
