/**
 * Audit Logging Configuration
 * Configuration for tamper-proof audit logging system
 */

const crypto = require('crypto');
const path = require('path');

module.exports = {
  // Audit log signing configuration
  signing: {
    algorithm: 'RSA-SHA256',
    keyPair: {
      publicKeyPath: process.env.AUDIT_PUBLIC_KEY_PATH || path.join(__dirname, 'keys', 'audit-public.pem'),
      privateKeyPath: process.env.AUDIT_PRIVATE_KEY_PATH || path.join(__dirname, 'keys', 'audit-private.pem'),
      passphrase: process.env.AUDIT_KEY_PASSPHRASE || ''
    },
    signatureHeader: 'x-audit-signature',
    timestampHeader: 'x-audit-timestamp'
  },

  // Log storage configuration
  storage: {
    primary: {
      type: 'file',
      directory: path.join(__dirname, 'logs', 'audit'),
      rotation: {
        enabled: true,
        interval: 'daily',
        maxSize: '100MB',
        maxFiles: 30
      },
      compression: {
        enabled: true,
        algorithm: 'gzip'
      }
    },
    backup: {
      type: 'database',
      enabled: process.env.AUDIT_DB_BACKUP_ENABLED === 'true',
      connection: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD
      },
      table: 'audit_logs_backup',
      batchSize: 1000,
      flushInterval: 60000 // 1 minute
    }
  },

  // Event configuration
  events: {
    // Security events to audit
    security: {
      authentication: {
        login: { level: 'info', category: 'auth', required: true },
        logout: { level: 'info', category: 'auth', required: true },
        failedLogin: { level: 'warning', category: 'auth', required: true },
        passwordChange: { level: 'info', category: 'auth', required: true },
        accountLockout: { level: 'warning', category: 'auth', required: true },
        privilegeEscalation: { level: 'critical', category: 'auth', required: true }
      },
      authorization: {
        accessGranted: { level: 'info', category: 'authz', required: false },
        accessDenied: { level: 'warning', category: 'authz', required: true },
        unauthorizedAccess: { level: 'critical', category: 'authz', required: true }
      },
      data: {
        dataAccess: { level: 'info', category: 'data', required: false },
        dataModification: { level: 'info', category: 'data', required: true },
        sensitiveDataAccess: { level: 'warning', category: 'data', required: true },
        dataExfiltration: { level: 'critical', category: 'data', required: true }
      },
      system: {
        configurationChange: { level: 'warning', category: 'system', required: true },
        securityEvent: { level: 'info', category: 'system', required: true },
        systemError: { level: 'error', category: 'system', required: true },
        vulnerabilityDiscovered: { level: 'critical', category: 'system', required: true }
      }
    },

    // Business events to audit
    business: {
      userManagement: {
        userCreated: { level: 'info', category: 'user', required: true },
        userUpdated: { level: 'info', category: 'user', required: true },
        userDeleted: { level: 'warning', category: 'user', required: true },
        roleAssigned: { level: 'info', category: 'user', required: true },
        roleRevoked: { level: 'warning', category: 'user', required: true }
      },
      compliance: {
        reportGenerated: { level: 'info', category: 'compliance', required: true },
        evidenceCollected: { level: 'info', category: 'compliance', required: true },
        auditCompleted: { level: 'info', category: 'compliance', required: true }
      }
    }
  },

  // Data retention policies
  retention: {
    policies: {
      security: {
        authentication: 2555, // 7 years in days
        authorization: 2555, // 7 years in days
        data: 2555, // 7 years in days
        system: 2555 // 7 years in days
      },
      business: {
        user: 1825, // 5 years in days
        compliance: 3650 // 10 years in days
      }
    },
    cleanup: {
      enabled: true,
      schedule: '0 3 * * 0', // Weekly on Sunday at 3 AM
      batchSize: 1000,
      dryRun: process.env.AUDIT_CLEANUP_DRY_RUN !== 'false'
    }
  },

  // Integrity verification
  integrity: {
    enabled: true,
    verification: {
      schedule: '0 4 * * *', // Daily at 4 AM
      algorithm: 'SHA256',
      batchSize: 1000
    },
    alerts: {
      tampering: {
        enabled: true,
        channels: ['email', 'webhook'],
        recipients: process.env.SECURITY_ALERT_EMAILS?.split(',') || []
      }
    }
  },

  // Performance configuration
  performance: {
    buffering: {
      enabled: true,
      size: 100,
      flushInterval: 5000 // 5 seconds
    },
    compression: {
      enabled: true,
      threshold: 1024 // 1KB
    },
    async: {
      enabled: true,
      concurrency: 10,
      timeout: 30000 // 30 seconds
    }
  },

  // Export and reporting
  export: {
    formats: ['json', 'csv', 'xml'],
    compression: true,
    encryption: {
      enabled: process.env.AUDIT_EXPORT_ENCRYPTION_ENABLED === 'true',
      algorithm: 'AES-256-GCM'
    },
    retention: {
      temporary: 7, // days
      permanent: 365 // days
    }
  },

  // API configuration for audit logs
  api: {
    endpoints: {
      search: '/api/audit/search',
      export: '/api/audit/export',
      integrity: '/api/audit/integrity',
      verification: '/api/audit/verify'
    },
    authentication: {
      required: true,
      roles: ['security-admin', 'security-analyst', 'auditor']
    },
    rateLimiting: {
      windowMs: 60000, // 1 minute
      max: 100
    }
  }
};