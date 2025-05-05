const { supabase } = require('../utils/supabase'); // Ensure correct import

const createImage = async (req, res) => {
  const { guest_id, image_type, imageURL } = req.body;

  // Insert new image into the 'images' table
  const { data, error } = await supabase
    .from('images')
    .insert([{
      guest_id, image_type, imageURL
    }])
    .single(); // Use .single() to return a single object

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(201).json({ image: data });
};

const getAllImages = async (req, res) => {
  // Get all images from the 'images' table
  const { data, error } = await supabase
    .from('images')
    .select('*'); // Select all columns

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(200).json({ images: data });
};

// Update Image
const updateImage = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  const { data, error } = await supabase
    .from('images')
    .update(updateData)
    .eq('image_id', id);

  if (error) return res.status(500).json({ message: error.message });

  res.status(200).json({ message: "Image updated successfully", data });
};

// Delete Image
const deleteImage = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('images')
    .delete()
    .eq('image_id', id);

  if (error) return res.status(500).json({ message: error.message });

  res.status(200).json({ message: "Image deleted successfully", data });
};

const getImage = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('images').select('*').eq('image_id', id).single(); 

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
};

module.exports = { createImage, getAllImages, updateImage, deleteImage, getImage };