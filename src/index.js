const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { PORT } = require('./config/constants');
const weatherRoutes = require('./routes/weatherRoutes');
const weatherV2Routes = require('./routes/weatherV2Routes');
const ragRoutes = require('./routes/ragRoutes');
const ingestionRoutes = require('./routes/ingestionRoutes');
const authRoutes = require('./routes/authRoutes');
const videoRoutes = require('./routes/videoRoutes');
const videoV2Routes = require('./routes/videoV2Routes');
const adminRoutes = require('./routes/adminRoutes');
const constants = require('./config/constants');
const { connectRedis } = require('./config/redis');
const { config } = require('dotenv');

const app = express();

// Initialize Redis
// connectRedis();


// Keep process alive explicitly
const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

// Middlewares
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = constants.CORS_ORIGIN || [];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Also allow localhost unconditionally for local dev
      if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
         callback(null, true);
      } else {
         callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true
}));
app.use(cookieParser());
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

const server = app.listen(PORT, async () => {
  const { redisClient } = require('./config/redis');
  // Wait a small amount of time or just check status if connectRedis was called earlier
  const redisStatus = redisClient.isOpen ? 'CONNECTED ✅' : 'DISCONNECTED ❌';
  
  console.log(`
================================================
🚀 Backend Server is ACTIVE
📡 Port: ${PORT}
🔗 Health Check: http://localhost:${PORT}/health
📦 Redis Status: ${redisStatus}
================================================
Logs will appear here...
`);
});

server.on('error', (e) => {
  console.error("SERVER LISTEN ERROR:", e);
  process.exit(1);
});
