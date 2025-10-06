/**
 * Security Test Scenarios and Fixtures
 * Common test data for security testing
 */

const securityScenarios = {
  // Authentication scenarios
  authentication: {
    successfulLogin: {
      type: 'authentication',
      subtype: 'login_success',
      userId: 'user123',
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T10:00:00Z',
      severity: 'info',
      metadata: {
        loginMethod: 'password',
        sessionId: 'sess_abc123',
        mfaVerified: true
      }
    },

    failedLogin: {
      type: 'authentication',
      subtype: 'login_failure',
      userId: 'user123',
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T10:01:00Z',
      severity: 'warning',
      metadata: {
        loginMethod: 'password',
        failureReason: 'invalid_password',
        attemptCount: 3
      }
    },

    accountLockout: {
      type: 'authentication',
      subtype: 'account_lockout',
      userId: 'user123',
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T10:02:00Z',
      severity: 'critical',
      metadata: {
        lockoutReason: 'too_many_failed_attempts',
        lockoutDuration: 900, // 15 minutes
        lastSuccessfulLogin: '2023-11-30T15:30:00Z'
      }
    },

    privilegeEscalation: {
      type: 'authentication',
      subtype: 'privilege_escalation',
      userId: 'user456',
      ip: '192.168.1.200',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      timestamp: '2023-12-01T11:00:00Z',
      severity: 'critical',
      metadata: {
        requestedRole: 'admin',
        previousRole: 'user',
        escalationMethod: 'exploit',
        targetResource: '/admin/users'
      }
    }
  },

  // Authorization scenarios
  authorization: {
    accessDenied: {
      type: 'authorization',
      subtype: 'access_denied',
      userId: 'user789',
      ip: '192.168.1.150',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      timestamp: '2023-12-01T12:00:00Z',
      severity: 'warning',
      metadata: {
        requestedResource: '/api/admin/users',
        requiredRole: 'admin',
        userRole: 'user',
        httpMethod: 'GET',
        statusCode: 403
      }
    },

    unauthorizedAccess: {
      type: 'authorization',
      subtype: 'unauthorized_access',
      userId: 'unknown',
      ip: '192.168.1.250',
      userAgent: 'curl/7.68.0',
      timestamp: '2023-12-01T12:30:00Z',
      severity: 'high',
      metadata: {
        requestedResource: '/api/internal/config',
        httpMethod: 'POST',
        statusCode: 401,
        authenticationHeader: 'none'
      }
    }
  },

  // Data access scenarios
  data: {
    sensitiveDataAccess: {
      type: 'data',
      subtype: 'sensitive_data_access',
      userId: 'admin123',
      ip: '192.168.1.50',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T13:00:00Z',
      severity: 'info',
      metadata: {
        accessedTable: 'users',
        accessedFields: ['email', 'password_hash', 'ssn'],
        recordCount: 1000,
        accessMethod: 'direct_query',
        justification: 'user_management'
      }
    },

    dataExfiltration: {
      type: 'data',
      subtype: 'data_exfiltration',
      userId: 'user999',
      ip: '192.168.1.175',
      userAgent: 'Python/3.9 urllib3/1.26.5',
      timestamp: '2023-12-01T14:00:00Z',
      severity: 'critical',
      metadata: {
        exportedData: 'user_profiles',
        recordCount: 50000,
        exportFormat: 'csv',
        downloadSize: '15MB',
        destinationIp: '203.0.113.100',
        detectionMethod: 'anomaly_detection'
      }
    },

    unusualDataPattern: {
      type: 'data',
      subtype: 'unusual_access_pattern',
      userId: 'user777',
      ip: '192.168.1.125',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T15:00:00Z',
      severity: 'medium',
      metadata: {
        accessedResources: [
          '/api/users/1',
          '/api/users/2',
          '/api/users/3',
          '/api/users/4',
          '/api/users/5'
        ],
        timeWindow: 60, // seconds
        requestCount: 200,
        averageResponseTime: 1500, // ms
        baselineMultiplier: 10
      }
    }
  },

  // System events
  system: {
    configurationChange: {
      type: 'system',
      subtype: 'configuration_change',
      userId: 'admin123',
      ip: '192.168.1.10',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T16:00:00Z',
      severity: 'warning',
      metadata: {
        changedConfig: 'security_policies',
        previousValue: 'strict',
        newValue: 'moderate',
        changeMethod: 'web_interface',
        justification: 'temporary_maintenance'
      }
    },

    vulnerabilityDiscovered: {
      type: 'system',
      subtype: 'vulnerability_discovered',
      userId: 'system',
      ip: '127.0.0.1',
      userAgent: 'security-scanner/1.0',
      timestamp: '2023-12-01T17:00:00Z',
      severity: 'critical',
      metadata: {
        vulnerabilityName: 'CVE-2023-1234',
        affectedComponent: 'express',
        severityScore: 9.8,
        description: 'Remote code execution vulnerability',
        remediation: 'upgrade to version 4.18.3',
        discoveredBy: 'automated_scan'
      }
    },

    systemError: {
      type: 'system',
      subtype: 'system_error',
      userId: 'system',
      ip: '127.0.0.1',
      userAgent: 'node/18.17.0',
      timestamp: '2023-12-01T18:00:00Z',
      severity: 'error',
      metadata: {
        errorType: 'DatabaseConnectionError',
        errorMessage: 'Connection timeout to database',
        component: 'authentication_service',
        stackTrace: 'Error: Connection timeout...',
        impact: 'authentication_failures'
      }
    }
  },

  // Compliance events
  compliance: {
    reportGenerated: {
      type: 'compliance',
      subtype: 'report_generated',
      userId: 'auditor123',
      ip: '192.168.1.90',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timestamp: '2023-12-01T19:00:00Z',
      severity: 'info',
      metadata: {
        reportType: 'gdpr_compliance',
        timePeriod: '2023-11-01 to 2023-11-30',
        format: 'pdf',
        size: '2.5MB',
        recipient: 'compliance_officer@company.com'
      }
    },

    evidenceCollected: {
      type: 'compliance',
      subtype: 'evidence_collected',
      userId: 'system',
      ip: '127.0.0.1',
      userAgent: 'compliance-bot/1.0',
      timestamp: '2023-12-01T20:00:00Z',
      severity: 'info',
      metadata: {
        complianceFramework: 'SOC2',
        controlId: 'A1-1',
        evidenceType: 'access_logs',
        evidenceCount: 1500,
        retentionPeriod: 3650,
        storageLocation: 'secure_blob_storage'
      }
    }
  }
};

