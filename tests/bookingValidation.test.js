const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBookingData } = require('../utils/bookings/validateBookingData');
const booking = { booking_name: 'Test', ota_name: 'Direct', check_in: '2026-10-20',
  check_out: '2026-10-22', base_amount: 100, payment_received: 0,
  number_of_adults: 1, guests_per_room: { 1: 1 } };

test('rejects invalid adults, dates, amounts and mismatched allocations', () => {
  assert.equal(validateBookingData(booking), null);
  for (const patch of [
    { number_of_adults: 1.5 }, { number_of_adults: -1 }, { number_of_adults: 1001 },
    { check_in: 'not-a-date' }, { check_in: '2026-02-30' },
    { base_amount: 'abc' }, { payment_received: NaN },
    { guests_per_room: { 1: 2 } }, { guests_per_room: { 1: -1 } },
  ]) assert.equal(typeof validateBookingData({ ...booking, ...patch }), 'string');
});
