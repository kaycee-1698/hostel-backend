const { createBookingService, getAllBookingsService, getBookingService, updateBookingService, deleteBookingService, getBookingsByBedAndDateRangeService } = require('../services/bookingService');

const createBooking = async (req, res) => {
  try {
    const response = await createBookingService(req.body);
    return res.status(200).json(response);
  } catch (error) {
    console.error('createBooking error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

const getAllBookings = async (req, res) => {
  try {
    const response = await getAllBookingsService(req.query);
    return res.status(200).json(response);
  } catch (error) {
    console.error('getAllBookings error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

const getBooking = async (req, res) => {
  try {
    const response = await getBookingService(req.params.id);
    return res.status(200).json(response);
  } catch (error) {
    console.error('getBooking error:', error);
    return res.status(400).json({ error: error.message || 'Bad Request' });
  }
};

const updateBooking = async (req, res) => {
  try {
    const response = await updateBookingService(req.params.id, req.body);
    return res.status(200).json(response);
  } catch (error) {
    console.error('updateBooking error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

const deleteBooking = async (req, res) => {
  try {
    const response = await deleteBookingService(req.params.id);
    return res.status(200).json(response);
  } catch (error) {
    console.error('deleteBooking error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

const getBookingsByBedAndDateRange = async (req, res) => {
  try {
    const response = await getBookingsByBedAndDateRangeService(req.query);
    return res.status(200).json(response);
  } catch (error) {
    console.error('getBookingsByBedAndDateRange error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  createBooking,
  getAllBookings,
  getBooking,
  updateBooking,
  deleteBooking,
  getBookingsByBedAndDateRange
};
