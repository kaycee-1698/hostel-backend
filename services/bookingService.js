const { supabase } = require('../utils/supabase');
const { validateBookingData } = require('../utils/bookings/validateBookingData');
const { calculateFinancials } = require('../utils/bookings/financials');

const createBookingService = async (bookingData) => {
  const validation = validateBookingData(bookingData);
  if (validation) throw new Error(validation);
  const { guests_per_room, preferred_bed_id, create_request_id, ...details } = bookingData;
  if (typeof create_request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(create_request_id)) {
    throw new Error('A valid booking request ID is required. Refresh and try again.');
  }
  const { data, error } = await supabase.rpc('create_booking_once', {
    p_request_id: create_request_id,
    p_booking: { ...details, ...calculateFinancials(bookingData) },
    p_guests_per_room: guests_per_room,
    // Calendar clicks select a dorm, not a mandatory bed. Allocate for the full stay.
    p_preferred_bed_id: null,
  });
  if (error) {
    // Keep database diagnostics in server logs, never in the staff-facing form.
    console.error('Booking creation failed:', error);
    const message = error.message || '';
    if (error.code === 'P0001' && /does not have .* available bed/.test(message)) {
      throw new Error('There aren’t enough beds available in the selected dorm for the full stay. Choose another dorm or change the dates.');
    }
    if (error.code === 'P0001' && /already used for different|already created and later deleted/.test(message)) {
      throw new Error('This booking request was already processed. Close this form and check the bookings list before starting another.');
    }
    if (error.code === '42501' || /row-level security|permission denied/i.test(message)) {
      throw new Error('We couldn’t save the booking because of a system setup issue. Please ask your administrator to check booking permissions. Your entries are still here.');
    }
    throw new Error('We couldn’t confirm that the booking was saved. Please retry this same form; retrying will not create a duplicate.');
  }
  return data;
};

const getAllBookingsService = async (check_in) => {
  const query = check_in
    ? supabase.from('bookings').select('*').eq('check_in', check_in)
    : supabase.from('bookings').select('*');
  const { data, error } = await query;
  if (error) 
  {
    console.error(error.message);
    throw new Error(`Could not fetch bookings`);
  }
  return data;
};

const getBookingService = async (id) => {
  const { data, error } = await supabase.from('bookings').select('*').eq('booking_id', id).single();
  if (error)
  {
    console.error(error.message);
    throw new Error(`Could not fetch the required booking`);
  }
  return data;
};

const updateBookingService = async (id, updateData) => {
  const { requiresReassignment, guests_per_room, ...sanitizedData } = updateData;

  // 1. Financial and nights recalculation if needed
  const needsFinancialUpdate =
    sanitizedData.base_amount !== undefined || sanitizedData.payment_received !== undefined;

  if (needsFinancialUpdate) {
    const financials = calculateFinancials({
      ...sanitizedData,
      ota_name: sanitizedData.ota_name,
    });

    Object.assign(sanitizedData, financials);
  }

  const needsNightsUpdate =
    sanitizedData.check_in !== undefined || sanitizedData.check_out !== undefined;

  if (needsNightsUpdate) {
    sanitizedData.number_of_nights = Math.ceil(
      (new Date(sanitizedData.check_out) - new Date(sanitizedData.check_in)) / (1000 * 60 * 60 * 24)
    );
  }

  if (requiresReassignment || guests_per_room || needsNightsUpdate || sanitizedData.number_of_adults !== undefined) {
    // One RPC is one database transaction: errors roll back the booking AND beds.
    // Never fall back to separate writes if the migration has not been installed.
    const { data, error } = await supabase.rpc('update_booking_with_assignments', {
      p_booking_id: id,
      p_updates: sanitizedData,
      p_guests_per_room: guests_per_room ?? null,
    });
    if (error) {
      throw new Error(error.message || 'Could not update booking and bed assignments');
    }
    return data;
  }

  const { data: updatedBookings, error } = await supabase
    .from('bookings')
    .update(sanitizedData)
    .eq('booking_id', id)
    .select('*');

  if (error) throw new Error('Could not update the booking');
  return updatedBookings?.[0];
};

const deleteBookingService = async (id) => {
  const bookingId = Number(id);
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) throw new Error('Invalid booking ID');
  const { data, error } = await supabase.rpc('delete_booking_with_assignments', { p_booking_id: bookingId });
  if (error) {
    console.error('Booking deletion failed:', error);
    if (error.code === 'P0001') throw new Error(error.message);
    if (error.code === '23503') throw new Error('This booking has linked records and cannot be deleted.');
    throw new Error('Could not delete the booking. Check that database migration 003 is installed.');
  }
  return data;
};

const getBookingsByBedAndDateRangeService = async (startDate, endDate) => {
  const { data, error } = await supabase.from('booking_beds')
    .select('booking_bed_id, booking_id, bed_id, check_in, check_out, bookings!inner(booking_name)')
    .lte('check_in', endDate).gt('check_out', startDate);
  if (error) throw new Error('Could not fetch bookings for this date range');
  const calendarBookings = {};
  for (const assignment of data) {
    const { booking_bed_id, booking_id, bed_id, check_in, check_out } = assignment;
    const start = new Date(Math.max(Date.parse(check_in), Date.parse(startDate)));
    for (let date = start; date < new Date(check_out) && date <= new Date(endDate); date.setUTCDate(date.getUTCDate() + 1)) {
      const key = date.toISOString().slice(0, 10);
      calendarBookings[bed_id] ||= {};
      calendarBookings[bed_id][key] = {
        booking_bed_id, booking_id, booking_name: assignment.bookings.booking_name, check_in, check_out,
      };
    }
  }
  return { calendarBookings };
};

const getBookingWithRoomsAndBedsService = async (booking_id) => {

  // Step 1: Get main booking data
  const bookingData = await getBookingService(booking_id);

  // Step 2: Get booking_rooms and nested booking_beds + room/bed names
  const { data: bookingRooms, error: roomsError } = await supabase
    .from('booking_rooms')
    .select(`
      booking_room_id,
      room_id,
      rooms ( room_name ),
      booking_beds (
        booking_bed_id,
        bed_id,
        beds ( bed_name, room_id ),
        check_in,
        check_out
      )
    `)
    .eq('booking_id', booking_id);

  if (roomsError) 
    {
      console.error(roomsError.message);
      throw new Error('Rooms could not be fetched');
    }

  // Step 3: Format nested data
  const formattedRooms = bookingRooms.map((br) => ({
    booking_room_id: br.booking_room_id,
    room_id: br.room_id,
    room_name: br.rooms?.room_name || 'Unknown',
    beds: br.booking_beds.map((bb) => ({
      booking_bed_id: bb.booking_bed_id,
      bed_id: bb.bed_id,
      bed_name: bb.beds?.bed_name || 'Unknown',
      room_id: bb.beds?.room_id,
      check_in: bb.check_in,
      check_out: bb.check_out,
    })),
  }));

  return {
      ...bookingData,
      rooms: formattedRooms,
  };
};

module.exports = {
  createBookingService,
  getAllBookingsService,
  getBookingService,
  updateBookingService,
  deleteBookingService,
  getBookingsByBedAndDateRangeService,
  getBookingWithRoomsAndBedsService,
};