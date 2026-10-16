const { supabase } = require('../utils/supabase');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
async function moveBedAssignment(id, input = {}) {
  const assignmentId = Number(id);
  if (!Number.isSafeInteger(assignmentId) || assignmentId <= 0 ||
    !Number.isSafeInteger(input.bed_id) || input.bed_id <= 0 ||
    !Number.isSafeInteger(input.expected_bed_id) || input.expected_bed_id <= 0 ||
    !validDate(input.check_in) || !validDate(input.expected_check_in) || !validDate(input.expected_check_out) ||
    input.expected_check_out <= input.expected_check_in) {
    const error = new Error('A valid assignment, bed and stay dates are required.'); error.status = 400; throw error;
  }
  if (input.check_in !== input.expected_check_in) {
    const error = new Error('Change dates through Edit Booking. Dragging only changes beds.'); error.status = 400; throw error;
  }
  if (input.swap_assignment_id != null && (!Number.isSafeInteger(input.swap_assignment_id) || input.swap_assignment_id <= 0 ||
      input.confirm_swap !== true || !validDate(input.swap_check_in) || !validDate(input.swap_check_out) || input.swap_check_out <= input.swap_check_in)) {
    const error = new Error('Confirm the exchange with valid details for the other booking.'); error.status = 400; throw error;
  }
  const {data, error} = await supabase.rpc('reassign_booking_bed', {
    p_assignment_id: assignmentId, p_bed_id: input.bed_id,
    p_expected_bed_id: input.expected_bed_id, p_expected_check_in: input.expected_check_in,
    p_expected_check_out: input.expected_check_out,
    p_swap_assignment_id: input.swap_assignment_id ?? null,
    p_swap_check_in: input.swap_check_in ?? null, p_swap_check_out: input.swap_check_out ?? null,
    p_confirm_swap: input.confirm_swap === true,
  });
  if (error) {
    const failure = new Error(error.code === 'P0001' ? error.message : 'Could not move this assignment. Ensure migration 006 is installed, then refresh and try again.');
    failure.status = error.code === 'P0001' ? 409 : 500; throw failure;
  }
  return data;
}
module.exports = { moveBedAssignment };
