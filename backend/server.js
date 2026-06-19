// TLS 1.2 is forced via --tls-min-v1.2 --tls-max-v1.2 flags (see package.json scripts).
// TLS cert verification is only disabled in development.
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

require('dotenv').config();

/* ── Validate environment configuration ── */
const { validateEnv } = require('./config/envValidator');
validateEnv();

const path = require('path');
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const http         = require('http');
const { Server }   = require('socket.io');
const { connectPG, poolHealth } = require('./config/db');
require('./config/redis');   // triggers auto-connect on startup; graceful quit on SIGTERM below
const autoSeed = require('./scripts/autoSeed');
const { ensureBaseIndexes } = require('./services/soacData');
const { errorHandler } = require('./middleware/errorHandler');

const CLIENT_ORIGIN = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true,
  },
});
app.set('io', io);

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('No token provided'));
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    socket.userEmail = decoded.email;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.userId} (${socket.id})`);
  
  socket.on('basketball:join', ({ scoreId }) => {
    if (!scoreId) return;
    socket.join(`match:${scoreId}`);
  });
  socket.on('basketball:leave', ({ scoreId }) => {
    if (!scoreId) return;
    socket.leave(`match:${scoreId}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.userId}`);
  });
});

/* ── Security headers ── */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow /uploads to be served cross-origin
}));

/* ── CORS ── */
app.use(cors({
  origin:      CLIENT_ORIGIN,
  credentials: true,
  maxAge:      3600, // Cache preflight requests for 1 hour
}));

/* ── Response compression ── */
const compression = require('compression');
app.use(compression());

/* ── Global rate limiter ── */
const isDev = process.env.NODE_ENV !== 'production';
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500, // Same for dev/prod; allows testing rate limiting behavior locally
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests — please try again later.' },
}));

/* ── Stricter rate limiter on auth endpoints: 20 req / 15 min per IP ── */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts — please try again in 15 minutes.' },
});

/* ── Body parsers ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ── Static uploads ── */
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ── Routes ── */
app.use('/api/auth',          authLimiter, require('./routes/auth.routes'));
app.use('/api/clubs',         require('./routes/clubs.routes'));
app.use('/api/events',        require('./routes/events.routes'));
app.use('/api/users',         require('./routes/users.routes'));
app.use('/api/requests',      require('./routes/requests.routes'));
app.use('/api/messages',      require('./routes/messages.routes'));
app.use('/api/news-feed',     require('./routes/newsFeed.routes'));
app.use('/api/announcements', require('./routes/announcements.routes'));
app.use('/api/fame',          require('./routes/fame.routes'));
app.use('/api/calendar',       require('./routes/calendar.routes'));
app.use('/api/event-requests',  require('./routes/eventRequests.routes'));
app.use('/api/club-proposals',  require('./routes/clubProposals.routes'));




/* ── Admin: test email (admin token required) ── */
app.post('/api/admin/test-email', require('./middleware/auth').verifyToken, async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin only.' });
  const to = req.body.to || req.user.email;
  const result = await require('./config/email').sendTestEmail(to);
  res.json({ ...result, sentTo: to });
});

/* ── Health check — always 200 so Railway healthcheck passes ── */
app.get('/api/health', async (req, res) => {
  const pgOk = await poolHealth().catch(() => false);
  let redisStatus = 'unknown';
  try {
    const pong = await require('./config/redis').ping().catch(() => null);
    redisStatus = pong === 'PONG' ? 'ok' : 'error';
  } catch (_) {
    redisStatus = 'error';
  }
  res.json({
    status: 'ok',
    ts: new Date(),
    postgres: pgOk ? 'ok' : 'down',
    redis: redisStatus,
  });
});

/* ── Global error handler ── */
app.use(errorHandler);

/* ── Crash guards — prevent silent process death ── */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

/* ── Graceful shutdown ── */
const shutdown = async () => {
  const redis = require('./config/redis');
  await redis.quit().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

/* ── Start: listen FIRST so Railway healthcheck can reach the server,
         then initialise DB / seed in the background ── */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀  SOAC API listening on port ${PORT}`);

  // DB init runs after the port is open so healthchecks don't time out
  (async () => {
    await connectPG();
    await autoSeed();
    await ensureBaseIndexes();
    console.log('✅  DB initialisation complete');
  })().catch(err => {
    console.error('❌  DB initialisation failed:', err.message);
    process.exit(1);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌  Port ${PORT} is already in use.`);
  } else {
    console.error('❌  Server error:', err.message);
  }
  process.exit(1);
});
