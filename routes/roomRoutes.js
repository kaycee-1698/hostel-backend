const express = require('express');
const { createRoom, getAllRooms, updateRoom, deleteRoom, getRoom, updateRoomCapacity, getRoomAvailability } = require('../controllers/roomController');

const router = express.Router();

router.post('/rooms', createRoom); // create a new room
router.get('/rooms', getAllRooms); // get all rooms
router.put('/rooms/:id', updateRoom);  // update room by ID
router.delete('/rooms/:id', deleteRoom); // delete room by ID
router.get('/rooms/:id', getRoom); // get room by ID
router.put('/rooms/:roomId/update-capacity', updateRoomCapacity); // update room capacity by ID
router.get('/rooms/:id/availability', getRoomAvailability); // get room availability by ID

module.exports = router;
