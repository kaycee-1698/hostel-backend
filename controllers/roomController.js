const { supabase } = require('../utils/supabase'); // Ensure correct import
const { getRoomAvailabilityService } = require('../services/roomService'); // Import the service

const createRoom = async (req, res) => {
  let details;
  try { details = require('../services/roomCatalogue').roomDetails(req.body||{}); }
  catch(error){ return res.status(400).json({error:error.message}); }

  // Insert new room into the 'rooms' table
  const { data, error } = await supabase
    .from('rooms')
    .insert([{
      ...details, capacity:0
    }])
    .select().single(); // Use .single() to return a single object

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(201).json({ room: data });
};

const getAllRooms = async (req, res) => {
  // Get all rooms from the 'rooms' table
  const { data, error } = await supabase
    .from('rooms')
    .select('*, beds(*)'); // Select all columns and beds with relation

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(200).json({ rooms: data.map(room=>require('../services/roomCatalogue').decorateRoom(supabase,room)) });
};

// Update Room
const updateRoom = async (req, res) => {
    const { id } = req.params;
    let updateData;
    try {updateData=require('../services/roomCatalogue').roomDetails(req.body||{},true);}
    catch(error){return res.status(400).json({error:error.message});}
    if(!Object.keys(updateData).length)return res.status(400).json({error:'No room changes supplied.'});
  
    const { data, error } = await supabase
      .from('rooms')
      .update(updateData)
      .eq('room_id', id).select().maybeSingle();
  
    if (error) return res.status(error.code==='P0001'?409:500).json({ error:error.code==='P0001'?error.message:'Could not save room details. Please try again.' });
  
    if(!data)return res.status(404).json({error:'Room not found. Refresh and try again.'});
    res.status(200).json({ message: "Room updated successfully", data });
  };
  
// Delete Room and its Beds
const deleteRoom = async (req, res) => {
  const { id } = req.params;

  // First, delete all beds with this room_id
  const { error: bedDeleteError } = await supabase
    .from('beds')
    .delete()
    .eq('room_id', id);

  if (bedDeleteError) {
    return res.status(500).json({ message: `Error deleting beds: ${bedDeleteError.message}` });
  }

  // Then, delete the room
  const { data: roomData, error: roomDeleteError } = await supabase
    .from('rooms')
    .delete()
    .eq('room_id', id);

  if (roomDeleteError) {
    return res.status(500).json({ message: `Error deleting room: ${roomDeleteError.message}` });
  }

  res.status(200).json({
    message: "Room and its beds deleted successfully",
    data: roomData
  });
};
  
  const getRoom = async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('rooms').select('*, beds(*)').eq('room_id', id).single(); 
  
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json(require('../services/roomCatalogue').decorateRoom(supabase,data));
  };

  const updateRoomCapacity = async (req, res) => {
    const roomId = parseInt(req.params.roomId, 10);
    if (isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }
  
    // 1. Fetch all beds for the given room
    const { data: beds, error: bedsError } = await supabase
      .from('beds')
      .select('bed_id')
      .eq('room_id', roomId);
  
    if (bedsError) {
      console.error('Error fetching beds:', bedsError);
      return res.status(500).json({ error: 'Failed to fetch beds' });
    }
  
    const newCapacity = beds.length;
  
    // 2. Update the room's capacity
    const { error: updateError } = await supabase
      .from('rooms')
      .update({ capacity: newCapacity })
      .eq('room_id', roomId);
  
    if (updateError) {
      console.error('Error updating room capacity:', updateError);
      return res.status(500).json({ error: 'Failed to update room capacity' });
    }
  
    return res.status(200).json({ capacity: newCapacity });
  };  

  const getRoomAvailability = async (req, res) => {
    const { id } = req.params;
    const { 
      check_in, 
      check_out, 
      beds_required, 
      exclude_booking_id = null // Default to null if not provided
    } = req.query;
    try {
      const response = await getRoomAvailabilityService(id, check_in, check_out, beds_required, exclude_booking_id);
      return res.status(200).json(response);
    } catch (error) {
      console.error('getRoomAvailability error:', error);
      return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  };

module.exports = { createRoom, getAllRooms, updateRoom, deleteRoom, getRoom, updateRoomCapacity, getRoomAvailability };