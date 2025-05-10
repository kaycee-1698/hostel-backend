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
      other_info,
      guests_per_room, // { "1": 2, "2": 1, "3": 1 }
    } = req.body;

    const rooms = Object.keys(guests_per_room);

    if (!booking_name || !ota_name || !number_of_adults || !check_in || !check_out || !base_amount || !rooms.length) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const baseAmount = Number(base_amount);
    const paymentReceived = Number(payment_received);
    const checkInDate = dayjs(check_in);
    const checkOutDate = dayjs(check_out);
    const number_of_nights = checkOutDate.diff(checkInDate, 'day');

    if (!checkInDate.isValid() || !checkOutDate.isValid() || checkOutDate.isBefore(checkInDate)) {
      return res.status(400).json({ message: "Invalid or conflicting dates." });
    }

    if (isNaN(baseAmount) || baseAmount <= 0 || isNaN(paymentReceived) || paymentReceived < 0) {
      return res.status(400).json({ message: "Invalid payment values." });
    }

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

    // Insert booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert([bookingData])
      .select()
      .single();

    if (bookingError || !booking) {
      console.error("Booking insert failed:", bookingError, booking);
      return res.status(500).json({ message: bookingError?.message || "Booking insert returned null." });
    }

    const bookingBedInserts = [];

    for (const roomId of rooms) {
      const guestCount = guests_per_room[roomId];

      // Insert booking_room
      const { data: bookingRoom, error: bookingRoomError } = await supabase
        .from('booking_rooms')
        .insert([{ booking_id: booking.booking_id, room_id: Number(roomId) }])
        .select()
        .single();

      if (bookingRoomError) return res.status(500).json({ message: bookingRoomError.message });

      // Fetch beds in room
      const { data: bedsInRoom, error: bedsError } = await supabase
        .from('beds')
        .select('bed_id')
        .eq('room_id', roomId);

      if (bedsError) return res.status(500).json({ message: bedsError.message });

      // Fetch occupied beds in date range
      const { data: occupiedBeds, error: occupiedError } = await supabase
      .from('booking_beds')
      .select('bed_id')
      .in('bed_id', bedsInRoom.map(b => b.bed_id))
      .gt('check_out', new Date(checkInDate + 5.5 * 60 * 60 * 1000).toISOString())
      .lt('check_in', new Date(checkOutDate + 5.5 * 60 * 60 * 1000).toISOString());


      if (occupiedError) {
        console.error(`Error fetching occupied beds for room ${roomId}:`, occupiedError.message);
        return res.status(500).json({ message: occupiedError.message });
      }

      const occupiedBedIds = new Set(occupiedBeds.map(b => b.bed_id));
      const availableBeds = bedsInRoom.filter(b => !occupiedBedIds.has(b.bed_id));

      if (availableBeds.length < guestCount) {
        console.warn(`Not enough available beds in room ${roomId}. Needed: ${guestCount}, Available: ${availableBeds.length}`);
        return res.status(400).json({ message: `Not enough beds in room ${roomId}` });
      }

      // Assign beds
      const bedsToAssign = availableBeds.slice(0, guestCount);

      for (const bed of bedsToAssign) {
        bookingBedInserts.push({
          booking_id: booking.booking_id,
          booking_room_id: bookingRoom.booking_room_id,
          bed_id: bed.bed_id,
          check_in,
          check_out
        });
      }

    }

    // Insert all assigned beds
    const { error: bookingBedsError } = await supabase
      .from('booking_beds')
      .insert(bookingBedInserts);

    if (bookingBedsError) return res.status(500).json({ message: bookingBedsError.message });

    res.status(201).json({ message: "Booking created and beds assigned", data: booking });

  } catch (error) {
    console.error("Error in createBooking:", error);
    res.status(500).json({ message: "Server error during booking creation." });
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

// Get Bookings mapped by bed and date
const getBookingsByBedAndDateRange = async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: "startDate and endDate are required" });
  }

  console.log("Start date" + startDate);
  console.log("End date" + endDate);

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      booking_id,
      booking_name,
      check_in,
      check_out,
      booking_rooms (
        booking_room_id,
        room_id,
        booking_beds (
          bed_id
        )
      )
    `)
    .or(`and(check_in.lte.${endDate},check_out.gte.${startDate})`);

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  const bookingsByBedAndDate = {};

  data.forEach((booking) => {
    const { booking_name, check_in, check_out, booking_rooms } = booking;
    const checkIn = new Date(check_in);
    const checkOut = new Date(check_out);

    for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];

      booking_rooms?.forEach((room) => {
        room.booking_beds?.forEach((bed) => {
          const bedId = bed.bed_id;
          if (!bookingsByBedAndDate[bedId]) bookingsByBedAndDate[bedId] = {};
          bookingsByBedAndDate[bedId][dateKey] = booking_name;
        });
      });
    }
  });

  return res.status(200).json(bookingsByBedAndDate);
};

module.exports = {
  createBooking,
  getAllBookings,
  getBooking,
  updateBooking,
  deleteBooking,
  getBookingsByBedAndDateRange
};
