module.exports = async () => {
  // Global setup for all tests
  console.log('🚀 Starting global test setup...');

  // Set test environment
  process.env.NODE_ENV = 'test';

  // Any additional global setup can go here
  console.log('✅ Global test setup complete');
};