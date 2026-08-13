require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
const { startWeatherWorker } = require('./workers/weatherIngest');

app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"]
    }
  }
}));
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const DB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/drainpulse';
mongoose.connect(DB_URI)
  .then(() => {
    console.log('[DB] Connected to MongoDB:', DB_URI);
    startWeatherWorker();
  })
  .catch(err => { console.error('[DB] Connection failed:', err.message); process.exit(1); });

app.set('io', io);

const ingestRouter = require('./routes/ingest');
const nodesRouter = require('./routes/nodes');
const predictionsRouter = require('./routes/predictions');
const reportsRouter = require('./routes/reports');
const telemetryRouter = require('./routes/telemetry');
const ticketsRouter = require('./routes/tickets');
const crewsRouter = require('./routes/crews');
const simulatorRouter = require('./routes/simulator');

app.use('/api/v1/ingest', ingestRouter);
app.use('/api/v1/nodes', nodesRouter);
app.use('/api/v1/predictions', predictionsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/telemetry', telemetryRouter);
app.use('/api/v1/tickets', ticketsRouter);
app.use('/api/v1/crews', crewsRouter);
app.use('/api/v1/simulator', simulatorRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

io.on('connection', socket => {
  console.log('[WS] Client connected:', socket.id);
  socket.on('disconnect', () => console.log('[WS] Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const os = require('os');

httpServer.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  let local = '';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) local = net.address;
    }
  }
  console.log(`[SERVER] DrainPulse running on http://${HOST}:${PORT}`);
  if (local) console.log(`[NETWORK] Local access: http://${local}:${PORT}`);
});

module.exports = { app, io };
