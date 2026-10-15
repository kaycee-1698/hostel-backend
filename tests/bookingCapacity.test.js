const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { validateBookingData } = require('../utils/bookings/validateBookingData');

function loadModule(file, dependencies) {
  const sandbox = {
    module: { exports: {} },
    console: { error() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox);
  return sandbox.module.exports;
}

function makeChecks(available) {
  return loadModule('../utils/bookings/preBookingChecks.js', {
    '../supabase': { supabase: {
      from() { return this; }, select() { return this; }, eq() { return this; },
      async single() { return { data: { room_name: 'Dorm' } }; },
    } },
    './validateBookingData': { validateBookingData },
    './availability': { checkAvailability: async (roomId) => available[roomId] },
  }).preBookingChecks;
}

const booking = {
  booking_name: 'Capacity test', ota_name: 'Direct',
  check_in: '2026-10-20', check_out: '2026-10-22',
  base_amount: 1000, payment_received: 0,
  number_of_adults: 3, guests_per_room: { 1: 3 },
};

test('rejects three guests when only one bed is available', async () => {
  await assert.rejects(makeChecks({ 1: 1 })(booking), /Dorm does not have 3 available bed/);
});

test('accepts exact capacity and extra capacity', async () => {
  for (const count of [3, 4]) assert.equal(await makeChecks({ 1: count })(booking), true);
});

test('rejects fully occupied rooms and rooms without beds', async () => {
  // The availability helper currently returns false for rooms without beds.
  for (const count of [0, false]) {
    await assert.rejects(makeChecks({ 1: count })(booking), /does not have 3 available bed/);
  }
});

test('insufficient capacity in a later room stops creation before any writes', async () => {
  let writes = 0;
  const unexpectedWrite = () => { writes++; throw new Error('Unexpected write'); };
  const { createBookingService } = loadModule('../services/bookingService.js', {
    '../utils/supabase': { supabase: { from: unexpectedWrite } },
    '../utils/bookings/preBookingChecks': { preBookingChecks: makeChecks({ 1: 1, 2: 1 }) },
    '../utils/bookings/financials': { calculateFinancials: () => ({}) },
    '../utils/bookings/bedManagement': { assignBeds: unexpectedWrite },
    '../utils/bookings/insertBookings': { insertBooking: unexpectedWrite },
  });
  await assert.rejects(createBookingService({ ...booking, guests_per_room: { 1: 1, 2: 2 } }),
    /Dorm does not have 2 available bed/);
  assert.equal(writes, 0);
});
