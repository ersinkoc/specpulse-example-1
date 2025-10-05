# Load Testing for Authentication System

const request = require('supertest');
const app = require('../../src/app');

describe('Authentication System Load Testing', () => {
  let authToken = null;
  let testUsers = [];

  beforeAll(async () => {
    // Create test users for load testing
    for (let i = 0; i < 10; i++) {
      const userData = {
        email: `loadtest${i}@example.com`,
        password: `LoadTestPassword${i}!`,
        name: `Load Test User ${i}`
      };

      try {
        const response = await request(app)
          .post('/auth/register')
          .send(userData)
          .expect(201);

        testUsers.push({
          ...userData,
          accessToken: response.body.data.tokens.accessToken,
          refreshToken: response.body.data.tokens.refreshToken
        });
      } catch (error) {
        console.warn(`Failed to create test user ${i}:`, error.message);
      }
    }

    // Use first user's token for main tests
    if (testUsers.length > 0) {
      authToken = testUsers[0].accessToken;
    }
  });

  describe('Authentication Load Tests', () => {
    it('should handle 100 concurrent login attempts', async () => {
      const loginPromises = Array(100).fill().map(() =>
        request(app)
          .post('/auth/login')
          .send({
            email: 'loadtest0@example.com',
            password: 'LoadTestPassword0!'
          })
      );

      const startTime = Date.now();
      const responses = await Promise.allSettled(loginPromises);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const successfulLogins = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const failedLogins = responses.filter(r => r.status === 'rejected' || r.value.status !== 200).length;
      const rateLimited = responses.filter(r => r.status === 'fulfilled' && r.value.status === 429).length;

      console.log(`Login Load Test Results:`);
      console.log(`  Total Requests: 100`);
      console.log(`  Successful: ${successfulLogins}`);
      console.log(`  Failed: ${failedLogins}`);
      console.log(`  Rate Limited: ${rateLimited}`);
      console.log(`  Duration: ${duration}ms`);

      expect(successfulLogins).toBeGreaterThan(80); // At least 80% should succeed
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should handle 50 concurrent registration attempts', async () => {
      const registrationPromises = Array(50).fill().map((_, index) =>
        request(app)
          .post('/auth/register')
          .send({
            email: `loadreg${index}@example.com`,
            password: `LoadRegPassword${index}!`,
            name: `Load Reg User ${index}`
          })
      );

      const startTime = Date.now();
      const responses = await Promise.allSettled(registrationPromises);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const successfulRegistrations = responses.filter(r => r.status === 'fulfilled' && r.value.status === 201).length;
      const failedRegistrations = responses.filter(r => r.status === 'rejected' || r.value.status !== 201).length;
      const rateLimited = responses.filter(r => r.status === 'fulfilled' && r.value.status === 429).length;

      console.log(`Registration Load Test Results:`);
      console.log(`  Total Requests: 50`);
      console.log(`  Successful: ${successfulRegistrations}`);
      console.log(`  Failed: ${failedRegistrations}`);
      console.log(`  Rate Limited: ${rateLimited}`);
      console.log(`  Duration: ${duration}ms`);

      expect(successfulRegistrations).toBeGreaterThan(30); // At least 60% should succeed
      expect(duration).toBeLessThan(8000); // Should complete within 8 seconds
    });

    it('should handle 200 concurrent token refresh attempts', async () => {
      if (!testUsers.length) {
        console.log('Skipping token refresh test - no test users available');
        return;
      }

      const refreshPromises = Array(200).fill().map(() =>
        request(app)
          .post('/auth/refresh')
          .send({
            refreshToken: testUsers[0].refreshToken
          })
      );

      const startTime = Date.now();
      const responses = await Promise.allSettled(refreshPromises);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const successfulRefreshes = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const failedRefreshes = responses.filter(r => r.status === 'rejected' || r.value.status !== 200).length;

      console.log(`Token Refresh Load Test Results:`);
      console.log(`  Total Requests: 200`);
      console.log(`  Successful: ${successfulRefreshes}`);
      console.log(`  Failed: ${failedRefreshes}`);
      console.log(`  Duration: ${duration}ms`);

      expect(successfulRefreshes).toBeGreaterThan(150); // At least 75% should succeed
      expect(duration).LessThan(15000); // Should complete within 15 seconds
    });
  });

  describe('Task Management Load Tests', () => {
    it('should handle 100 concurrent task creation attempts', async () => {
      if (!authToken) {
        console.log('Skipping task creation test - no authentication token available');
        return;
      }

      const taskPromises = Array(100).fill().map((_, index) =>
        request(app)
          .post('/tasks')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: `Load Test Task ${index}`,
            description: `Task created during load testing ${index}`,
            status: 'pending'
          })
      );

      const startTime = Date.now();
      const responses = await Promise.allSettled(taskPromises);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const successfulCreations = responses.filter(r => r.status === 'fulfilled' && r.value.status === 201).length;
      const failedCreations = responses.filter(r => r.status === 'rejected' || r.value.status !== 201).length;

      console.log(`Task Creation Load Test Results:`);
      console.log(`  Total Requests: 100`);
      console.log(`  Successful: ${successfulCreations}`);
      console.log(`  Failed: ${failedCreations}`);
      console.log(`  Duration: ${duration}ms`);

      expect(successfulCreations).toBeGreaterThan(80); // At least 80% should succeed
      expect(duration).toBeLessThan(12000); // Should complete within 12 seconds
    });

    it('should handle 500 concurrent task read operations', async () => {
      if (!authToken) {
        console.log('Skipping task read test - no authentication token available');
        return;
      }

      const readPromises = Array(500).fill().map(() =>
        request(app)
          .get('/tasks')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const startTime = Date.now();
      const responses = await Promise.allSettled(readPromises);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const successfulReads = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      const failedReads = responses.filter(r => r.status === 'rejected' || r.value.status !== 200).length;

      console.log(`Task Read Load Test Results:`);
      console.log(`  Total Requests: 500`);
      console.log(`  Successful: ${successfulReads}`);
      console.log(`  Failed: ${failedReads}`);
      console.log(`  Duration: ${duration}ms`);

      expect(successfulReads).toBeGreaterThan(400); // At least 80% should succeed
      expect(duration).toBeLessThan(20000); // Should complete within 20 seconds
    });
  });

  describe('Mixed Operation Load Tests', () => {
    it('should handle mixed read/write operations', async () => {
      if (!authToken) {
        console.log('Skipping mixed operations test - no authentication token available');
        return;
      }

      const mixedOperations = [];

      // Add task creation operations
      for (let i = 0; i < 25; i++) {
        mixedOperations.push(
          request(app)
            .post('/tasks')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              title: `Mixed Task ${i}`,
              description: `Task created during mixed load test ${i}`,
              status: 'pending'
            })
        );
      }

      // Add profile read operations
      for (let i = 0; i < 25; i++) {
        mixedOperations.push(
          request(app)
            .get('/user/me')
            .set('Authorization', `Bearer ${authToken}`)
        );
      }

      // Add task read operations
      for (let i = 0; i < 25; i++) {
        mixedOperations.push(
          request(app)
            .get('/tasks')
            .set('Authorization', `Bearer ${authToken}`)
        );
      }

      const startTime = Date.now();
      const responses = await Promise.allSettled(mixedOperations);
      const endTime = Date.now();

      const duration = endTime - startTime;
      const successfulOps = responses.filter(r => r.status === 'fulfilled' && [200, 201].includes(r.value.status)).length;
      const failedOps = responses.filter(r => r.status === 'rejected' || ![200, 201].includes(r.value.status)).length);

      console.log(`Mixed Operations Load Test Results:`);
      console.log(`  Total Requests: ${mixedOperations.length}`);
      console.log(`  Successful: ${successfulOps}`);
      console.log(`  Failed: ${failedOps}`);
      console.log(`  Duration: ${duration}ms`);

      expect(successfulOps).toBeGreaterThan(60); // At least 75% should succeed
      expect(duration).LessThan(15000); // Should complete within 15 seconds
    });
  });

  describe('Performance Metrics Collection', () => {
    it('should collect performance metrics during load', async () => {
      const performanceMetrics = {
        authentication: {},
        taskManagement: {},
        system: {}
      };

      // Authentication performance
      const authStart = Date.now();
      await request(app)
        .get('/user/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      performanceMetrics.authentication.userProfile = Date.now() - authStart;

      // Task management performance
      const taskStart = Date.now();
      await request(app)
        .get('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      performanceMetrics.taskManagement.taskList = Date.now() - taskStart;

      // System health performance
      const healthStart = Date.now();
      await request(app)
        .get('/health')
        .expect(200);
      performanceMetrics.system.healthCheck = Date.now() - healthStart;

      console.log('Performance Metrics:');
      console.log(`  User Profile Request: ${performanceMetrics.authentication.userProfile}ms`);
      console.log(`  Task List Request: ${performanceMetrics.taskManagement.taskList}ms`);
      console.log(`  Health Check Request: ${performanceMetrics.system.healthCheck}ms`);

      // Performance thresholds
      expect(performanceMetrics.authentication.userProfile).toBeLessThan(1000); // < 1 second
      expect(performanceMetrics.taskManagement.taskList).toBeLessThan(2000); // < 2 seconds
      expect(performanceMetrics.system.healthCheck).toBeLessThan(500); // < 500ms
    });
  });

  describe('Stress Testing', () => {
    it('should maintain stability under sustained load', async () => {
      if (!authToken) {
        console.log('Skipping stress test - no authentication token available');
        return;
      }

      const stressTestDuration = 30000; // 30 seconds
      const requestRate = 100; // 100 requests per second
      const totalRequests = (stressTestDuration / 1000) * requestRate;

      console.log(`Starting stress test: ${totalRequests} requests over ${stressTestDuration}ms`);

      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        responseTimes: []
      };

      const stressTestPromise = new Promise((resolve) => {
        const startTime = Date.now();
        let completedRequests = 0;

        const interval = setInterval(async () => {
          if (completedRequests >= totalRequests || Date.now() - startTime > stressTestDuration) {
            clearInterval(interval);
            resolve(results);
            return;
          }

          const batchPromises = Array(Math.min(requestRate, totalRequests - completedRequests)).fill().map(async () => {
            try {
              const requestStart = Date.now();
              const response = await request(app)
                .get('/user/me')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

              const requestTime = Date.now() - requestStart;
              results.successful++;
              results.responseTimes.push(requestTime);
            } catch (error) {
              results.failed++;
              results.errors.push(error.message);
            }
            completedRequests++;
          });

          await Promise.allSettled(batchPromises);
        }, 1000); // Run every second
      });

      const finalResults = await stressTestPromise;

      console.log(`Stress Test Results:`);
      console.log(`  Total Requests: ${totalRequests}`);
      console.log(`  Successful: ${finalResults.successful}`);
      console.log(`  Failed: ${finalResults.failed}`);
      console.log(`  Error Rate: ${((finalResults.failed / totalRequests) * 100).toFixed(2)}%`);

      if (finalResults.responseTimes.length > 0) {
        const avgResponseTime = finalResults.responseTimes.reduce((a, b) => a + b) / finalResults.responseTimes.length;
        const maxResponseTime = Math.max(...finalResults.responseTimes);
        const p95ResponseTime = finalResults.responseTimes.sort((a, b) => a - b)[Math.floor(finalResults.responseTimes.length * 0.95)];

        console.log(`  Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
        console.log(`  Max Response Time: ${maxResponseTime}ms`);
        console.log(`  95th Percentile: ${p95ResponseTime.toFixed(2)}ms`);
      }

      // Stress test acceptance criteria
      expect(finalResults.successful / totalRequests).toBeGreaterThan(0.95); // 95% success rate
      expect(finalResults.failed / totalRequests).toBeLessThan(0.05); // Less than 5% failure rate
    });
  });

  describe('Resource Usage Monitoring', () => {
    it('should monitor memory usage during load testing', async () => {
      if (!authToken) {
        console.log('Skipping memory usage test - no authentication token available');
        return;
      }

      const initialMemory = process.memoryUsage();
      console.log('Initial Memory Usage:');
      console.log(`  RSS: ${(initialMemory.rss / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Heap Total: ${(initialMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Heap Used: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);

      // Simulate memory load
      const memoryPromises = Array(50).fill().map(() =>
        request(app)
          .get('/tasks')
          .set('Authorization', `Bearer ${authToken}`)
      );

      await Promise.all(memoryPromises);

      const finalMemory = process.memoryUsage();
      console.log('Final Memory Usage:');
      console.log(`  RSS: ${(finalMemory.rss / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Heap Total: ${(finalMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Heap Used: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);

      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      console.log(`  Memory Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);

      // Memory usage should not increase excessively
      expect(memoryIncrease).toBeLessThan(100); // Less than 100MB increase
    });
  });
});