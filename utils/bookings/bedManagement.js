const { supabase } = require('../supabase');

const assignBeds = async (
  booking_id,
  booking_room_id,
  room_id,
  number_of_guests,
  check_in,
  check_out
) => {
  const { data: beds, error } = await supabase
    .from('beds')
    .select('bed_id')
    .eq('room_id', room_id);

  if (error) 
  {
    console.error(error.message);
    throw new Error(`Error fetching beds.`);
  }

  const bedIds = beds.map((b) => b.bed_id);

  // Check which of these beds are already occupied
  const { data: occupied, error: overlapError } = await supabase
    .from('booking_beds')
    .select('bed_id')
    .in('bed_id', bedIds)
    .or(`and(check_in.lt.${check_out},check_out.gt.${check_in})`);

  if (overlapError) 
  {
    console.error(overlapError.message);
    throw new Error(`Error checking occupied beds.`);
  }

  const occupiedBedIds = new Set(occupied.map((b) => b.bed_id));
  const availableBeds = bedIds.filter((id) => !occupiedBedIds.has(id));

  if (availableBeds.length < number_of_guests) {
    throw new Error('Not enough available beds to assign.');
  }

  const bedsToAssign = availableBeds.slice(0, number_of_guests); // ✅ LIMIT to number of guests

  const assignments = bedsToAssign.map((bed_id) => ({
    booking_id,
    booking_room_id,
    bed_id,
    check_in,
    check_out,
    assigned_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString(), // Adjust for IST timezone
  }));

  const { error: assignError } = await supabase
    .from('booking_beds')
    .insert(assignments);

  if (assignError) 
  {
    console.error(assignError.message);
    throw new Error(`Error assigning beds.`);
  }
};

const deleteBookingAssignments = async (booking_id) => {
  // Delete booking_beds first (child)
  const { error: bedDeleteError } = await supabase
    .from('booking_beds')
    .delete()
    .eq('booking_id', booking_id);

  if (bedDeleteError) {
    console.error(`[deleteBookingAssignments] Failed to delete booking_beds:`, bedDeleteError.message);
    throw new Error('Error deleting bed assignments');
  }

  // Delete booking_rooms next (parent)
  const { error: roomDeleteError } = await supabase
    .from('booking_rooms')
    .delete()
    .eq('booking_id', booking_id);

  if (roomDeleteError) {
    console.error(`[deleteBookingAssignments] Failed to delete booking_rooms:`, roomDeleteError.message);
    throw new Error('Error deleting room assignments');
  }
};

module.exports = {
  assignBeds,
  deleteBookingAssignments,
};
