const { Pool } = require('pg');
const config = require('../src/shared/config/environment');

// Test database configuration
const testConfig = {
  ...config.database,
  database: process.env.TEST_DB_NAME || config.database.name + '_test'
};

// Create test database connection pool
const testPool = new Pool(testConfig);

// Global setup and teardown
beforeAll(async () => {
  // Connect to test database
  await testPool.connect();

  // Run database migrations
  await runMigrations();
});

afterAll(async () => {
  // Clean up test database
  await cleanupTestDatabase();

  // Close database connection
  await testPool.end();
});

beforeEach(async () => {
  // Clean up test data before each test
  await cleanupTestData();
});

// Run database migrations
async function runMigrations() {
  const migrations = [
    '001_create_users.sql',
    '002_create_email_tokens.sql',
    '003_create_refresh_tokens.sql',
    '004_create_oauth_providers.sql'
  ];

  for (const migration of migrations) {
    const migrationPath = `./src/database/migrations/${migration}`;
    try {
      const fs = require('fs');
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      await testPool.query(migrationSQL);
      console.log(`Migration ${migration} executed successfully`);
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.error(`Migration ${migration} failed:`, error);
        throw error;
      }
    }
  }
}

// Clean up test database
async function cleanupTestDatabase() {
  try {
    // Drop all tables in reverse order of creation
    const tables = [
      'oauth_providers',
      'refresh_tokens',
      'email_tokens',
      'users'
    ];

    for (const table of tables) {
      await testPool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  } catch (error) {
    console.error('Failed to cleanup test database:', error);
  }
}

// Clean up test data between tests
async function cleanupTestData() {
  try {
    // Delete all test data but keep table structure
    await testPool.query('DELETE FROM oauth_providers');
    await testPool.query('DELETE FROM refresh_tokens');
    await testPool.query('DELETE FROM email_tokens');
    await testPool.query('DELETE FROM users');
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

// Export test database pool for use in tests
module.exports = {
  testPool,
  cleanupTestData
};