const { supabase } = require('../utils/supabase'); // Ensure correct import

const createPayment = async (req, res) => {
  const { guest_id,
    booking_id,
    payment_date,
    amount_paid,
    mode,
    remarks
} = req.body;

  // Insert new payment into the 'payments' table
  const { data, error } = await supabase
    .from('payments')
    .insert([{
        guest_id,
        booking_id,
        payment_date,
        amount_paid,
        mode,        
      ...(remarks && { remarks }), // Only include remarks if it exists
    }])
    .single(); // Use .single() to return a single object

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(201).json({ payment: data });
};

const getAllPayments = async (req, res) => {
  // Get all payments from the 'payments' table
  const { data, error } = await supabase
    .from('payments')
    .select('*'); // Select all columns

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(200).json({ payments: data });
};

// Update Payment
const updatePayment = async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
  
    const { data, error } = await supabase
      .from('payments')
      .update(updateData)
      .eq('payment_id', id);
  
    if (error) return res.status(500).json({ message: error.message });
  
    res.status(200).json({ message: "Payment updated successfully", data });
  };
  
  // Delete Payment
  const deletePayment = async (req, res) => {
    const { id } = req.params;
  
    const { data, error } = await supabase
      .from('payments')
      .delete()
      .eq('payment_id', id);
  
    if (error) return res.status(500).json({ message: error.message });
  
    res.status(200).json({ message: "Payment deleted successfully", data });
  };

  const getPayment = async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('payments').select('*').eq('payment_id', id).single(); 
  
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json(data);
  };  

module.exports = { createPayment, getAllPayments, updatePayment, deletePayment, getPayment };