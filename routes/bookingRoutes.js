const express = require('express');
const { createBooking, getAllBookings, updateBooking, deleteBooking, getBooking, getBookingByCheckIn } = require('../controllers/bookingController');

const router = express.Router();

router.post('/bookings', createBooking); // create a new booking
router.get('/bookings', getAllBookings); // get all bookings
router.put('/bookings/:id', updateBooking);  // update booking by ID
router.delete('/bookings/:id', deleteBooking); // delete booking by ID
router.get('/bookings/:id', getBooking); // get booking by ID

module.exports = router;
