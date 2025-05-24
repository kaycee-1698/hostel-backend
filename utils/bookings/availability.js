const { supabase } = require('../supabase');

const checkAvailability = async (room_id, check_in, check_out, beds_required) => {
  const { data: beds, error } = await supabase
    .from('beds')
    .select('bed_id')
    .eq('room_id', room_id);

  if (error)
  {
    console.error(error.message);
    throw new Error(`Failed to fetch beds.`);
  }
  if (!beds || beds.length === 0) return false;

  const bedIds = beds.map((bed) => bed.bed_id);

  // Fetch bookings that clash with the given dates
  const { data: overlappingBookings, error: bookingError } = await supabase
    .from('booking_beds')
    .select('bed_id')
    .in('bed_id', bedIds)
    .gt('check_out', check_in)
    .lt('check_in', check_out);

  if (bookingError) 
  {
    console.error(bookingError.message);
    throw new Error(`Error checking availability.`);
  }

  const occupiedBedIds = new Set(overlappingBookings.map((b) => b.bed_id));
  const availableBeds = bedIds.filter((id) => !occupiedBedIds.has(id));

  return availableBeds.length >= beds_required;
};

module.exports = { checkAvailability };
