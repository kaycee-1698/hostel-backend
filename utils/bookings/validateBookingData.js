const validateBookingData = (data) => {
  const requiredFields = [
    'booking_name',
    'check_in',
    'check_out',
    'ota_name',
    'base_amount'
  ];

  for (const field of requiredFields) {
    if (!data[field] && data[field] !== 0) {
      return `Missing required field: ${field}`;
    }
  }

  const checkIn = new Date(data.check_in);
  const checkOut = new Date(data.check_out);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.check_in) || !/^\d{4}-\d{2}-\d{2}$/.test(data.check_out) ||
      Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime()) ||
      checkIn.toISOString().slice(0, 10) !== data.check_in || checkOut.toISOString().slice(0, 10) !== data.check_out) {
    return 'Valid check-in and check-out dates are required.';
  }
  if (checkOut <= checkIn) {
    return 'Check-out date must be after check-in date.';
  }

  if (!Number.isFinite(data.base_amount) || !Number.isFinite(data.payment_received) || data.base_amount < 0 || data.payment_received < 0) {
    return 'Amounts must be non-negative numbers.';
  }

  if ( !Number.isSafeInteger(data.number_of_adults) || data.number_of_adults <= 0 || data.number_of_adults > 1000) {
    return 'Number of Adults must be a whole number between 1 and 1000.';
  }

  if (
    !data.guests_per_room ||
    typeof data.guests_per_room !== 'object' ||
    Array.isArray(data.guests_per_room) ||
    Object.keys(data.guests_per_room).length === 0
  ) {
    console.error('guests_per_room must be a non-empty object with room IDs and number of guests.');
    return 'Guests must be correctly assigned to rooms.';
  }

  let allocated = 0;
  for (const [roomId, guests] of Object.entries(data.guests_per_room)) {
    if (!/^[1-9][0-9]*$/.test(roomId) || !Number.isSafeInteger(guests) || guests <= 0) {
      return 'Room allocations must use positive whole numbers.';
    }
    allocated += guests;
  }
  if (allocated !== data.number_of_adults) return 'Room allocations must match the number of adults.';

  return null; // no errors
};

module.exports = { validateBookingData };
