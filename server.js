//Entry point for starting the server

const app = require('./app');
const port = process.env.PORT || 5000;

// Test endpoint
app.get('/', (req, res) => {
  res.send('Backend is working! 🚀');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
