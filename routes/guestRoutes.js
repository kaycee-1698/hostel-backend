const express = require('express');
const { createGuest, getAllGuests, updateGuest, deleteGuest, getGuest } = require('../controllers/guestController');

const router = express.Router();

router.post('/guests', createGuest); // create a new guest
router.get('/guests', getAllGuests); // get all guests
router.put('/guests/:id', updateGuest);  // update guest by ID
router.delete('/guests/:id', deleteGuest); // delete guest by ID
router.get('/guests/:id', getGuest); // get guest by ID

module.exports = router;
