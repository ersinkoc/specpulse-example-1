const { Pool } = require('pg');
const config = require('../shared/config/environment');
const logger = require('../shared/utils/logger');

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  async initialize() {
    try {
      this.pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
        ssl: config.database.ssl,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis,
        // Add connection timeout and retry logic
        connectionTimeoutMillis: 5000,
        // Enable query logging in development
        ...(config.server.nodeEnv === 'development' && {
          log: (message) => logger.debug('Database query:', message)
        })
      });

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isConnected = true;
      logger.info('Database connection established successfully');

      // Handle pool errors
      this.pool.on('error', (err) => {
        logger.error('Unexpected database pool error:', err);
        this.isConnected = false;
      });

      this.pool.on('connect', (client) => {
        logger.debug('New database client connected');
      });

      this.pool.on('remove', (client) => {
        logger.debug('Database client removed');
      });

      return this.pool;
    } catch (error) {
      logger.error('Failed to initialize database connection:', error);
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }

  async query(text, params) {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call initialize() first.');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      logger.debug('Database query executed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: result.rowCount
      });

      return result;
    } catch (error) {
      logger.error('Database query failed:', {
        query: text.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  async getClient() {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call initialize() first.');
    }
    return this.pool.connect();
  }

  async transaction(callback) {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }

  async healthCheck() {
    try {
      const result = await this.query('SELECT 1 as health');
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingConnections: this.pool.waitingCount
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  // Migration utilities
  async runMigration(migrationName, migrationSQL) {
    try {
      await this.transaction(async (client) => {
        // Check if migration already exists
        const existingMigration = await client.query(
          'SELECT * FROM migrations WHERE name = $1',
          [migrationName]
        );

        if (existingMigration.rows.length > 0) {
          logger.info(`Migration ${migrationName} already exists, skipping`);
          return;
        }

        // Run migration
        await client.query(migrationSQL);

        // Record migration
        await client.query(
          'INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())',
          [migrationName]
        );

        logger.info(`Migration ${migrationName} executed successfully`);
      });
    } catch (error) {
      logger.error(`Migration ${migrationName} failed:`, error);
      throw error;
    }
  }

  // Initialize migrations table
  async initializeMigrations() {
    const createMigrationsTable = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      await this.query(createMigrationsTable);
      logger.info('Migrations table initialized');
    } catch (error) {
      logger.error('Failed to initialize migrations table:', error);
      throw error;
    }
  }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;