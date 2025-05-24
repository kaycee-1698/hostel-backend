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
  if (checkOut <= checkIn) {
    return 'Check-out date must be after check-in date.';
  }

  if (data.base_amount < 0 || data.payment_received < 0) {
    return 'Amounts must be non-negative numbers.';
  }

  if (isNaN(Number(data.number_of_adults)) || data.number_of_adults <= 0) {
    return 'Number of Adults must be a positive number.';
  }

  if (
    !data.guests_per_room ||
    typeof data.guests_per_room !== 'object' ||
    Object.keys(data.guests_per_room).length === 0
  ) {
    console.error('guests_per_room must be a non-empty object with room IDs and number of guests.');
    return 'Guests must be correctly assigned to rooms.';
  }

  return null; // no errors
};

module.exports = { validateBookingData };
