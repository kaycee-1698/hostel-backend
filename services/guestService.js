const { randomUUID } = require('node:crypto');
const { supabase } = require('../utils/supabase');

const BUCKET = 'guest-documents';
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_FIELDS = ['id_front', 'id_back', 'signature'];
const GUEST_FIELDS = ['first_name', 'last_name', 'birthday', 'email', 'phone', 'city',
  'country', 'gender', 'travelling_as', 'purpose_of_visit', 'how_heard_about_us',
  'stayed_before', 'id_type', 'id_number', 'agree_tnc', 'agree_checkout', 'booking_id'];

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function decodeImage(value, field) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4 + 64) {
    throw invalid(`${field}: image must be a JPEG or PNG no larger than 5 MB.`);
  }
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw invalid(`${field}: invalid JPEG or PNG image.`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== match[2]) {
    throw invalid(`${field}: invalid image or image exceeds 5 MB.`);
  }
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((match[1] === 'image/png' && !png) || (match[1] === 'image/jpeg' && !jpeg)) {
    throw invalid(`${field}: file content does not match its image type.`);
  }
  return { bytes, contentType: match[1], extension: png ? 'png' : 'jpg' };
}

async function createGuestService(input) {
  if (!input || typeof input.first_name !== 'string' || !input.first_name.trim()) {
    throw invalid('First name is required.');
  }
  if (!Number.isSafeInteger(input.booking_id) || input.booking_id <= 0) {
    throw invalid('Select a valid booking before checking in.');
  }
  const guest = Object.fromEntries(GUEST_FIELDS.filter(key => input[key] !== undefined)
    .map(key => [key, input[key]]));
  if (guest.birthday === '') guest.birthday = null;
  // Validate every file before uploading anything.
  const documents = IMAGE_FIELDS.filter(key => input[key] != null && input[key] !== '')
    .map(key => ({ image_type: key, ...decodeImage(input[key], key) }));
  const requestId = randomUUID();
  const uploaded = [];
  try {
    for (const document of documents) {
      const objectPath = `${requestId}/${document.image_type}.${document.extension}`;
      const { error } = await supabase.storage.from(BUCKET).upload(objectPath, document.bytes,
        { contentType: document.contentType, upsert: false });
      if (error) throw new Error('Could not upload check-in documents. Please try again.');
      uploaded.push({ image_type: document.image_type, imageURL: `${BUCKET}/${objectPath}`, objectPath });
    }
  } catch (error) {
    // No database write has been attempted, so these objects cannot be referenced.
    if (uploaded.length) {
      try { await supabase.storage.from(BUCKET).remove(uploaded.map(file => file.objectPath)); }
      catch { /* A failed cleanup leaves private, unreferenced files for maintenance. */ }
    }
    throw error;
  }

  const { data, error } = await supabase.rpc('create_guest_with_images', {
    p_guest: guest,
    p_images: uploaded.map(({ image_type, imageURL }) => ({ image_type, imageURL })),
  });
  // Do not remove uploaded files here: a lost response can follow a committed RPC.
  if (error) throw new Error('Could not confirm guest check-in. Check the guest list before retrying.');
  if (!data?.guest_id) throw new Error('The database did not confirm guest check-in.');
  return data;
}

module.exports = { createGuestService, decodeImage };
