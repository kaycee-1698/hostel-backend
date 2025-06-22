const { supabase } = require('../supabase');
const { validateBookingData } = require('./validateBookingData');
const { checkAvailability } = require('./availability');

const preBookingChecks = async(bookingData) => {
  const { guests_per_room, check_in, check_out } = bookingData;

  // 1. Validate shape and logic of booking data
  const validationError = validateBookingData(bookingData);
  if (validationError) {
    console.error(`Validation Error: ${validationError}`);
    throw new Error(`${validationError}`);
  }

  // 2. Check bed availability per room
  for (const roomId in guests_per_room) {
    const bedsRequired = guests_per_room[roomId];
    const isAvailable = await checkAvailability(
      parseInt(roomId),
      check_in,
      check_out,
      bedsRequired
    );

    if (isAvailable <= 0) {
      //Fetch room name
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('room_name')
        .eq('room_id', roomId)
        .single();

      const roomName = room?.room_name || `Room ${roomId}`;
      throw new Error(`${roomName} does not have ${bedsRequired} available bed(s) for the selected dates.`);
    }
  }
  return true; // All checks passed
}

module.exports = {
  preBookingChecks
};
