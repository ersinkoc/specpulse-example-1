const tokenService = require('../services/tokenService');
const authService = require('../services/authService');
const logger = require('../../shared/utils/logger');

/**
 * JWT Authentication Middleware
 * Verifies JWT tokens and attaches user information to the request object
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = tokenService.extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'Access token is required'
      });
    }

    // Verify the token
    const decoded = tokenService.verifyToken(token, 'access');

    // Get user information from database to ensure user still exists and is active
    const user = await authService.getUserById(decoded.sub);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'User account is inactive'
      });
    }

    // Attach user information to request
    req.user = user.toJSON();
    req.token = decoded;

    // Log authentication
    logger.debug('User authenticated', {
      userId: user.id,
      email: user.email,
      path: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    logger.error('Authentication middleware error:', error);

    if (error.message.includes('expired')) {
      return res.status(401).json({
        success: false,
        error: 'TokenExpiredError',
        message: 'Access token has expired'
      });
    }

    if (error.message.includes('Invalid token') || error.message.includes('blacklisted')) {
      return res.status(401).json({
        success: false,
        error: 'InvalidTokenError',
        message: 'Invalid or expired access token'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'AuthenticationError',
      message: 'Authentication failed'
    });
  }
};

/**
 * Optional Authentication Middleware
 * Attaches user information if token is present, but doesn't block if not
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = tokenService.extractTokenFromHeader(authHeader);

    if (!token) {
      return next(); // No token, continue without authentication
    }

    // Try to verify the token
    const decoded = tokenService.verifyToken(token, 'access');

    // Get user information
    const user = await authService.getUserById(decoded.sub);

    if (user && user.isActive) {
      // Attach user information to request
      req.user = user.toJSON();
      req.token = decoded;

      logger.debug('User optionally authenticated', {
        userId: user.id,
        email: user.email,
        path: req.path,
        method: req.method
      });
    }

    next();

  } catch (error) {
    // Log error but don't block the request
    logger.debug('Optional authentication failed:', error.message);
    next();
  }
};

/**
 * Role-based Access Control Middleware
 * Checks if user has required roles
 */
const authorize = (...requiredRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'Authentication required'
      });
    }

    const userRoles = req.user.roles || [];
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      logger.warn('Authorization failed', {
        userId: req.user.id,
        userRoles,
        requiredRoles,
        path: req.path,
        method: req.method
      });

      return res.status(403).json({
        success: false,
        error: 'AuthorizationError',
        message: 'Insufficient permissions',
        requiredRoles
      });
    }

    logger.debug('User authorized', {
      userId: req.user.id,
      userRoles,
      requiredRoles,
      path: req.path,
      method: req.method
    });

    next();
  };
};

/**
 * Self or Admin Authorization Middleware
 * Users can access their own resources, admins can access any
 */
const authorizeSelfOrAdmin = (getUserIdFromParams) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'Authentication required'
      });
    }

    const userId = getUserIdFromParams(req);
    const userRoles = req.user.roles || [];
    const isAdmin = userRoles.includes('admin');

    // Allow if user is admin or accessing their own resource
    if (isAdmin || req.user.id === userId) {
      return next();
    }

    logger.warn('Self/Admin authorization failed', {
      userId: req.user.id,
      targetUserId: userId,
      userRoles,
      path: req.path,
      method: req.method
    });

    return res.status(403).json({
      success: false,
      error: 'AuthorizationError',
      message: 'You can only access your own resources'
    });
  };
};

/**
 * API Key Middleware (alternative to JWT)
 * For service-to-service authentication
 */
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'AuthenticationError',
      message: 'API key is required'
    });
  }

  // In a real implementation, validate API key against database
  // For now, check against environment variable
  const validApiKey = process.env.API_KEY;

  if (!validApiKey || apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      error: 'AuthenticationError',
      message: 'Invalid API key'
    });
  }

  // Attach service user context
  req.user = {
    id: 'service-account',
    email: 'service@example.com',
    roles: ['service'],
    isService: true
  };

  logger.debug('API key authenticated', {
    path: req.path,
    method: req.method
  });

  next();
};

/**
 * Device Detection Middleware
 * Extracts device information from user agent and headers
 */
const deviceDetection = (req, res, next) => {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress;
  const forwarded = req.get('X-Forwarded-For');

  // Parse device info from user agent
  let deviceInfo = {
    type: 'unknown',
    os: 'unknown',
    browser: 'unknown'
  };

  if (userAgent) {
    const ua = userAgent.toLowerCase();

    // Device type detection
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      deviceInfo.type = 'mobile';
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      deviceInfo.type = 'tablet';
    } else if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) {
      deviceInfo.type = 'desktop';
    }

    // OS detection
    if (ua.includes('windows')) deviceInfo.os = 'windows';
    else if (ua.includes('mac') || ua.includes('osx')) deviceInfo.os = 'macos';
    else if (ua.includes('linux')) deviceInfo.os = 'linux';
    else if (ua.includes('android')) deviceInfo.os = 'android';
    else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) deviceInfo.os = 'ios';

    // Browser detection
    if (ua.includes('chrome')) deviceInfo.browser = 'chrome';
    else if (ua.includes('firefox')) deviceInfo.browser = 'firefox';
    else if (ua.includes('safari')) deviceInfo.browser = 'safari';
    else if (ua.includes('edge')) deviceInfo.browser = 'edge';
    else if (ua.includes('opera')) deviceInfo.browser = 'opera';
  }

  // Extract real IP address (considering proxies)
  let realIp = ip;
  if (forwarded) {
    realIp = forwarded.split(',')[0].trim();
  }

  // Attach device information to request
  req.deviceInfo = {
    ...deviceInfo,
    userAgent,
    ip: realIp,
    forwarded: forwarded ? forwarded.split(',') : []
  };

  next();
};

/**
 * Session Validation Middleware
 * Validates that the user's session is still valid
 */
const validateSession = async (req, res, next) => {
  if (!req.user || !req.token) {
    return next(); // Skip if no authentication
  }

  try {
    // Check if user session is still valid
    // This could involve checking against a session store or database
    // For now, we'll assume the token validity is sufficient

    const now = Date.now();
    const tokenAge = now - (req.token.iat * 1000);
    const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours

    if (tokenAge > maxSessionAge) {
      // Token is too old, require re-authentication
      return res.status(401).json({
        success: false,
        error: 'SessionExpiredError',
        message: 'Session has expired, please login again'
      });
    }

    next();

  } catch (error) {
    logger.error('Session validation error:', error);
    next(); // Continue on error
  }
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  authorize,
  authorizeSelfOrAdmin,
  authenticateApiKey,
  deviceDetection,
  validateSession
};