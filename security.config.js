/**
 * Security Configuration
 * Central security settings and policies for the application
 */

const path = require('path');

module.exports = {
  // Security headers and policies
  security: {
    // Rate limiting
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    },

    // CORS settings
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      optionsSuccessStatus: 200
    },

    // Security headers
    helmet: {
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
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false
    },

    // Session security
    session: {
      name: 'secure-session',
      secret: process.env.SESSION_SECRET || 'change-this-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'strict'
      }
    }
  },

  // Audit logging configuration
  audit: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    file: {
      enabled: true,
      filename: path.join(__dirname, 'logs', 'audit.log'),
      maxSize: '10m',
      maxFiles: 5,
      datePattern: 'YYYY-MM-DD'
    },
    console: {
      enabled: process.env.NODE_ENV !== 'production',
      colorize: true
    },
    // Audit log fields to capture
    fields: [
      'timestamp',
      'level',
      'message',
      'userId',
      'ip',
      'userAgent',
      'method',
      'url',
      'statusCode',
      'responseTime',
      'securityEvent',
      'severity'
    ]
  },

  // Vulnerability scanning configuration
  vulnerabilityScanning: {
    enabled: process.env.VULN_SCANNING_ENABLED !== 'false',
    schedule: '0 2 * * *', // Daily at 2 AM
    scanners: {
      dependencies: {
        enabled: true,
        timeout: 300000, // 5 minutes
        cache: true,
        cacheExpiry: 86400000 // 24 hours
      },
      codeAnalysis: {
        enabled: true,
        patterns: [
          'eval(',
          'Function(',
          'setTimeout(',
          'setInterval(',
          'new Function('
        ]
      }
    },
    notifications: {
      enabled: true,
      channels: ['email', 'webhook'],
      thresholds: {
        high: 7,
        critical: 9
      }
    }
  },

  // Security monitoring configuration
  monitoring: {
    enabled: process.env.SECURITY_MONITORING_ENABLED !== 'false',
    events: {
      authentication: {
        loginAttempts: true,
        failedLogins: true,
        passwordChanges: true,
        accountLockouts: true
      },
      authorization: {
        accessDenied: true,
        privilegeEscalation: true,
        suspiciousAccess: true
      },
      data: {
        sensitiveDataAccess: true,
        dataExfiltration: true,
        unusualDataPatterns: true
      },
      system: {
        configurationChanges: true,
        securityEvents: true,
        performanceAnomalies: true
      }
    },
    thresholds: {
      failedLoginsPerMinute: 5,
      suspiciousRequestsPerMinute: 10,
      dataAccessAnomalies: 3
    }
  },

  // Compliance configuration
  compliance: {
    gdpr: {
      enabled: true,
      dataRetention: {
        auditLogs: 2555, // 7 years in days
        userActivity: 365, // 1 year in days
        securityIncidents: 2555 // 7 years in days
      },
      rights: {
        dataPortability: true,
        rightToErasure: true,
        consentManagement: true
      }
    },
    soc2: {
      enabled: true,
      controls: {
        security: true,
        availability: true,
        confidentiality: true,
        privacy: true
      },
      evidenceCollection: {
        automated: true,
        frequency: 'daily',
        retention: 3650 // 10 years in days
      }
    }
  },

  // Encryption configuration
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    tagLength: 16,
    keyRotation: {
      enabled: true,
      interval: 2592000000 // 30 days in milliseconds
    }
  },

  // Security API configuration
  api: {
    endpoints: {
      vulnerabilities: '/api/security/vulnerabilities',
      incidents: '/api/security/incidents',
      compliance: '/api/security/compliance',
      metrics: '/api/security/metrics',
      audit: '/api/security/audit'
    },
    authentication: {
      required: true,
      roles: ['security-admin', 'security-analyst', 'security-viewer']
    },
    rateLimiting: {
      global: {
        windowMs: 60000, // 1 minute
        max: 60
      },
      sensitive: {
        windowMs: 60000, // 1 minute
        max: 10
      }
    }
  }
};