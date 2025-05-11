const { supabase } = require('../utils/supabase');
const {
  calculateCommission,
  calculateGST,
  calculatePendingAmount,
  calculatePaymentStatus,
  calculateBank,
} = require('../utils/bookings/financials');
const { validateBookingData } = require('../utils/bookings/validateBookingData');
const { assignBeds } = require('../utils/bookings/bedManagement');
const { checkAvailability } = require('../utils/bookings/availability');

const createBookingService = async (bookingData) => {
  // Validate fields and structure
  const validationError = validateBookingData(bookingData);
  if (validationError) throw new Error(validationError);

  const {
    base_amount,
    payment_received,
    ota_name,
    check_in,
    check_out,
    room_id,
    beds_required,
    ...rest
  } = bookingData;

  // Check availability
  const isAvailable = await checkAvailability(room_id, check_in, check_out, beds_required);
  if (!isAvailable) throw new Error('Beds not available for selected dates.');

  // Calculate financials
  const commission = calculateCommission(ota_name, base_amount);
  const gst = calculateGST(ota_name, base_amount);
  const pending_amount = calculatePendingAmount(base_amount, gst, payment_received);
  const payment_status = calculatePaymentStatus(pending_amount, base_amount, gst);
  const bank = calculateBank(ota_name);

  // Insert booking
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert([
      {
        ...rest,
        base_amount,
        payment_received,
        commission,
        gst,
        pending_amount,
        payment_status,
        bank,
        ota_name,
        check_in,
        check_out,
      },
    ])
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Assign beds
  await assignBeds(booking.booking_id, room_id, beds_required, check_in, check_out);

  return booking;
};

const getAllBookingsService = async (check_in) => {
  const query = check_in
    ? supabase.from('bookings').select('*').eq('check_in', check_in)
    : supabase.from('bookings').select('*');

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

const getBookingService = async (id) => {
  const { data, error } = await supabase.from('bookings').select('*').eq('booking_id', id).single();
  if (error) throw new Error(error.message);
  return data;
};

const updateBookingService = async (id, updateData) => {
  const { data, error } = await supabase.from('bookings').update(updateData).eq('booking_id', id);
  if (error) throw new Error(error.message);

  if (updateData.payment_received !== undefined || updateData.base_amount !== undefined) {
    await updatePaymentAndBank(
      id,
      updateData.ota_name,
      Number(updateData.payment_received),
      Number(updateData.base_amount)
    );
  }

  return data;
};

const deleteBookingService = async (id) => {
  const { data, error } = await supabase.from('bookings').delete().eq('booking_id', id);
  if (error) throw new Error(error.message);
  return data;
};

const getBookingsByBedAndDateRangeService = async (startDate, endDate) => {
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

  if (error) throw new Error(error.message);

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
          bookingsByBedAndDate[bedId][dateKey] = {
            booking_id: booking.booking_id,
            booking_name
          };
        });
      });
    }
  });

  return bookingsByBedAndDate;
};

module.exports = {
  createBookingService,
  getAllBookingsService,
  getBookingService,
  updateBookingService,
  deleteBookingService,
  getBookingsByBedAndDateRangeService
};