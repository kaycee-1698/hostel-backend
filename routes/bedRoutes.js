const express = require('express');
const { createBed, getAllBeds, updateBed, deleteBed, getBed } = require('../controllers/bedController');

const router = express.Router();

router.post('/beds', createBed); // create a new bed
router.get('/beds', getAllBeds); // get all beds
router.put('/beds/:id', updateBed);  // update bed by ID
router.delete('/beds/:id', deleteBed); // delete bed by ID
router.get('/beds/:id', getBed); // get bed by ID

module.exports = router;
