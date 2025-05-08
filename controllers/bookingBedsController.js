//handles individual bed assignments (and reassignments).

const { supabase } = require('../utils/supabase');

// POST /booking-beds - Assign a bed to a booking (when booking is created/edited)
const assignBedToBookingRoom = async (req, res) => {
    const { booking_room_id, 
        bed_id
       } = req.body;
  
    const { data, error } = await supabase
      .from('booking_beds')
      .insert([{
        booking_room_id,
        bed_id,
        assigned_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString() // Adjust for IST timezone
      }])
      .single(); // Use .single() to return a single object
  
    if (error) {
      return res.status(500).json({ message: error.message });
    }
  
    res.status(201).json({ booking_beds: data });
  };
  
  // GET /booking-beds/:bookingId - Get all bed assignments for a booking.
  const getBedsForBooking = async (req, res) => {
    const { bookingId } = req.params;
  
    try {
      const { data, error } = await supabase
        .from('booking_beds')
        .select('*, booking_rooms!inner(booking_id)')
        .eq('booking_rooms.booking_id', bookingId);
  
      if (error) throw error;  
      res.json(data);
    } catch (error) {
      console.error('Error fetching booking beds:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };  
  
  
  // PUT /booking-beds/:id - Reassign bed (e.g. drag & drop in calendar UI).
  const reassignBed = async (req, res) => {
    const { id } = req.params;
    const { bed_id } = req.body;
  
    try {
      const { data, error } = await supabase
        .from('booking_beds')
        .update({ bed_id })
        .eq('booking_bed_id', id)
        .select()
        .single();
  
      if (error) throw error;
  
      res.json(data);
    } catch (error) {
      console.error('Error reassigning bed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  
  
  // DELETE /booking-beds/:id - Unassign a specific bed.
  const unassignBed = async (req, res) => {
    const { id } = req.params;
  
    try {
      const { error } = await supabase
        .from('booking_beds')
        .delete()
        .eq('booking_bed_id', id);
  
      if (error) throw error;
  
      res.status(204).send();
    } catch (error) {
      console.error('Error unassigning bed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  

  module.exports = {
    assignBedToBookingRoom,
    getBedsForBooking,
    reassignBed,
    unassignBed
  };
  