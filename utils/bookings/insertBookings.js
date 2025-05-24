const { supabase } = require('../supabase');

const insertBooking = async (bookingData, financials, number_of_nights) => {
  const {
    guests_per_room, // Exclude this from being spread
    number_of_adults,
    base_amount,
    payment_received,
    ota_name,
    check_in,
    check_out,
    ...rest
  } = bookingData;

  const { data, error } = await supabase
    .from('bookings')
    .insert([
      {
        ...rest, // This will no longer contain guests_per_room
        number_of_adults,
        base_amount,
        payment_received,
        number_of_nights,
        ota_name,
        check_in,
        check_out,
        ...financials,
      },
    ])
    .select()
    .single();

  if (error || !data) 
  {
    console.error(`Insert Booking Failed: ${error.message}`);
    throw new Error(`Could not insert booking`);
  }
  
  return data;
};


module.exports = { insertBooking };