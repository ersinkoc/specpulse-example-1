const rateLimit = require('express-rate-limit');
const { logger } = require('../utils/logger');

// Create a rate limiter for API endpoints
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Create a stricter rate limiter for task creation/modification
const taskRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 task operations per minute
  message: {
    success: false,
    error: {
      code: 'TASK_RATE_LIMIT_EXCEEDED',
      message: 'Too many task operations, please try again later.'
    },
    timestamp: new Date().toISOString()
  },
  handler: (req, res) => {
    logger.warn('Task rate limit exceeded', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'TASK_RATE_LIMIT_EXCEEDED',
        message: 'Too many task operations, please try again later.',
        retryAfter: '1 minute'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Create a very strict rate limiter for sensitive operations
const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'STRICT_RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded for this operation.'
    },
    timestamp: new Date().toISOString()
  },
  handler: (req, res) => {
    logger.warn('Strict rate limit exceeded', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'STRICT_RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded for this operation.',
        retryAfter: '15 minutes'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Rate limit middleware wrapper that logs when rate limiting is applied
const rateLimitWrapper = (limiter) => {
  return (req, res, next) => {
    // Log the request before rate limiting
    logger.info('Rate limiting check', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });

    limiter(req, res, next);
  };
};

module.exports = {
  apiRateLimit: rateLimitWrapper(apiRateLimit),
  taskRateLimit: rateLimitWrapper(taskRateLimit),
  strictRateLimit: rateLimitWrapper(strictRateLimit)
};