const express = require('express');
const router = express.Router();
const bookingBedsController = require('../controllers/bookingBedsController');

router.post('/booking-beds', bookingBedsController.assignBedToBookingRoom);
router.get('/booking-beds/:bookingId', bookingBedsController.getBedsForBooking);
router.put('/booking-beds/:id', bookingBedsController.reassignBed);
router.delete('/booking-beds/:id', bookingBedsController.unassignBed);

module.exports = router;