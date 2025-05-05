const express = require('express');
const { createPayment, getAllPayments, updatePayment, deletePayment, getPayment } = require('../controllers/paymentController');

const router = express.Router();

router.post('/payments', createPayment); // create a new payment
router.get('/payments', getAllPayments); // get all payments
router.put('/payments/:id', updatePayment);  // update payment by ID
router.delete('/payments/:id', deletePayment); // delete payment by ID
router.get('/payments/:id', getPayment); // get payment by ID

module.exports = router;
