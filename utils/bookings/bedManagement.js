const { supabase } = require('../supabase');

const assignBeds = async (booking_id, room_id, beds_required, check_in, check_out) => {
  const { data: beds, error } = await supabase
    .from('beds')
    .select('bed_id')
    .eq('room_id', room_id);

  if (error) throw new Error('Error fetching beds.');

  const bedIds = beds.map((b) => b.bed_id);

  // Fetch already occupied beds in date range
  const { data: occupied, error: overlapError } = await supabase
    .from('bed_assignments')
    .select('bed_id')
    .in('bed_id', bedIds)
    .or(`and(check_in,lte.${check_out},check_out,gte.${check_in})`);

  if (overlapError) throw new Error('Error checking occupied beds.');

  const occupiedBedIds = new Set(occupied.map((b) => b.bed_id));
  const availableBeds = bedIds.filter((id) => !occupiedBedIds.has(id)).slice(0, beds_required);

  if (availableBeds.length < beds_required) {
    throw new Error('Not enough available beds to assign.');
  }

  const assignments = availableBeds.map((bed_id) => ({
    booking_id,
    bed_id,
    check_in,
    check_out,
  }));

  const { error: assignError } = await supabase
    .from('bed_assignments')
    .insert(assignments);

  if (assignError) throw new Error('Error assigning beds.');
};

module.exports = { assignBeds };
