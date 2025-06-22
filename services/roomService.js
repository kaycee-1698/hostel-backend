const { checkAvailability } = require('../utils/bookings/availability');

const getRoomAvailabilityService = async (room_id, check_in, check_out, beds_required, exclude_booking_id) => {
    if (!room_id || !check_in || !check_out || !beds_required) {
        throw new Error("Missing required parameters");
    }
    const bedsRequired = parseInt(beds_required, 10);
    try {
        const availability = await checkAvailability(room_id, check_in, check_out, bedsRequired, exclude_booking_id);
        return availability;
    } catch (err) {
        console.error(`Availability check failed: ${err.message}`);
        throw new Error(`${err.message}`);
    }
}

module.exports = { getRoomAvailabilityService };