const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const tokenService = require('../services/tokenService');
const authService = require('../services/authService');
const sessionService = require('../services/sessionService');
const logger = require('../../shared/utils/logger');

/**
 * JWT Verification Helper Class
 * Provides comprehensive JWT verification with blacklist checking
 */
class JWTVerifier {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    this.issuer = process.env.JWT_ISSUER || 'specpulse-auth';
    this.audience = process.env.JWT_AUDIENCE || 'specpulse-users';

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    // JWT verification options
    this.verifyOptions = {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['HS256'],
      clockTolerance: 30 // 30 seconds clock skew tolerance
    };

    // Async JWT verification
    this.verifyAsync = promisify(jwt.verify);
    this.decodeAsync = promisify(jwt.decode);
  }

  /**
   * Extract JWT token from request
   */
  extractToken(req) {
    // Extract from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Extract from cookies
    if (req.cookies && req.cookies.accessToken) {
      return req.cookies.accessToken;
    }

    // Extract from query parameters (for WebSocket connections)
    if (req.query && req.query.token) {
      return req.query.token;
    }

    return null;
  }

  /**
   * Verify JWT token with comprehensive checking
   */
  async verifyToken(token, secret = this.jwtSecret) {
    try {
      return await this.verifyAsync(token, secret, this.verifyOptions);
    } catch (error) {
      // Re-throw with more descriptive error
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      } else if (error.name === 'NotBeforeError') {
        throw new Error('Token not active');
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(token, jti) {
    try {
      if (!jti) {
        // If no JTI, check the actual token
        const decoded = jwt.decode(token);
        jti = decoded?.jti;
      }

      if (!jti) {
        return false; // No JTI, cannot blacklist
      }

      return await sessionService.isTokenBlacklisted(jti);
    } catch (error) {
      logger.error('Error checking token blacklist', { error: error.message, jti });
      return false; // Fail open - allow token if blacklist check fails
    }
  }

  /**
   * Generate request ID for tracing
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

const jwtVerifier = new JWTVerifier();

/**
 * Enhanced JWT Authentication Middleware
 * Verifies JWT tokens with blacklist checking and comprehensive validation
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from various sources
    const token = jwtVerifier.extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'Access token is required',
        code: 'TOKEN_REQUIRED'
      });
    }

    // Verify token and get payload
    const decoded = await jwtVerifier.verifyToken(token);

    // Check if token is blacklisted
    if (await jwtVerifier.isTokenBlacklisted(token, decoded.jti)) {
      return res.status(401).json({
        success: false,
        error: 'TokenRevokedError',
        message: 'Token has been revoked',
        code: 'TOKEN_REVOKED'
      });
    }

    // Get user information from database to ensure user still exists and is active
    const user = await authService.getUserById(decoded.sub);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationError',
        message: 'User account is inactive',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Check if user's password has been changed after token was issued
    if (decoded.iat && user.passwordChangedAt) {
      const tokenIssuedAt = new Date(decoded.iat * 1000);
      const passwordChangedAt = new Date(user.passwordChangedAt);

      if (passwordChangedAt > tokenIssuedAt) {
        return res.status(401).json({
          success: false,
          error: 'TokenInvalidError',
          message: 'Token invalid due to password change',
          code: 'PASSWORD_CHANGED'
        });
      }
    }

    // Check if email verification is required and user is not verified
    if (user.emailVerificationRequired && !user.emailVerified) {
      return res.status(403).json({
        success: false,
        error: 'EmailVerificationRequired',
        message: 'Email verification required',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Attach user information to request
    req.user = user.toJSON();
    req.token = {
      jti: decoded.jti,
      type: decoded.type,
      iat: decoded.iat,
      exp: decoded.exp,
      scope: decoded.scope || []
    };

    // Add request tracing for audit logs
    req.requestId = jwtVerifier.generateRequestId();
    req.authTimestamp = Date.now();

    // Log successful authentication
    logger.debug('User authenticated successfully', {
      userId: req.user.id,
      email: req.user.email,
      requestId: req.requestId,
      tokenType: req.token.type,
      path: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    logger.error('Authentication middleware error:', {
      error: error.message,
      requestId: req.requestId,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Handle specific JWT errors
    if (error.message === 'Token expired') {
      return res.status(401).json({
        success: false,
        error: 'TokenExpiredError',
        message: 'Access token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (error.message === 'Invalid token') {
      return res.status(401).json({
        success: false,
        error: 'InvalidTokenError',
        message: 'Invalid access token',
        code: 'INVALID_TOKEN'
      });
    }

    if (error.message === 'Token not active') {
      return res.status(401).json({
        success: false,
        error: 'TokenNotActiveError',
        message: 'Token is not yet active',
        code: 'TOKEN_NOT_ACTIVE'
      });
    }

    // Generic authentication error
    return res.status(401).json({
      success: false,
      error: 'AuthenticationError',
      message: 'Authentication failed',
      code: 'AUTH_FAILED',
      timestamp: new Date().toISOString()
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