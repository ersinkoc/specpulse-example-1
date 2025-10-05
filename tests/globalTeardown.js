module.exports = async () => {
  // Global cleanup after all tests
  console.log('🧹 Starting global test teardown...');

  // Any global cleanup can go here
  // Close database connections, stop services, etc.

  console.log('✅ Global test teardown complete');
};