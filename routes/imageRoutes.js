const express = require('express');
const { createImage, getAllImages, updateImage, deleteImage, getImage } = require('../controllers/imageController');

const router = express.Router();

router.post('/images', createImage); // create a new image
router.get('/images', getAllImages); // get all images
router.put('/images/:id', updateImage);  // update image by ID
router.delete('/images/:id', deleteImage); // delete image by ID
router.get('/images/:id', getImage); // get image by ID

module.exports = router;
