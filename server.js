const express = require('express');
const { createClient } = require('@supabase/supabase-js'); // Import Supabase
const app = express();
const port = 5000;

// Initialize Supabase with your project URL and anon key
const supabaseUrl = 'https://aupnfgmemqcywixggkrb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1cG5mZ21lbXFjeXdpeGdna3JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU3NjQ1MTMsImV4cCI6MjA2MTM0MDUxM30.GyPAS3jTFWI4Iy3a5SRHNrLJGzIRx-VEVUy9FK3oKp4';
const supabase = createClient(supabaseUrl, supabaseKey);

const cors = require("cors");
app.use(cors()); //Enable cors

app.use(express.json()); // To read JSON body from frontend

// Create API route to add a guest
app.post('/guests', async (req, res) => {
    const { name, email } = req.body;
  
    // Insert guest into the Supabase table
    const { data, error } = await supabase
      .from('guests')
      .insert([{ name, email }]);
  
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    res.status(201).json({ message: 'Guest added successfully!', data });
  });  

// Test endpoint
app.get('/', (req, res) => {
  res.send('Backend is working! 🚀');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
