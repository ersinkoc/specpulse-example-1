const helmet = require('helmet');
const { logger } = require('../utils/logger');

// Custom security middleware
const securityMiddleware = (req, res, next) => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Log security-related requests
  if (req.url.includes('/admin') || req.method === 'DELETE') {
    logger.info('Security-sensitive request', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
  }

  next();
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    // Basic XSS prevention - remove script tags and dangerous content
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return str;

      return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    };

    const sanitizeObject = (obj) => {
      const sanitized = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          if (typeof obj[key] === 'string') {
            sanitized[key] = sanitizeString(obj[key]);
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitized[key] = sanitizeObject(obj[key]);
          } else {
            sanitized[key] = obj[key];
          }
        }
      }
      return sanitized;
    };

    req.body = sanitizeObject(req.body);
  }

  next();
};

// Request validation middleware
const validateRequest = (req, res, next) => {
  // Check for suspicious patterns in request
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /eval\(/i,
    /exec\(/i
  ];

  const checkForSuspiciousContent = (obj) => {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (typeof value === 'string') {
          for (const pattern of suspiciousPatterns) {
            if (pattern.test(value)) {
              logger.warn('Suspicious request content detected', {
                ip: req.ip,
                url: req.url,
                method: req.method,
                field: key,
                pattern: pattern.source,
                userAgent: req.get('User-Agent')
              });

              return res.status(400).json({
                success: false,
                error: {
                  code: 'SUSPICIOUS_CONTENT',
                  message: 'Request contains suspicious content'
                },
                timestamp: new Date().toISOString()
              });
            }
          }
        } else if (typeof value === 'object' && value !== null) {
          const result = checkForSuspiciousContent(value);
          if (result) return result;
        }
      }
    }
    return null;
  };

  // Check request body
  if (req.body) {
    const suspiciousResult = checkForSuspiciousContent(req.body);
    if (suspiciousResult) return suspiciousResult;
  }

  // Check query parameters
  if (req.query) {
    const suspiciousResult = checkForSuspiciousContent(req.query);
    if (suspiciousResult) return suspiciousResult;
  }

  next();
};

// API key validation middleware (for future use)
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  // For now, skip API key validation (can be implemented later)
  if (process.env.REQUIRE_API_KEY === 'true' && !apiKey) {
    logger.warn('Missing API key', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent')
    });

    return res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'API key is required'
      },
      timestamp: new Date().toISOString()
    });
  }

  next();
};

// Content type validation middleware
const validateContentType = (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    const contentType = req.get('Content-Type');

    if (!contentType || !contentType.includes('application/json')) {
      logger.warn('Invalid content type', {
        ip: req.ip,
        url: req.url,
        method: req.method,
        contentType,
        userAgent: req.get('User-Agent')
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Content-Type must be application/json'
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  next();
};

// Request size validation middleware
const validateRequestSize = (req, res, next) => {
  const contentLength = req.get('Content-Length');
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    logger.warn('Request too large', {
      ip: req.ip,
      url: req.url,
      method: req.method,
      contentLength,
      userAgent: req.get('User-Agent')
    });

    return res.status(413).json({
      success: false,
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: 'Request entity too large'
      },
      timestamp: new Date().toISOString()
    });
  }

  next();
};

module.exports = {
  securityMiddleware,
  sanitizeInput,
  validateRequest,
  validateApiKey,
  validateContentType,
  validateRequestSize,
  helmet
};