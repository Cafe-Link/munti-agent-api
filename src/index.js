const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { PORT } = require('./config/constants');
const weatherRoutes = require('./routes/weatherRoutes');
const weatherV2Routes = require('./routes/weatherV2Routes');
const ragRoutes = require('./routes/ragRoutes');
const ingestionRoutes = require('./routes/ingestionRoutes');
const authRoutes = require('./routes/authRoutes');
const videoRoutes = require('./routes/videoRoutes');
const videoV2Routes = require('./routes/videoV2Routes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// Keep process alive explicitly
const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

// Middlewares
app.use(cors());
app.use(express.json());
// Detailed logging format
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));

// Custom Request Logger for even more visibility
app.use((req, res, next) => {
  if (req.url !== '/health') {
    console.log(`[${new Date().toLocaleTimeString()}] HTTP ${req.method} ${req.url}`);
  }
  next();
});

// Routes
console.log("Initializing Agent Routes...");
app.use('/api/agents/weather', weatherRoutes);
app.use('/api/agents/weather/v2', weatherV2Routes);
app.use('/api/agents/rag', ragRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/video-oracle-v2', videoV2Routes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Backend API' });
});

// Root route for quick verification
app.get('/', (req, res) => {
  res.send('Backend API Server is Running!');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("EXPRESS ERROR:", err.message);
  console.error(err.stack);
  res.status(500).json({ status: 'error', message: 'Something broke!', error: err.message });
});

console.log(`Attempting to listen on port ${PORT}...`);

const server = app.listen(PORT, () => {
  console.log(`
================================================
🚀 Backend Server is ACTIVE
📡 Port: ${PORT}
🔗 Health Check: http://localhost:${PORT}/health
================================================
Logs will appear here...
`);
});

server.on('error', (e) => {
  console.error("SERVER LISTEN ERROR:", e);
  process.exit(1);
});


