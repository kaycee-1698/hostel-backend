const validateBookingData = (data) => {
  const requiredFields = [
    'guest_name',
    'check_in',
    'check_out',
    'ota_name',
    'base_amount',
    'payment_received',
    'room_id',
    'beds_required',
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

  if (isNaN(Number(data.beds_required)) || data.beds_required <= 0) {
    return 'Beds required must be a positive number.';
  }

  return null; // no errors
};

module.exports = { validateBookingData };
