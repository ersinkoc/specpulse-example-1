const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');
const config = require('../../shared/config/environment');
const logger = require('../../shared/utils/logger');

class SecurityMiddleware {
  constructor() {
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });

    this.redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    this.redisClient.on('connect', () => {
      logger.info('Redis connected for rate limiting');
    });
  }

  // General API rate limiting
  createApiLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redisClient.call(...args),
      }),
      windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
      max: options.max || 100, // limit each IP to 100 requests per windowMs
      message: {
        success: false,
        error: 'RateLimitExceeded',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil((options.windowMs || 15 * 60 * 1000) / 1000)
      },
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers
      keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress;
      },
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health';
      },
      onLimitReached: (req, res, options) => {
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          userAgent: req.get('User-Agent'),
          limit: options.max,
          windowMs: options.windowMs
        });
      }
    });
  }

  // Strict rate limiting for sensitive operations
  createStrictLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redisClient.call(...args),
      }),
      windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
      max: options.max || 5, // Very strict limit
      message: {
        success: false,
        error: 'StrictRateLimitExceeded',
        message: 'Too many attempts for this sensitive operation, please try again later.',
        retryAfter: Math.ceil((options.windowMs || 15 * 60 * 1000) / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        return `${req.ip}:${req.path}`;
      },
      onLimitReached: (req, res, options) => {
        logger.warn('Strict rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          userId: req.user?.id,
          userAgent: req.get('User-Agent')
        });
      }
    });
  }

  // Authentication-specific rate limiting
  createAuthLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redisClient.call(...args),
      }),
      windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
      max: options.max || 10, // 10 authentication attempts per 15 minutes
      message: {
        success: false,
        error: 'AuthRateLimitExceeded',
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: Math.ceil((options.windowMs || 15 * 60 * 1000) / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        // Use email + IP for login attempts to prevent account enumeration
        const email = req.body?.email || '';
        return `auth:${req.ip}:${email.toLowerCase()}`;
      },
      skipSuccessfulRequests: true, // Don't count successful requests
      onLimitReached: (req, res, options) => {
        logger.warn('Authentication rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          email: req.body?.email,
          userAgent: req.get('User-Agent')
        });
      }
    });
  }

  // Password reset rate limiting
  createPasswordResetLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redisClient.call(...args),
      }),
      windowMs: options.windowMs || 60 * 60 * 1000, // 1 hour
      max: options.max || 3, // 3 password reset requests per hour
      message: {
        success: false,
        error: 'PasswordResetRateLimitExceeded',
        message: 'Too many password reset attempts, please try again later.',
        retryAfter: Math.ceil((options.windowMs || 60 * 60 * 1000) / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const email = req.body?.email || '';
        return `password-reset:${email.toLowerCase()}`;
      },
      onLimitReached: (req, res, options) => {
        logger.warn('Password reset rate limit exceeded', {
          ip: req.ip,
          email: req.body?.email,
          userAgent: req.get('User-Agent')
        });
      }
    });
  }

  // Registration rate limiting
  createRegistrationLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redisClient.call(...args),
      }),
      windowMs: options.windowMs || 60 * 60 * 1000, // 1 hour
      max: options.max || 5, // 5 registrations per hour per IP
      message: {
        success: false,
        error: 'RegistrationRateLimitExceeded',
        message: 'Too many registration attempts from this IP, please try again later.',
        retryAfter: Math.ceil((options.windowMs || 60 * 60 * 1000) / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        return `registration:${req.ip}`;
      },
      onLimitReached: (req, res, options) => {
        logger.warn('Registration rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      }
    });
  }

  // Email verification rate limiting
  createEmailVerificationLimiter(options = {}) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => this.redisClient.call(...args),
      }),
      windowMs: options.windowMs || 60 * 60 * 1000, // 1 hour
      max: options.max || 5, // 5 verification attempts per hour
      message: {
        success: false,
        error: 'EmailVerificationRateLimitExceeded',
        message: 'Too many email verification attempts, please try again later.',
        retryAfter: Math.ceil((options.windowMs || 60 * 60 * 1000) / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        return `email-verification:${req.ip}`;
      },
      onLimitReached: (req, res, options) => {
        logger.warn('Email verification rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      }
    });
  }

  // IP-based blocking for suspicious activity
  createIpBlocker(options = {}) {
    const suspiciousStore = new Map();

    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();

      // Get or create IP tracking data
      let ipData = suspiciousStore.get(ip);
      if (!ipData) {
        ipData = {
          failedAttempts: 0,
          lastActivity: now,
          blockedUntil: 0
        };
        suspiciousStore.set(ip, ipData);
      }

      // Check if IP is currently blocked
      if (now < ipData.blockedUntil) {
        logger.warn('Blocked IP attempted access', {
          ip,
          path: req.path,
          blockedUntil: new Date(ipData.blockedUntil),
          userAgent: req.get('User-Agent')
        });

        return res.status(429).json({
          success: false,
          error: 'IpBlocked',
          message: 'Your IP has been temporarily blocked due to suspicious activity.',
          retryAfter: Math.ceil((ipData.blockedUntil - now) / 1000)
        });
      }

      // Reset counter if enough time has passed
      if (now - ipData.lastActivity > 60 * 60 * 1000) { // 1 hour
        ipData.failedAttempts = 0;
      }

      ipData.lastActivity = now;

      // Monitor the response to detect failed attempts
      const originalSend = res.send;
      res.send = function(data) {
        // Check for authentication failures
        if (res.statusCode === 401 || res.statusCode === 403) {
          ipData.failedAttempts++;

          // Block IP if too many failed attempts
          if (ipData.failedAttempts >= (options.maxFailedAttempts || 20)) {
            const blockDuration = Math.min(
              ipData.failedAttempts * 5 * 60 * 1000, // 5 minutes per failure
              24 * 60 * 60 * 1000 // Maximum 24 hours
            );

            ipData.blockedUntil = now + blockDuration;

            logger.warn('IP blocked due to suspicious activity', {
              ip,
              failedAttempts: ipData.failedAttempts,
              blockDuration,
              userAgent: req.get('User-Agent')
            });
          }
        }

        originalSend.call(this, data);
      };

      next();
    };
  }

  // Input validation middleware
  validateInput(schemas) {
    return (req, res, next) => {
      try {
        const { body, query, params } = schemas;

        if (body) {
          const validatedBody = body.parse(req.body);
          req.body = validatedBody;
        }

        if (query) {
          const validatedQuery = query.parse(req.query);
          req.query = validatedQuery;
        }

        if (params) {
          const validatedParams = params.parse(req.params);
          req.params = validatedParams;
        }

        next();
      } catch (error) {
        logger.warn('Input validation failed', {
          error: error.message,
          path: req.path,
          ip: req.ip,
          body: req.body,
          query: req.query,
          params: req.params
        });

        return res.status(400).json({
          success: false,
          error: 'ValidationError',
          message: 'Invalid input data',
          details: error.errors || error.message
        });
      }
    };
  }

  // Password strength validation
  validatePasswordStrength(req, res, next) {
    const password = req.body.password;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'PasswordRequired',
        message: 'Password is required'
      });
    }

    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) {
      return res.status(400).json({
        success: false,
        error: 'WeakPassword',
        message: `Password must be at least ${minLength} characters long`
      });
    }

    let strengthScore = 0;
    if (hasUpperCase) strengthScore++;
    if (hasLowerCase) strengthScore++;
    if (hasNumbers) strengthScore++;
    if (hasSpecialChar) strengthScore++;

    if (strengthScore < 3) {
      return res.status(400).json({
        success: false,
        error: 'WeakPassword',
        message: 'Password must contain at least 3 of the following: uppercase letters, lowercase letters, numbers, special characters'
      });
    }

    // Check for common passwords
    const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
    if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
      return res.status(400).json({
        success: false,
        error: 'WeakPassword',
        message: 'Password is too common and easily guessable'
      });
    }

    next();
  }

  // CSRF protection middleware
  csrfProtection(req, res, next) {
    // For state-changing requests, require CSRF token
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const csrfToken = req.get('X-CSRF-Token') || req.body._csrf;
      const sessionToken = req.session?.csrfToken;

      if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
        logger.warn('CSRF token validation failed', {
          ip: req.ip,
          path: req.path,
          method: req.method,
          userAgent: req.get('User-Agent')
        });

        return res.status(403).json({
          success: false,
          error: 'InvalidCsrfToken',
          message: 'Invalid or missing CSRF token'
        });
      }
    }

    next();
  }

  // Generate CSRF token
  generateCsrfToken(req, res, next) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
    }

    res.set('X-CSRF-Token', req.session.csrfToken);
    next();
  }
}

// Create singleton instance
const securityMiddleware = new SecurityMiddleware();

module.exports = securityMiddleware;