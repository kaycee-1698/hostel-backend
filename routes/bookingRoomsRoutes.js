const express = require('express');
const router = express.Router();
const bookingRoomsController = require('../controllers/bookingRoomsController');

router.post('/booking-rooms', bookingRoomsController.assignRoomToBooking);
router.get('/booking-rooms/:bookingId', bookingRoomsController.getRoomsForBooking);
router.delete('/booking-rooms/:id', bookingRoomsController.removeRoomFromBooking);

module.exports = router;
