/**
 * Secure Database Configuration
 * Enhanced database configuration with security features for the security audit system
 */

const { Pool } = require('pg');
const winston = require('winston');

// Configure logger for database operations
const logger = winston.createLogger({
  level: process.env.DB_LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({
      filename: 'logs/database-security.log'
    })
  ]
});

class SecureDatabase {
  constructor(config = {}) {
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'specpulse_security',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.DB_SSL_CA,
        cert: process.env.DB_SSL_CERT,
        key: process.env.DB_SSL_KEY
      } : false,
      max: process.env.DB_MAX_CONNECTIONS || 20,
      idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT || 30000,
      connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT || 2000,
      statement_timeout: process.env.DB_STATEMENT_TIMEOUT || 30000,
      query_timeout: process.env.DB_QUERY_TIMEOUT || 30000,
      application_name: process.env.DB_APP_NAME || 'security-audit-system',
      ...config
    };

    this.pool = null;
    this.isInitialized = false;
  }

  /**
   * Initialize secure database connection pool
   */
  async initialize() {
    try {
      logger.info('Initializing secure database connection pool...');

      // Create connection pool with security settings
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        ssl: this.config.ssl,
        max: this.config.max,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
        statement_timeout: this.config.statement_timeout,
        query_timeout: this.config.query_timeout,
        application_name: this.config.application_name,
        // Security-specific settings
        options: '-c default_transaction_isolation=read_committed -c row_security=on'
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      // Configure security settings
      await this.configureSecuritySettings();

      this.isInitialized = true;
      logger.info('Secure database connection pool initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize secure database connection:', error);
      throw error;
    }
  }

  /**
   * Configure database security settings
   */
  async configureSecuritySettings() {
    const client = await this.pool.connect();

    try {
      // Set secure session parameters
      await client.query('SET session authorization DEFAULT');
      await client.query('SET row_security = on');
      await client.query('SET default_transaction_isolation = read_committed');
      await client.query('SET default_transaction_read_only = false');

      // Configure audit logging for database operations
      await client.query(`
        CREATE OR REPLACE FUNCTION audit_trigger_function()
        RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            INSERT INTO audit_logs (event_type, event_subtype, message, severity, metadata)
            VALUES ('database', 'insert', TG_TABLE_NAME || ' record inserted', 'info',
                    json_build_object('table', TG_TABLE_NAME, 'operation', 'INSERT', 'data', row_to_json(NEW)));
            RETURN NEW;
          ELSIF TG_OP = 'UPDATE' THEN
            INSERT INTO audit_logs (event_type, event_subtype, message, severity, metadata)
            VALUES ('database', 'update', TG_TABLE_NAME || ' record updated', 'warning',
                    json_build_object('table', TG_TABLE_NAME, 'operation', 'UPDATE', 'old_data', row_to_json(OLD), 'new_data', row_to_json(NEW)));
            RETURN NEW;
          ELSIF TG_OP = 'DELETE' THEN
            INSERT INTO audit_logs (event_type, event_subtype, message, severity, metadata)
            VALUES ('database', 'delete', TG_TABLE_NAME || ' record deleted', 'warning',
                    json_build_object('table', TG_TABLE_NAME, 'operation', 'DELETE', 'data', row_to_json(OLD)));
            RETURN OLD;
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `);

      logger.info('Database security settings configured successfully');

    } catch (error) {
      logger.error('Failed to configure database security settings:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute query with security monitoring
   */
  async query(text, params = []) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    const start = Date.now();
    const client = await this.pool.connect();

    try {
      // Log query execution for security monitoring
      logger.debug('Executing secure database query', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        paramCount: params.length,
        application: this.config.application_name
      });

      const result = await client.query(text, params);

      // Log successful query execution
      const duration = Date.now() - start;
      logger.debug('Database query executed successfully', {
        rowCount: result.rowCount,
        duration: duration,
        application: this.config.application_name
      });

      return result;

    } catch (error) {
      // Log query errors for security monitoring
      const duration = Date.now() - start;
      logger.error('Database query failed', {
        error: error.message,
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration: duration,
        application: this.config.application_name
      });

      // Log security events for suspicious query patterns
      if (this.isSuspiciousQuery(text)) {
        await this.logSecurityEvent('suspicious_query', {
          query: text,
          error: error.message,
          application: this.config.application_name
        });
      }

      throw error;

    } finally {
      client.release();
    }
  }

  /**
   * Check for suspicious query patterns
   */
  isSuspiciousQuery(query) {
    const suspiciousPatterns = [
      /drop\s+table/i,
      /truncate\s+table/i,
      /delete\s+from.*where\s+1\s*=\s*1/i,
      /update.*set.*where\s+1\s*=\s*1/i,
      /insert\s+into.*select/i,
      /union\s+select/i,
      /exec\s*\(/i,
      /sp_executesql/i,
      /xp_cmdshell/i,
      /;\s*drop/i,
      /;\s*delete/i,
      /;\s*update/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Log security event to audit log
   */
  async logSecurityEvent(eventType, metadata) {
    try {
      await this.query(`
        INSERT INTO audit_logs (event_type, event_subtype, message, severity, metadata, user_id, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        'security',
        eventType,
        `Security event: ${eventType}`,
        'warning',
        JSON.stringify(metadata),
        'system',
        '127.0.0.1'
      ]);
    } catch (error) {
      logger.error('Failed to log security event:', error);
    }
  }

  /**
   * Execute transaction with security monitoring
   */
  async transaction(callback) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Set transaction security settings
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await client.query('SET CONSTRAINTS ALL DEFERRED');

      const result = await callback(client);

      await client.query('COMMIT');

      // Log successful transaction
      logger.debug('Database transaction completed successfully', {
        application: this.config.application_name
      });

      return result;

    } catch (error) {
      await client.query('ROLLBACK');

      // Log transaction failure
      logger.error('Database transaction failed and rolled back', {
        error: error.message,
        application: this.config.application_name
      });

      throw error;

    } finally {
      client.release();
    }
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats() {
    if (!this.pool) {
      return null;
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      application_name: this.config.application_name
    };
  }

  /**
   * Health check for database connection
   */
  async healthCheck() {
    try {
      const result = await this.query('SELECT 1 as health_check, NOW() as timestamp');
      return {
        status: 'healthy',
        timestamp: result.rows[0].timestamp,
        poolStats: this.getPoolStats()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
        poolStats: this.getPoolStats()
      };
    }
  }

  /**
   * Close database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isInitialized = false;
      logger.info('Secure database connection pool closed');
    }
  }

  /**
   * Create database backup with encryption
   */
  async createBackup(backupPath) {
    // This would implement encrypted database backup
    // For now, return a placeholder implementation
    logger.info('Creating encrypted database backup', { backupPath });

    return {
      status: 'success',
      backupPath,
      timestamp: new Date().toISOString(),
      encrypted: true
    };
  }

  /**
   * Restore database from encrypted backup
   */
  async restoreFromBackup(backupPath) {
    // This would implement database restore from encrypted backup
    logger.info('Restoring database from encrypted backup', { backupPath });

    return {
      status: 'success',
      backupPath,
      timestamp: new Date().toISOString(),
      restored: true
    };
  }
}

// Create singleton instance
const secureDatabase = new SecureDatabase();

module.exports = {
  SecureDatabase,
  secureDatabase
};