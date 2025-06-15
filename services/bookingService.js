const { supabase } = require('../utils/supabase');
const { preBookingChecks } = require('../utils/bookings/preBookingChecks');
const { calculateFinancials } = require('../utils/bookings/financials');
const { assignBeds, deleteBookingAssignments } = require('../utils/bookings/bedManagement');
const { insertBooking } = require('../utils/bookings/insertBookings');

const createBookingService = async (bookingData) => {
  const {
    guests_per_room,
    number_of_adults,
    base_amount,
    payment_received,
    ota_name,
    check_in,
    check_out,
    ...rest
  } = bookingData;

  try {
    await preBookingChecks(bookingData);
  } catch (err) {
    console.error(`Pre-booking check failed: ${err.message}`);
    throw new Error(`${err.message}`);
  }

  const financials = calculateFinancials(bookingData);
  const number_of_nights = Math.ceil(
    (new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24)
  );

  const booking = await insertBooking(
    { ...rest, guests_per_room, number_of_adults, base_amount, payment_received, ota_name, check_in, check_out },
    financials,
    number_of_nights
  );

  const booking_id = booking.booking_id;

  const bookingRoomInserts = Object.entries(guests_per_room).map(
    ([room_id, number_of_guests]) => ({
      booking_id,
      room_id: parseInt(room_id),
      number_of_guests: parseInt(number_of_guests),
      assigned_at: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString()
    })
  );

  const { data: insertedRooms, error: bookingRoomError } = await supabase
    .from('booking_rooms')
    .insert(bookingRoomInserts)
    .select();

  if (bookingRoomError) 
  {
    console.error(`Failed to insert booking_rooms: ${bookingRoomError.message}`);
    throw new Error(`Error while assigning rooms for this booking`);
  }

  for (const room of insertedRooms) {
    try {
      await assignBeds(
        booking_id,
        room.booking_room_id,
        room.room_id,
        room.number_of_guests,
        check_in,
        check_out
      );
    } catch (err) {
      console.error(`Failed to assign beds for room ${room.room_id}: ${err.message}`);
      throw new Error(`Error while assigning beds for this booking`);
    }
  }

  return booking;
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

  // 2. Perform the actual update
  const { data: updatedBookings, error } = await supabase
    .from('bookings')
    .update(sanitizedData)
    .eq('booking_id', id)
    .select('*');

  if (error) {
    console.error(`❌ Error updating booking:`, error.message);
    throw new Error(`Could not update the booking`);
  }

  const updatedBooking = updatedBookings?.[0];

  // 3. Bed reassignment if flagged
  const guestsPerRoom = guests_per_room;

  if (requiresReassignment && updatedBooking && guestsPerRoom && typeof guestsPerRoom === 'object') {

    await deleteBookingAssignments(id);

    for (const [roomId, numberOfGuests] of Object.entries(guestsPerRoom)) {
      const room_id = parseInt(roomId); // Ensure it's a number

      // Insert booking_room
      const { data: newRoom, error: roomInsertError } = await supabase
        .from('booking_rooms')
        .insert({
          booking_id: id,
          room_id,
          number_of_guests: numberOfGuests,
        })
        .select()
        .single();

      if (roomInsertError) {
        console.error(`❌ Failed to insert new booking_room for room_id ${room_id}:`, roomInsertError.message);
        throw new Error('Error re-adding booking room');
      }
      await assignBeds(
        id,
        newRoom.booking_room_id,
        room_id,
        numberOfGuests,
        updatedBooking.check_in,
        updatedBooking.check_out
      );
    }
  }
  return updatedBooking;
};

const deleteBookingService = async (id) => {
  const { data, error } = await supabase.from('bookings').delete().eq('booking_id', id);
  if (error)
  {
    console.error(error.message);
    throw new Error(`Could not delete the booking`);
  }
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
    .or(`and(check_in.lte.${endDate},check_out.gte.${startDate})`)

  if (error)
  {
    console.error(error.message);
    throw new Error(`Could not fetch bookings for this date range`);
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