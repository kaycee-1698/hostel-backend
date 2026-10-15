const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadService(rpc) {
  const sandbox = {
    module: { exports: {} }, console,
    require(name) {
      if (name === '../utils/supabase') return { supabase: {
        rpc,
        from() { throw new Error('Reassignment must never use separate table writes'); },
      } };
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/bookingService.js'), 'utf8'), sandbox);
  return sandbox.module.exports.updateBookingService;
}

test('reassignment uses one atomic RPC and returns the updated booking', async () => {
  const saved = { booking_id: 7, booking_name: 'Updated' };
  let calls = 0;
  const update = loadService(async (name, args) => {
    calls++;
    assert.equal(name, 'update_booking_with_assignments');
    assert.equal(args.p_booking_id, 7);
    assert.equal(args.p_updates.booking_name, 'Updated');
    assert.equal(args.p_updates.requiresReassignment, undefined);
    assert.equal(args.p_updates.guests_per_room, undefined);
    assert.equal(args.p_guests_per_room[2], 1);
    return { data: saved, error: null };
  });
  assert.equal(await update(7, {
    booking_name: 'Updated', requiresReassignment: true, guests_per_room: { 2: 1 },
  }), saved);
  assert.equal(calls, 1);
});

test('full-room or database errors propagate without destructive fallback writes', async () => {
  for (const message of ['Room 2 does not have 1 available bed(s)', 'Function not installed', 'Insert failed']) {
    const update = loadService(async () => ({ data: null, error: { message } }));
    await assert.rejects(update(7, { requiresReassignment: true, guests_per_room: { 2: 1 } }),
      { message });
  }
});

test('missing allocations are sent as null for transactional validation', async () => {
  const update = loadService(async (_, args) => {
    assert.equal(args.p_guests_per_room, null);
    return { error: { message: 'Guests must be assigned to rooms' } };
  });
  await assert.rejects(update(7, { requiresReassignment: true }),
    { message: 'Guests must be assigned to rooms' });
});
