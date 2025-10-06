/**
 * Audit Log Model
 * Tamper-proof audit logging with cryptographic integrity verification
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class AuditLog {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.timestamp = data.timestamp || new Date();
    this.eventType = data.eventType;
    this.eventSubtype = data.eventSubtype;
    this.userId = data.userId || null;
    this.ipAddress = data.ipAddress || null;
    this.userAgent = data.userAgent || null;
    this.method = data.method || null;
    this.url = data.url || null;
    this.statusCode = data.statusCode || null;
    this.responseTime = data.responseTime || null;
    this.severity = data.severity || 'info';
    this.message = data.message;
    this.metadata = data.metadata || {};
    this.signatureHash = data.signatureHash || null;
    this.createdAt = data.createdAt || new Date();
  }

  /**
   * Generate cryptographic signature for audit log integrity
   */
  generateSignature() {
    const dataString = [
      this.timestamp.toISOString(),
      this.eventType,
      this.eventSubtype,
      this.userId || '',
      this.ipAddress || '',
      this.userAgent || '',
      this.method || '',
      this.url || '',
      this.statusCode || '',
      this.responseTime || '',
      this.severity,
      this.message,
      JSON.stringify(this.metadata)
    ].join('|');

    this.signatureHash = crypto
      .createHash('sha256')
      .update(dataString)
      .digest('hex');

    return this.signatureHash;
  }

  /**
   * Verify audit log integrity
   */
  verifyIntegrity() {
    if (!this.signatureHash) {
      return false;
    }

    const originalHash = this.signatureHash;
    const currentHash = this.generateSignature();

    return originalHash === currentHash;
  }

  /**
   * Create audit log from event data
   */
  static fromEvent(eventData) {
    const auditLog = new AuditLog({
      eventType: eventData.type,
      eventSubtype: eventData.subtype,
      userId: eventData.userId,
      ipAddress: eventData.ip,
      userAgent: eventData.userAgent,
      method: eventData.method,
      url: eventData.url,
      statusCode: eventData.statusCode,
      responseTime: eventData.responseTime,
      severity: eventData.severity,
      message: eventData.message || `${eventData.type}:${eventData.subtype}`,
      metadata: eventData.metadata || {}
    });

    // Generate signature for integrity
    auditLog.generateSignature();

    return auditLog;
  }

  /**
   * Convert to database format
   */
  toDbRow() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      event_type: this.eventType,
      event_subtype: this.eventSubtype,
      user_id: this.userId,
      ip_address: this.ipAddress,
      user_agent: this.userAgent,
      method: this.method,
      url: this.url,
      status_code: this.statusCode,
      response_time: this.responseTime,
      severity: this.severity,
      message: this.message,
      metadata: JSON.stringify(this.metadata),
      signature_hash: this.signatureHash,
      created_at: this.createdAt
    };
  }

  /**
   * Create from database row
   */
  static fromDbRow(row) {
    return new AuditLog({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      eventSubtype: row.event_subtype,
      userId: row.user_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      method: row.method,
      url: row.url,
      statusCode: row.status_code,
      responseTime: row.response_time,
      severity: row.severity,
      message: row.message,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      signatureHash: row.signature_hash,
      createdAt: row.created_at
    });
  }

  /**
   * Validate audit log data
   */
  validate() {
    const errors = [];

    if (!this.eventType) {
      errors.push('Event type is required');
    }

    if (!this.eventSubtype) {
      errors.push('Event subtype is required');
    }

    if (!this.message) {
      errors.push('Message is required');
    }

    const validSeverities = ['debug', 'info', 'warning', 'error', 'critical'];
    if (!validSeverities.includes(this.severity)) {
      errors.push('Severity must be one of: debug, info, warning, error, critical');
    }

    if (this.responseTime && (this.responseTime < 0 || this.responseTime > 300000)) {
      errors.push('Response time must be between 0 and 300000 milliseconds');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize sensitive data
   */
  sanitize() {
    // Remove sensitive fields from metadata
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'cookie',
      'session'
    ];

    const sanitizedMetadata = { ...this.metadata };

    for (const field of sensitiveFields) {
      if (sanitizedMetadata[field]) {
        sanitizedMetadata[field] = '[REDACTED]';
      }
    }

    // Sanitize URL for sensitive parameters
    if (this.url) {
      this.url = this.url.replace(/([?&])(password|token|secret|key|auth)=[^&]*/gi, '$1$2=[REDACTED]');
    }

    // Sanitize user agent for potential sensitive info
    if (this.userAgent) {
      // Remove potential tokens from user agent
      this.userAgent = this.userAgent.replace(/Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, 'Bearer [REDACTED]');
    }

    this.metadata = sanitizedMetadata;
  }

  /**
   * Get log level priority for filtering
   */
  getSeverityPriority() {
    const priorities = {
      debug: 0,
      info: 1,
      warning: 2,
      error: 3,
      critical: 4
    };
    return priorities[this.severity] || 1;
  }

  /**
   * Check if log is high severity
   */
  isHighSeverity() {
    return ['error', 'critical'].includes(this.severity);
  }

  /**
   * Check if log is security relevant
   */
  isSecurityRelevant() {
    const securityEventTypes = [
      'authentication',
      'authorization',
      'data',
      'system',
      'compliance'
    ];
    return securityEventTypes.includes(this.eventType);
  }

  /**
   * Convert to JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp.toISOString(),
      eventType: this.eventType,
      eventSubtype: this.eventSubtype,
      userId: this.userId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      method: this.method,
      url: this.url,
      statusCode: this.statusCode,
      responseTime: this.responseTime,
      severity: this.severity,
      message: this.message,
      metadata: this.metadata,
      createdAt: this.createdAt.toISOString(),
      integrityVerified: this.verifyIntegrity()
    };
  }

  /**
   * Create summary representation
   */
  toSummary() {
    return {
      id: this.id,
      timestamp: this.timestamp.toISOString(),
      eventType: this.eventType,
      eventSubtype: this.eventSubtype,
      severity: this.severity,
      message: this.message,
      userId: this.userId,
      ipAddress: this.ipAddress
    };
  }
}

module.exports = AuditLog;