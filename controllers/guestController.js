const { supabase } = require('../utils/supabase'); // Ensure correct import

const { createGuestService } = require('../services/guestService');

const createGuest = async (req, res) => {
  try {
    const guest = await createGuestService(req.body);
    return res.status(201).json({ guest });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

const getAllGuests = async (req, res) => {
  // Get all guests from the 'guests' table
  const { data, error } = await supabase
    .from('guests')
    .select('*'); // Select all columns

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(200).json({ guests: data });
};

// Update Guest
const updateGuest = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  const { data, error } = await supabase
    .from('guests')
    .update(updateData)
    .eq('guest_id', id);

  if (error) return res.status(500).json({ message: error.message });
  
  res.status(200).json({ message: "Guest updated successfully", data });
};

// Delete Guest
const deleteGuest = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('guests')
    .delete()
    .eq('guest_id', id);

  if (error) return res.status(500).json({ message: error.message });

  res.status(200).json({ message: "Guest deleted successfully", data });
};

const getGuest = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('guests').select('*').eq('guest_id', id).single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
};


module.exports = { createGuest, getAllGuests, updateGuest, deleteGuest, getGuest };