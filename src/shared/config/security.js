const crypto = require('crypto');
const config = require('./environment');

const securityConfig = {
  // JWT Security
  jwt: {
    algorithm: 'HS256',
    issuer: 'specpulse-auth',
    audience: 'specpulse-client',
    accessTokenExpiry: config.jwt.accessExpiresIn,
    refreshTokenExpiry: config.jwt.refreshExpiresIn
  },

  // Password Security
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    saltRounds: config.security.bcryptRounds
  },

  // Session Security
  session: {
    name: 'specpulse-session',
    secret: config.security.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: config.server.nodeEnv === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'strict'
    }
  },

  // CORS Security
  cors: {
    origin: config.security.corsOrigin,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  },

  // Rate Limiting Security
  rateLimit: {
    // General API rate limiting
    api: {
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(config.rateLimit.windowMs / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false
    },

    // Authentication endpoints - more restrictive
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per 15 minutes
      message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: 900
      },
      skipSuccessfulRequests: true
    },

    // Password reset - very restrictive
    passwordReset: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 attempts per hour
      message: {
        error: 'Too many password reset attempts, please try again later.',
        retryAfter: 3600
      }
    }
  },

  // OAuth2 Security
  oauth2: {
    state: {
      length: 32,
      expiresIn: 10 * 60 * 1000 // 10 minutes
    },
    token: {
      encryptionAlgorithm: 'aes-256-gcm',
      keyLength: 32,
      ivLength: 16,
      tagLength: 16
    }
  },

  // Email Security
  email: {
    verificationToken: {
      length: 32,
      expiresIn: 24 * 60 * 60 * 1000 // 24 hours
    },
    passwordResetToken: {
      length: 32,
      expiresIn: 1 * 60 * 60 * 1000 // 1 hour
    }
  },

  // File Upload Security
  upload: {
    allowedMimeTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp'
    ],
    maxFileSize: config.upload.maxFileSize,
    scanFiles: config.server.nodeEnv === 'production',
    sanitizeFilenames: true
  },

  // Security Headers
  headers: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  },

  // Audit Logging
  audit: {
    logLevel: config.server.nodeEnv === 'production' ? 'info' : 'debug',
    logSensitiveData: false,
    retentionDays: 90,
    events: [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'PASSWORD_CHANGE',
      'PASSWORD_RESET',
      'ACCOUNT_CREATION',
      'ACCOUNT_DELETION',
      'EMAIL_VERIFICATION',
      'OAUTH_LINK',
      'OAUTH_UNLINK',
      'PROFILE_UPDATE',
      'SECURITY_VIOLATION'
    ]
  }
};

// Utility functions for security operations
const securityUtils = {
  // Generate secure random token
  generateToken: (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
  },

  // Generate OAuth2 state parameter
  generateOAuthState: () => {
    return {
      value: securityUtils.generateToken(securityConfig.oauth2.state.length),
      expiresAt: Date.now() + securityConfig.oauth2.state.expiresIn
    };
  },

  // Validate OAuth2 state
  validateOAuthState: (state, storedState) => {
    if (!state || !storedState) return false;
    if (state !== storedState.value) return false;
    if (Date.now() > storedState.expiresAt) return false;
    return true;
  },

  // Encrypt sensitive data
  encrypt: (text, key) => {
    const iv = crypto.randomBytes(securityConfig.oauth2.token.ivLength);
    const cipher = crypto.createCipher(
      securityConfig.oauth2.token.encryptionAlgorithm,
      key
    );
    cipher.setAAD(Buffer.from('specpulse-oauth2', 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  },

  // Decrypt sensitive data
  decrypt: (encryptedData, key) => {
    const decipher = crypto.createDecipher(
      securityConfig.oauth2.token.encryptionAlgorithm,
      key
    );
    decipher.setAAD(Buffer.from('specpulse-oauth2', 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  },

  // Validate password strength
  validatePasswordStrength: (password) => {
    const checks = {
      length: password.length >= securityConfig.password.minLength,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      numbers: /\d/.test(password),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };

    const isValid = Object.values(checks).every(check => check === true);
    const missing = Object.entries(checks)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    return {
      isValid,
      missing,
      checks
    };
  },

  // Sanitize filename
  sanitizeFilename: (filename) => {
    if (!filename) return 'unknown';

    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase()
      .substring(0, 255);
  }
};

module.exports = {
  config: securityConfig,
  utils: securityUtils
};