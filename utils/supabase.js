//Connects to Supabase and exports the client to interact with the database.
 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Backend-only credential. Never expose this key in frontend environment variables.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };