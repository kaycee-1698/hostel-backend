const { supabase } = require('../utils/supabase'); // Ensure correct import

const createGuest = async (req, res) => {
  const { first_name, last_name, birthday, email, phone, city, country, gender, travelling_as, purpose_of_visit, how_heard_about_us, stayed_before, id_type, id_number, agree_tnc, agree_checkout, booking_id } = req.body;

  // Insert new guest into the 'guests' table
  const { data, error } = await supabase
    .from('guests')
    .insert([{
      created_at: new Date(), // Optional: If you want to handle this explicitly
      first_name, 
      last_name, 
      birthday, 
      email, 
      phone, 
      city, 
      country, 
      gender, 
      travelling_as, 
      purpose_of_visit, 
      how_heard_about_us, 
      stayed_before, 
      id_type, 
      id_number, 
      agree_tnc, 
      agree_checkout,
      booking_id
    }])
    .single(); // Use .single() to return a single object

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(201).json({ guest: data });
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