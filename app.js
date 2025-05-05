//Configuration of Express app, middleware, and routing.

const express = require('express'); //framework for building backend application. Handles HTTP requests (GET, POST, etc.)
const cors = require("cors"); //middleware for enabling CORS (Cross-Origin Resource Sharing) 
const app = express(); //create an instance of express application

app.use(cors()); //Enable cors
app.use(express.json()); //Parse incoming JSON requests

// Routes to handle specific API requests
const bedRoutes = require('./routes/bedRoutes'); 
const bookingRoutes = require('./routes/bookingRoutes');
const guestRoutes = require('./routes/guestRoutes');
const imageRoutes = require('./routes/imageRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

app.use(bedRoutes);
app.use(bookingRoutes);
app.use(guestRoutes);
app.use(imageRoutes);
app.use(paymentRoutes);

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: err.message });
});

module.exports = app;