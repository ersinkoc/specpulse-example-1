const logger = require('../utils/logger');

// Custom error classes
class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
    this.statusCode = 400;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class ConflictError extends Error {
  constructor(message = 'Resource conflict') {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

class RateLimitError extends Error {
  constructor(message = 'Too many requests') {
    super(message);
    this.name = 'RateLimitError';
    this.statusCode = 429;
  }
}

const errorHandler = (err, req, res, next) => {
  // Log error with context
  logger.error('Error occurred:', {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack
    },
    request: {
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      body: req.method !== 'GET' ? req.body : undefined
    },
    timestamp: new Date().toISOString()
  });

  // Default error response
  let errorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error'
    },
    timestamp: new Date().toISOString()
  };

  // Handle specific error types
  if (err instanceof ValidationError) {
    errorResponse.error = {
      code: 'VALIDATION_ERROR',
      message: err.message,
      details: err.details
    };
    return res.status(400).json(errorResponse);
  }

  if (err instanceof NotFoundError) {
    errorResponse.error = {
      code: 'NOT_FOUND',
      message: err.message
    };
    return res.status(404).json(errorResponse);
  }

  if (err instanceof ConflictError) {
    errorResponse.error = {
      code: 'CONFLICT',
      message: err.message
    };
    return res.status(409).json(errorResponse);
  }

  if (err instanceof RateLimitError) {
    errorResponse.error = {
      code: 'RATE_LIMIT_EXCEEDED',
      message: err.message
    };
    return res.status(429).json(errorResponse);
  }

  // Handle validation errors from Task model
  if (err.name === 'ValidationError' && err.details) {
    errorResponse.error = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input data',
      details: Array.isArray(err.details) ? err.details : [err.message]
    };
    return res.status(400).json(errorResponse);
  }

  // Handle CastError (invalid IDs)
  if (err.name === 'CastError') {
    errorResponse.error = {
      code: 'INVALID_ID',
      message: 'Invalid ID format'
    };
    return res.status(400).json(errorResponse);
  }

  // Handle JSON parsing errors
  if (err.type === 'entity.parse.failed') {
    errorResponse.error = {
      code: 'INVALID_JSON',
      message: 'Invalid JSON in request body'
    };
    return res.status(400).json(errorResponse);
  }

  // Handle entity too large errors
  if (err.type === 'entity.too.large') {
    errorResponse.error = {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request entity too large'
    };
    return res.status(413).json(errorResponse);
  }

  // Handle unauthorized errors
  if (err.name === 'UnauthorizedError') {
    errorResponse.error = {
      code: 'UNAUTHORIZED',
      message: 'Unauthorized access'
    };
    return res.status(401).json(errorResponse);
  }

  // Handle forbidden errors
  if (err.name === 'ForbiddenError') {
    errorResponse.error = {
      code: 'FORBIDDEN',
      message: 'Access forbidden'
    };
    return res.status(403).json(errorResponse);
  }

  // Handle rate limiting errors
  if (err.status === 429) {
    errorResponse.error = {
      code: 'RATE_LIMIT_EXCEEDED',
      message: err.message || 'Too many requests, please try again later'
    };
    return res.status(429).json(errorResponse);
  }

  // Handle specific custom error messages
  if (err.message && err.message.includes('not found')) {
    errorResponse.error = {
      code: 'NOT_FOUND',
      message: err.message
    };
    return res.status(404).json(errorResponse);
  }

  if (err.message && err.message.includes('Validation failed')) {
    errorResponse.error = {
      code: 'VALIDATION_ERROR',
      message: err.message
    };
    return res.status(400).json(errorResponse);
  }

  // Use custom status code if provided
  const statusCode = err.statusCode || err.status || 500;

  // In production, don't expose sensitive error details
  if (process.env.NODE_ENV === 'production') {
    if (statusCode === 500) {
      errorResponse.error.message = 'Internal server error';
    }
  } else {
    // In development, include error details
    errorResponse.error.details = {
      stack: err.stack,
      name: err.name
    };
  }

  res.status(statusCode).json(errorResponse);
};

// Async error handler wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`
    },
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError
};