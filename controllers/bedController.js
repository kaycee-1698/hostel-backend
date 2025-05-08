const { supabase } = require('../utils/supabase'); // Ensure correct import

const createBed = async (req, res) => {
  const { room_id,
    bed_name,
    status
     } = req.body;

  // Insert new bed into the 'beds' table
  const { data, error } = await supabase
    .from('beds')
    .insert([{
      room_id,
      bed_name,
      status
    }])
    .single(); // Use .single() to return a single object

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(201).json({ bed: data });
};

const getAllBeds = async (req, res) => {
  // Get all beds from the 'beds' table
  const { data, error } = await supabase
    .from('beds')
    .select('*'); // Select all columns

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(200).json({ beds: data });
};

// Update Bed
const updateBed = async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
  
    const { data, error } = await supabase
      .from('beds')
      .update(updateData)
      .eq('bed_id', id);
  
    if (error) return res.status(500).json({ message: error.message });
  
    res.status(200).json({ message: "Bed updated successfully", data });
  };
  
  // Delete Bed
  const deleteBed = async (req, res) => {
    const { id } = req.params;
  
    const { data, error } = await supabase
      .from('beds')
      .delete()
      .eq('bed_id', id);
  
    if (error) return res.status(500).json({ message: error.message });
  
    res.status(200).json({ message: "Bed deleted successfully", data });
  };
  
  const getBed = async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('beds').select('*').eq('bed_id', id).single(); 
  
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json(data);
  };

module.exports = { createBed, getAllBeds, updateBed, deleteBed, getBed };