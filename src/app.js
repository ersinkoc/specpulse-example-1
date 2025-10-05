const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const config = require('./shared/config/environment');
const securityMiddleware = require('./auth/middleware/securityMiddleware');

// Import routes
const healthRoutes = require('./routes/health');
const taskRoutes = require('./routes/tasks');
const authRoutes = require('./auth/routes/authRoutes');
const oauthRoutes = require('./auth/routes/oauthRoutes');
const userRoutes = require('./auth/routes/userRoutes');
const preferencesRoutes = require('./routes/preferences');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { apiRateLimit, taskRateLimit } = require('./middleware/rateLimit');
const {
  securityMiddleware,
  sanitizeInput,
  validateRequest,
  validateApiKey,
  validateContentType,
  validateRequestSize,
  helmet
} = require('./middleware/security');

const app = express();

// Session middleware for OAuth
app.use(session({
  secret: config.security.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.server.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Security middleware
app.use(helmet());
app.use(securityMiddleware);
app.use(validateRequestSize);
app.use(validateRequest);

// Apply IP blocking to all routes
app.use(securityMiddleware.createIpBlocker());

// CORS middleware
app.use(cors({
  origin: config.security.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Apply general rate limiting
app.use(securityMiddleware.createApiLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests
}));

// API key validation (if required)
app.use(validateApiKey);

// Logging middleware
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Input sanitization
app.use(sanitizeInput);

// Content type validation
app.use(validateContentType);

// Health check endpoint
app.use('/health', healthRoutes);

// API routes with stricter rate limiting for task operations
app.use('/tasks', taskRateLimit, taskRoutes);

// Authentication routes
app.use('/auth', authRoutes);
app.use('/oauth', oauthRoutes);
app.use('/user', userRoutes);

// Notification preferences routes
app.use('/api/preferences', preferencesRoutes);

// Notification management routes
app.use('/api/notifications', notificationsRoutes);

// Admin routes
app.use('/api/admin', adminRoutes);

// Serve uploaded files (avatars, etc.)
app.use('/uploads', express.static('uploads'));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.originalUrl} not found`
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Export app for use with server.js and WebSocket integration
module.exports = app;