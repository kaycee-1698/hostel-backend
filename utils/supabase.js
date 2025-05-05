//Connects to Supabase and exports the client to interact with the database.
 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with project URL and anon key
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_API_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };