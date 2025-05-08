//handles room-level assignments for a booking.

const { supabase } = require('../utils/supabase');

// POST /booking-rooms - Assign a room to a booking (when booking is created/edited)
const assignRoomToBooking = async (req, res) => {
  const { booking_id, room_id } = req.body;
  const { data, error } = await supabase
      .from('booking_rooms')
      .insert([{
        booking_id,
        room_id,
        assigned_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString() // Adjust for IST timezone
      }])
      .single(); // Use .single() to return a single object
  
    if (error) {
      return res.status(500).json({ message: error.message });
    }  
    res.status(201).json({ booking_rooms: data });
};

// GET /booking-rooms/:bookingId - Get all rooms assigned for a booking.
const getRoomsForBooking = async (req, res) => {
  const { bookingId } = req.params;
  const { data, error } = await supabase.from('booking_rooms').select('*').eq('booking_id', bookingId); 
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json(data);
};

// DELETE /booking-rooms/:id - Remove room from booking (along with cascade delete of booking_beds)
const removeRoomFromBooking = async (req, res) => {
    const { id } = req.params;
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid or missing booking Room Id' });
    }
  
    try {
      // Check if any beds exist for this booking_room_id
      const { data: existingBeds, error: fetchError } = await supabase
        .from('booking_beds')
        .select('booking_bed_id')
        .eq('booking_room_id', parseInt(id));
  
      if (fetchError) {
        console.error('Error checking existing booking beds:', fetchError);
        return res.status(500).json({ error: 'Failed to check booking beds' });
      }
  
      // If beds exist, delete them
      if (existingBeds && existingBeds.length > 0) {
        const { error: bedsError } = await supabase
          .from('booking_beds')
          .delete()
          .eq('booking_room_id', parseInt(id));
  
        if (bedsError) {
          console.error('Error deleting booking beds:', bedsError);
          return res.status(500).json({ error: 'Failed to delete booking beds' });
        }
      }
  
      // Delete the room assignment
      const { error: roomError } = await supabase
        .from('booking_rooms')
        .delete()
        .eq('booking_room_id', parseInt(id));
  
      if (roomError) {
        console.error('Error deleting booking room:', roomError);
        return res.status(500).json({ error: 'Failed to delete booking room' });
      }
  
      return res.status(204).send();
    } catch (err) {
      console.error('Unexpected error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
  

module.exports = {
  assignRoomToBooking,
  getRoomsForBooking,
  removeRoomFromBooking
};