// Attack scenarios for penetration testing
const attackScenarios = {
  sqlInjection: {
    description: 'SQL Injection attack attempt',
    requests: [
      {
        url: '/api/users?id=1\' OR 1=1 --',
        method: 'GET',
        headers: { 'User-Agent': 'sqlmap/1.0' },
        expectedDetection: true
      },
      {
        url: '/api/login',
        method: 'POST',
        body: { username: "admin'; DROP TABLE users; --", password: 'password' },
        expectedDetection: true
      }
    ]
  },

  xss: {
    description: 'Cross-Site Scripting attack attempt',
    requests: [
      {
        url: '/api/profile',
        method: 'POST',
        body: { bio: '<script>alert("XSS")</script>' },
        expectedDetection: true
      },
      {
        url: '/api/search?q=<img src=x onerror=alert("XSS")>',
        method: 'GET',
        expectedDetection: true
      }
    ]
  },

  bruteForce: {
    description: 'Brute force password attack',
    requests: [
      {
        url: '/api/login',
        method: 'POST',
        body: { username: 'admin', password: 'password1' },
        expectedDetection: false
      },
      {
        url: '/api/login',
        method: 'POST',
        body: { username: 'admin', password: 'password2' },
        expectedDetection: false
      },
      {
        url: '/api/login',
        method: 'POST',
        body: { username: 'admin', password: 'password3' },
        expectedDetection: true // Should trigger after multiple attempts
      }
    ]
  },

  ddos: {
    description: 'Denial of Service attack simulation',
    requests: Array.from({ length: 100 }, (_, i) => ({
      url: '/api/heavy-endpoint',
      method: 'GET',
      timestamp: new Date(Date.now() + i * 100).toISOString(),
      expectedDetection: i > 50 // Should detect after threshold
    }))
  }
};

// Performance test scenarios
const performanceScenarios = {
  highVolumeEvents: {
    description: 'High volume security events',
    eventCount: 1000,
    eventsPerSecond: 100,
    duration: 10, // seconds
    eventType: 'authentication',
    eventTemplate: {
      type: 'authentication',
      subtype: 'login_attempt',
      userId: 'user{index}',
      ip: '192.168.1.{index % 255}',
      timestamp: 'auto-generate',
      severity: 'info',
      metadata: {}
    }
  },

  complexEventProcessing: {
    description: 'Complex event processing with correlation',
    eventChains: [
      {
        events: [
          { type: 'authentication', subtype: 'login_failure' },
          { type: 'authentication', subtype: 'login_failure' },
          { type: 'authentication', subtype: 'login_failure' },
          { type: 'authentication', subtype: 'account_lockout' }
        ],
        expectedCorrelation: true
      }
    ]
  }
};

module.exports = {
  securityScenarios,
  attackScenarios,
  performanceScenarios
};