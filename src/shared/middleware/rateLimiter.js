const rateLimit = require('express-rate-limit');
const config = require('../config/environment');
const logger = require('../utils/logger');
const { config: securityConfig } = require('../config/security');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.api.windowMs,
  max: securityConfig.rateLimit.api.max,
  message: {
    error: 'TooManyRequestsError',
    message: securityConfig.rateLimit.api.message.error,
    retryAfter: Math.ceil(securityConfig.rateLimit.api.windowMs / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    res.status(429).json(securityConfig.rateLimit.api.message);
  }
});

// Authentication endpoints rate limiter (more restrictive)
const authLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.auth.windowMs,
  max: securityConfig.rateLimit.auth.max,
  message: {
    error: 'TooManyRequestsError',
    message: securityConfig.rateLimit.auth.message.error,
    retryAfter: securityConfig.rateLimit.auth.message.retryAfter
  },
  skipSuccessfulRequests: securityConfig.rateLimit.auth.skipSuccessfulRequests,
  keyGenerator: (req) => {
    // Use IP + email for more granular rate limiting on auth endpoints
    const email = req.body?.email || '';
    return `${req.ip}-${email}`;
  },
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    res.status(429).json(securityConfig.rateLimit.auth.message);
  }
});

// Password reset rate limiter (very restrictive)
const passwordResetLimiter = rateLimit({
  windowMs: securityConfig.rateLimit.passwordReset.windowMs,
  max: securityConfig.rateLimit.passwordReset.max,
  message: {
    error: 'TooManyRequestsError',
    message: securityConfig.rateLimit.passwordReset.message.error,
    retryAfter: securityConfig.rateLimit.passwordReset.message.retryAfter
  },
  keyGenerator: (req) => {
    // Use IP + email for password reset requests
    const email = req.body?.email || '';
    return `${req.ip}-${email}`;
  },
  handler: (req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    res.status(429).json(securityConfig.rateLimit.passwordReset.message);
  }
});

// OAuth2 rate limiter
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 OAuth2 attempts per 15 minutes
  message: {
    error: 'TooManyRequestsError',
    message: 'Too many OAuth2 authentication attempts, please try again later.',
    retryAfter: 900
  },
  keyGenerator: (req) => {
    // Use IP for OAuth2 requests
    return req.ip;
  },
  handler: (req, res) => {
    logger.warn('OAuth2 rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      provider: req.params.provider
    });

    res.status(429).json({
      error: 'TooManyRequestsError',
      message: 'Too many OAuth2 authentication attempts, please try again later.',
      retryAfter: 900
    });
  }
});

// Email verification rate limiter
const emailVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 verification attempts per hour
  message: {
    error: 'TooManyRequestsError',
    message: 'Too many email verification attempts, please try again later.',
    retryAfter: 3600
  },
  keyGenerator: (req) => {
    // Use IP + email for email verification requests
    const email = req.body?.email || '';
    return `${req.ip}-${email}`;
  },
  handler: (req, res) => {
    logger.warn('Email verification rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    res.status(429).json({
      error: 'TooManyRequestsError',
      message: 'Too many email verification attempts, please try again later.',
      retryAfter: 3600
    });
  }
});

// Profile update rate limiter
const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 profile updates per 15 minutes
  message: {
    error: 'TooManyRequestsError',
    message: 'Too many profile update attempts, please try again later.',
    retryAfter: 900
  },
  keyGenerator: (req) => {
    // Use user ID if available, otherwise IP
    return req.user?.id || req.ip;
  },
  handler: (req, res) => {
    logger.warn('Profile update rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    res.status(429).json({
      error: 'TooManyRequestsError',
      message: 'Too many profile update attempts, please try again later.',
      retryAfter: 900
    });
  }
});

// Create a custom rate limiter that logs all requests
const createRateLimiter = (options) => {
  const limiter = rateLimit({
    ...options,
    handler: (req, res) => {
      logger.warn('Custom rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        limit: options.max,
        windowMs: options.windowMs
      });

      if (typeof options.message === 'string') {
        res.status(429).json({
          error: 'TooManyRequestsError',
          message: options.message,
          retryAfter: Math.ceil(options.windowMs / 1000)
        });
      } else {
        res.status(429).json(options.message);
      }
    }
  });

  return limiter;
};

// Dynamic rate limiter based on user role
const createRoleBasedLimiter = (req, res, next) => {
  const user = req.user;

  // Admin users have higher limits
  if (user && user.roles && user.roles.includes('admin')) {
    return createRateLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Much higher limit for admins
      message: 'Admin rate limit exceeded'
    })(req, res, next);
  }

  // Regular users get standard limits
  return apiLimiter(req, res, next);
};

// Middleware to skip rate limiting for trusted IPs
const createTrustedIPLimiter = (trustedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;

    if (trustedIPs.includes(clientIP)) {
      logger.debug('Skipping rate limit for trusted IP', { ip: clientIP });
      return next();
    }

    return apiLimiter(req, res, next);
  };
};

// Progressive rate limiter (increases strictness with repeated violations)
const progressiveLimiter = (req, res, next) => {
  // This would typically use Redis or similar to track violations
  // For now, implement a basic version using memory
  const clientIP = req.ip;
  const violations = (progressiveLimiter.violations || {})[clientIP] || 0;

  let windowMs, max;

  if (violations === 0) {
    // First time: normal limits
    windowMs = 15 * 60 * 1000;
    max = 100;
  } else if (violations === 1) {
    // First violation: stricter limits
    windowMs = 15 * 60 * 1000;
    max = 50;
  } else if (violations === 2) {
    // Second violation: very strict
    windowMs = 30 * 60 * 1000;
    max = 25;
  } else {
    // Multiple violations: extremely strict
    windowMs = 60 * 60 * 1000;
    max = 10;
  }

  const limiter = createRateLimiter({
    windowMs,
    max,
    message: `Rate limit exceeded. You have made ${violations} previous violations. Limits will be restored after a period of good behavior.`
  });

  // Track violations (this would be better in Redis)
  progressiveLimiter.violations = progressiveLimiter.violations || {};

  limiter(req, res, (err) => {
    if (err) {
      // Rate limit hit, increment violations
      progressiveLimiter.violations[clientIP] = violations + 1;
      logger.warn('Progressive rate limit violation', {
        ip: clientIP,
        violations: violations + 1,
        path: req.path
      });
    }
    next(err);
  });
};

// Export rate limiters
module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  oauthLimiter,
  emailVerificationLimiter,
  profileUpdateLimiter,
  createRateLimiter,
  createRoleBasedLimiter,
  createTrustedIPLimiter,
  progressiveLimiter,

  // Convenience method to apply appropriate limiter based on route
  getLimiter: (type) => {
    switch (type) {
      case 'auth':
        return authLimiter;
      case 'password-reset':
        return passwordResetLimiter;
      case 'oauth':
        return oauthLimiter;
      case 'email-verification':
        return emailVerificationLimiter;
      case 'profile-update':
        return profileUpdateLimiter;
      default:
        return apiLimiter;
    }
  }
};