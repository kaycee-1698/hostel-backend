const { supabase } = require('../utils/supabase');
const dayjs = require('dayjs');

// Utility Functions
const calculateCommission = (ota_name, base_amount) => {
  if (['Booking.com', 'Hostelworld'].includes(ota_name)) {
    return parseFloat((base_amount * 0.15).toFixed(2));
  }
  return 0;
};

const calculateGST = (ota_name, base_amount) => {
  if (['Booking.com', 'Hostelworld'].includes(ota_name)) {
    return parseFloat((base_amount * 0.12).toFixed(2));
  }
  return 0;
};

const calculatePendingAmount = (base_amount, gst, payment_received) => {
  return base_amount + gst - payment_received;
};

const calculatePaymentStatus = (pending_amount, base_amount, gst) => {
  const total = base_amount + gst;
  if (Math.abs(pending_amount) < 5) return 'Paid';
  if (pending_amount === total) return 'Pending Payment';
  return 'Part-Payment';
};

const calculateBank = (ota_name) => {
  return ['Direct', 'Extension'].includes(ota_name) ? 'Secondary' : 'Primary';
};

const updatePaymentAndBank = async (booking_id, ota_name, payment_received, base_amount) => {
  const commission = calculateCommission(ota_name, base_amount);
  const gst = calculateGST(ota_name, base_amount);
  const pending_amount = calculatePendingAmount(base_amount, gst, payment_received);
  const payment_status = calculatePaymentStatus(pending_amount, base_amount, gst);
  const bank = calculateBank(ota_name);

  const { error } = await supabase
    .from('bookings')
    .update({
      payment_received,
      pending_amount,
      payment_status,
      bank,
      commission,
      gst
    })
    .eq('booking_id', booking_id);

  if (error) throw new Error(error.message);
};

// Create Booking
const createBooking = async (req, res) => {
  try {
    const {
      booking_name,
      ota_name,
      number_of_adults,
      check_in,
      check_out,
      base_amount,
      payment_received = 0,
      contact_number,
      other_info
    } = req.body;

    // Validate required fields
    if (!booking_name || !ota_name || !number_of_adults || !check_in || !check_out || !base_amount) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const baseAmount = Number(base_amount);
    const paymentReceived = Number(payment_received);
    const checkInDate = dayjs(check_in);
    const checkOutDate = dayjs(check_out);

    if (!checkInDate.isValid() || !checkOutDate.isValid()) {
      return res.status(400).json({ message: "Invalid check-in or check-out date format." });
    }

    if (checkOutDate.isBefore(checkInDate)) {
      return res.status(400).json({ message: "Check-out date cannot be before check-in date." });
    }

    if (isNaN(baseAmount) || baseAmount <= 0 || isNaN(paymentReceived) || paymentReceived < 0) {
      return res.status(400).json({ message: "Invalid amount values." });
    }

    const number_of_nights = checkOutDate.diff(checkInDate, 'day');
    const commission = calculateCommission(ota_name, baseAmount);
    const gst = calculateGST(ota_name, baseAmount);
    const pending_amount = calculatePendingAmount(baseAmount, gst, paymentReceived);
    const payment_status = calculatePaymentStatus(pending_amount, baseAmount, gst);
    const bank = calculateBank(ota_name);

    const bookingData = {
      booking_name,
      ota_name,
      number_of_adults,
      check_in,
      check_out,
      number_of_nights,
      base_amount: baseAmount,
      commission,
      gst,
      payment_received: paymentReceived,
      pending_amount,
      payment_status,
      bank,
      contact_number,
      other_info
    };

    const { data, error } = await supabase
      .from('bookings')
      .insert([bookingData])
      .single();

    if (error) {
      return res.status(500).json({ message: error.message });
    }

    res.status(201).json(data);
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ message: "Server error while creating booking." });
  }
};

// Get All Bookings and get Booking By Check-In Date
const getAllBookings = async (req, res) => {
  const { check_in } = req.query;
  if (check_in) {
    // getBookingByCheckIn logic
    console.log("Filtering by check-in:", check_in);
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('check_in', check_in);

    if (error) return res.status(400).json({ message: error.message });
    return res.status(200).json({ bookings: data });
  } 
  else
  {
    // getAllBookings logic
    const { data, error } = await supabase.from('bookings').select('*');
    if (error) return res.status(500).json({ message: error.message });
    return res.status(200).json({ bookings: data });
  }

};

// Get Single Booking
const getBooking = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('bookings').select('*').eq('booking_id', id).single();
  if (error) return res.status(400).json({ message: error.message });
  res.json(data);
};

// Update Booking
const updateBooking = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  const { data, error } = await supabase
    .from('bookings')
    .update(updateData)
    .eq('booking_id', id);

  if (error) return res.status(500).json({ message: error.message });

  if (updateData.payment_received !== undefined || updateData.base_amount !== undefined) {
    await updatePaymentAndBank(
      id,
      updateData.ota_name,
      Number(updateData.payment_received),
      Number(updateData.base_amount)
    );
  }

  res.status(200).json({ message: "Booking updated successfully", data });
};

// Delete Booking
const deleteBooking = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('bookings').delete().eq('booking_id', id);
  if (error) return res.status(500).json({ message: error.message });
  res.status(200).json({ message: "Booking deleted successfully", data });
};

module.exports = {
  createBooking,
  getAllBookings,
  getBooking,
  updateBooking,
  deleteBooking
};
