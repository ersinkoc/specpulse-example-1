/**
 * Audit Logger
 * Tamper-proof audit logging system with cryptographic integrity verification
 */

const winston = require('winston');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { secureDatabase } = require('../../../config/database-security');
const AuditLog = require('../../../models/security/AuditLog');

class AuditLogger {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'info',
      logDirectory: config.logDirectory || path.join(process.cwd(), 'logs', 'audit'),
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 30,
      enableFileLogging: config.enableFileLogging !== false,
      enableDatabaseLogging: config.enableDatabaseLogging !== false,
      enableConsoleLogging: config.enableConsoleLogging || false,
      encryptionKey: config.encryptionKey || process.env.AUDIT_ENCRYPTION_KEY,
      signingKey: config.signingKey || process.env.AUDIT_SIGNING_KEY,
      bufferSize: config.bufferSize || 100,
      flushInterval: config.flushInterval || 5000, // 5 seconds
      retentionDays: config.retentionDays || 2555, // 7 years
      ...config
    };

    this.logBuffer = [];
    this.flushTimer = null;
    this.isInitialized = false;

    // Initialize logging system
    this.initialize();
  }

  /**
   * Initialize audit logging system
   */
  async initialize() {
    try {
      // Ensure log directory exists
      if (this.config.enableFileLogging) {
        await this.ensureLogDirectory();
      }

      // Initialize Winston logger
      this.winstonLogger = this.createWinstonLogger();

      // Initialize database connection if enabled
      if (this.config.enableDatabaseLogging) {
        await this.initializeDatabase();
      }

      // Start periodic buffer flush
      this.startBufferFlush();

      this.isInitialized = true;
      console.log('Audit logger initialized successfully');

    } catch (error) {
      console.error('Failed to initialize audit logger:', error);
      throw error;
    }
  }

  /**
   * Ensure log directory exists
   */
  async ensureLogDirectory() {
    try {
      await fs.promises.mkdir(this.config.logDirectory, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create log directory: ${error.message}`);
    }
  }

  /**
   * Create Winston logger with security configuration
   */
  createWinstonLogger() {
    const transports = [];

    // File transport with rotation
    if (this.config.enableFileLogging) {
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.logDirectory, 'audit.log'),
          maxsize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
          level: this.config.level
        })
      );

      // Error log file
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.logDirectory, 'audit-error.log'),
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        })
      );
    }

    // Console transport (only in development)
    if (this.config.enableConsoleLogging && process.env.NODE_ENV !== 'production') {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.timestamp()
          )
        })
      );
    }

    return winston.createLogger({
      level: this.config.level,
      transports,
      // Handle uncaught exceptions
      exceptionHandlers: [
        new winston.transports.File({
          filename: path.join(this.config.logDirectory, 'audit-exceptions.log')
        })
      ],
      // Handle unhandled rejections
      rejectionHandlers: [
        new winston.transports.File({
          filename: path.join(this.config.logDirectory, 'audit-rejections.log')
        })
      ]
    });
  }

  /**
   * Initialize database connection for audit logging
   */
  async initializeDatabase() {
    try {
      await secureDatabase.initialize();
    } catch (error) {
      console.warn('Failed to initialize database for audit logging:', error.message);
      this.config.enableDatabaseLogging = false;
    }
  }

  /**
   * Start periodic buffer flush
   */
  startBufferFlush() {
    this.flushTimer = setInterval(() => {
      this.flushBuffer();
    }, this.config.flushInterval);
  }

  /**
   * Log audit event
   */
  async log(eventData) {
    if (!this.isInitialized) {
      throw new Error('Audit logger not initialized');
    }

    try {
      // Create audit log object
      const auditLog = AuditLog.fromEvent(eventData);

      // Sanitize sensitive data
      auditLog.sanitize();

      // Generate cryptographic signature
      auditLog.generateSignature();

      // Add to buffer
      this.addToBuffer(auditLog);

      return auditLog.id;

    } catch (error) {
      console.error('Failed to log audit event:', error);
      throw error;
    }
  }

  /**
   * Add audit log to buffer
   */
  addToBuffer(auditLog) {
    this.logBuffer.push(auditLog);

    // Flush buffer if it's full
    if (this.logBuffer.length >= this.config.bufferSize) {
      this.flushBuffer();
    }
  }

  /**
   * Flush buffer to all configured destinations
   */
  async flushBuffer() {
    if (this.logBuffer.length === 0) {
      return;
    }

    const logsToFlush = [...this.logBuffer];
    this.logBuffer = [];

    const flushPromises = [];

    // Flush to file
    if (this.config.enableFileLogging) {
      flushPromises.push(this.flushToFile(logsToFlush));
    }

    // Flush to database
    if (this.config.enableDatabaseLogging) {
      flushPromises.push(this.flushToDatabase(logsToFlush));
    }

    // Wait for all flush operations to complete
    try {
      await Promise.allSettled(flushPromises);
    } catch (error) {
      console.error('Error during buffer flush:', error);
    }
  }

  /**
   * Flush logs to file
   */
  async flushToFile(logs) {
    try {
      for (const log of logs) {
        this.winstonLogger.info('audit_event', log.toJSON());
      }
    } catch (error) {
      console.error('Failed to flush logs to file:', error);
    }
  }

  /**
   * Flush logs to database
   */
  async flushToDatabase(logs) {
    try {
      const values = logs.map(log => {
        const dbRow = log.toDbRow();
        return [
          dbRow.id,
          dbRow.timestamp,
          dbRow.event_type,
          dbRow.event_subtype,
          dbRow.user_id,
          dbRow.ip_address,
          dbRow.user_agent,
          dbRow.method,
          dbRow.url,
          dbRow.status_code,
          dbRow.response_time,
          dbRow.severity,
          dbRow.message,
          dbRow.metadata,
          dbRow.signature_hash,
          dbRow.created_at
        ];
      });

      const placeholders = values.map((_, index) => {
        const offset = index * 15;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`;
      }).join(', ');

      const query = `
        INSERT INTO audit_logs (
          id, timestamp, event_type, event_subtype, user_id, ip_address,
          user_agent, method, url, status_code, response_time, severity,
          message, metadata, signature_hash, created_at
        ) VALUES ${placeholders}
      `;

      const flatValues = values.flat();
      await secureDatabase.query(query, flatValues);

    } catch (error) {
      console.error('Failed to flush logs to database:', error);
    }
  }

  /**
   * Query audit logs
   */
  async query(filters = {}) {
    if (!this.config.enableDatabaseLogging) {
      throw new Error('Database logging not enabled');
    }

    try {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      // Add filters
      if (filters.eventType) {
        query += ` AND event_type = $${paramIndex++}`;
        params.push(filters.eventType);
      }

      if (filters.severity) {
        query += ` AND severity = $${paramIndex++}`;
        params.push(filters.severity);
      }

      if (filters.userId) {
        query += ` AND user_id = $${paramIndex++}`;
        params.push(filters.userId);
      }

      if (filters.startDate) {
        query += ` AND timestamp >= $${paramIndex++}`;
        params.push(filters.startDate);
      }

      if (filters.endDate) {
        query += ` AND timestamp <= $${paramIndex++}`;
        params.push(filters.endDate);
      }

      // Add ordering and limiting
      query += ' ORDER BY timestamp DESC';
      if (filters.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      }

      const result = await secureDatabase.query(query, params);
      return result.rows.map(row => AuditLog.fromDbRow(row));

    } catch (error) {
      console.error('Failed to query audit logs:', error);
      throw error;
    }
  }

  /**
   * Verify log integrity
   */
  async verifyIntegrity(logId) {
    if (!this.config.enableDatabaseLogging) {
      throw new Error('Database logging not enabled');
    }

    try {
      const result = await secureDatabase.query(
        'SELECT * FROM audit_logs WHERE id = $1',
        [logId]
      );

      if (result.rows.length === 0) {
        return { valid: false, error: 'Log not found' };
      }

      const auditLog = AuditLog.fromDbRow(result.rows[0]);
      const isValid = auditLog.verifyIntegrity();

      return {
        valid: isValid,
        logId: logId,
        timestamp: auditLog.timestamp,
        signatureMatch: isValid
      };

    } catch (error) {
      console.error('Failed to verify log integrity:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Clean up old logs
   */
  async cleanup() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    try {
      // Clean up file logs (handled by Winston rotation)

      // Clean up database logs
      if (this.config.enableDatabaseLogging) {
        const result = await secureDatabase.query(
          'DELETE FROM audit_logs WHERE timestamp < $1',
          [cutoffDate]
        );

        console.log(`Cleaned up ${result.rowCount} old audit logs`);
      }

    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
    }
  }

  /**
   * Get statistics
   */
  async getStatistics() {
    try {
      const stats = {
        bufferLength: this.logBuffer.length,
        isInitialized: this.isInitialized,
        fileLoggingEnabled: this.config.enableFileLogging,
        databaseLoggingEnabled: this.config.enableDatabaseLogging
      };

      if (this.config.enableDatabaseLogging) {
        const dbStats = await secureDatabase.query(`
          SELECT
            COUNT(*) as total_logs,
            COUNT(*) FILTER (WHERE severity = 'critical') as critical_logs,
            COUNT(*) FILTER (WHERE severity = 'error') as error_logs,
            COUNT(*) FILTER (WHERE severity = 'warning') as warning_logs,
            COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') as logs_last_24h
          FROM audit_logs
        `);

        stats.database = dbStats.rows[0];
      }

      return stats;

    } catch (error) {
      console.error('Failed to get statistics:', error);
      return { error: error.message };
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('Shutting down audit logger...');

    // Clear flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Flush remaining logs
    await this.flushBuffer();

    // Close database connection
    if (this.config.enableDatabaseLogging) {
      await secureDatabase.close();
    }

    console.log('Audit logger shutdown complete');
  }
}

// Create singleton instance
const auditLogger = new AuditLogger();

module.exports = {
  AuditLogger,
  auditLogger
};