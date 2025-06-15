const { supabase } = require('../supabase');
const { commissionRates, gstRates, banks } = require('./constants');

const calculateCommission = (otaName, baseAmount) => {
  const rate = commissionRates[otaName] ?? commissionRates['Other'];
  return Math.round(baseAmount * rate);
};

const calculateGST = (otaName, baseAmount) => {
  const rate = gstRates[otaName] ?? gstRates['Other'];
  return Math.round(baseAmount * rate);
};

const calculatePendingAmount = (baseAmount, gst, paymentReceived) => {
  return baseAmount + gst - paymentReceived;
};

const calculatePaymentStatus = (pendingAmount, baseAmount, gst) => {
  if (pendingAmount <= 5) return 'Paid';
  if (pendingAmount === baseAmount + gst) return 'Unpaid';
  return 'Part-Payment';
};

const calculateBank = (otaName) => {
    const bankName = banks[otaName] ?? banks['Other'];
    return bankName;
};

// ✅ Master function
const calculateFinancials = (bookingData) => {
  const { ota_name, base_amount, payment_received } = bookingData;

  const commission = calculateCommission(ota_name, base_amount);
  const gst = calculateGST(ota_name, base_amount);
  const pending_amount = calculatePendingAmount(base_amount, gst, payment_received);
  const payment_status = calculatePaymentStatus(pending_amount, base_amount, gst);
  const bank = calculateBank(ota_name);

  return {
    commission,
    gst,
    pending_amount,
    payment_status,
    bank,
  };
};

module.exports = {
  calculateCommission,
  calculateGST,
  calculatePendingAmount,
  calculatePaymentStatus,
  calculateBank,
  calculateFinancials,
};
