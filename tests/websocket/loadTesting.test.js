const { expect } = require('chai');
const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const scalabilityTestingService = require('../../src/services/scalabilityTestingService');

/**
 * Load Testing Suite for WebSocket Notification System
 * Tests system performance under various load conditions
 */
describe('WebSocket Load Testing', function() {
  let httpServer, io, testResults;

  // Extended timeout for load tests
  this.timeout(60000);

  before(async function() {
    // Create test server
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });

    await new Promise((resolve) => {
      httpServer.listen(() => resolve());
    });

    // Initialize scalability testing service
    await scalabilityTestingService.initialize();
  });

  after(async function() {
    if (io) io.close();
    if (httpServer) httpServer.close();
    await scalabilityTestingService.shutdown();
  });

  describe('Connection Load Testing', function() {

    it('should handle 1000 concurrent connections', async function() {
      this.timeout(120000);

      const testConfig = {
        concurrentUsers: 1000,
        duration: 30000, // 30 seconds
        rampUpTime: 10000, // 10 seconds
        messagesPerSecond: 10,
        connectionRate: 100 // connections per second
      };

      const testId = await scalabilityTestingService.runTest(testConfig);

      // Wait for test completion
      await new Promise((resolve) => {
        scalabilityTestingService.on('test:completed', ({ results }) => {
          if (results.testId === testId) {
            testResults = results;
            resolve();
          }
        });
      });

      // Verify test results
      expect(testResults).to.exist;
      expect(testResults.summary.totalConnections).to.be.at.least(950); // Allow some failures
      expect(testResults.performance.connectionsPerSecond).to.be.at.least(50);
      expect(testResults.performance.errorRate).to.be.lessThan(0.1); // Less than 10% error rate
    });

    it('should handle connection bursts without degradation', async function() {
      this.timeout(60000);

      const burstTest = await scalabilityTestingService.runTest({
        concurrentUsers: 500,
        duration: 15000,
        rampUpTime: 2000, // Quick ramp-up for burst
        messagesPerSecond: 50,
        connectionRate: 250 // High connection rate
      });

      // Wait for results
      await new Promise((resolve) => {
        setTimeout(resolve, 25000); // Wait for test to complete
      });

      const results = scalabilityTestingService.getTestResults(burstTest);
      expect(results).to.exist;
      expect(results.summary.successfulConnections).to.be.at.least(400);
      expect(results.performance.avgLatency).to.be.lessThan(1000); // Less than 1 second average
    });

    it('should maintain performance with sustained load', async function() {
      this.timeout(180000);

      const sustainedTest = await scalabilityTestingService.runTest({
        concurrentUsers: 200,
        duration: 120000, // 2 minutes sustained
        rampUpTime: 30000,
        messagesPerSecond: 20,
        connectionRate: 20
      });

      // Wait for sustained test completion
      await new Promise((resolve) => {
        scalabilityTestingService.on('test:completed', ({ results }) => {
          if (results.testId === sustainedTest) {
            testResults = results;
            resolve();
          }
        });
      });

      expect(testResults.performance.errorRate).to.be.lessThan(0.05); // Less than 5% errors
      expect(testResults.performance.avgLatency).to.be.lessThan(500); // Less than 500ms
      expect(testResults.performance.p95Latency).to.be.lessThan(1000); // Less than 1 second P95
    });
  });

  describe('Message Throughput Testing', function() {

    it('should handle high message throughput', async function() {
      this.timeout(90000);

      const throughputTest = await scalabilityTestingService.runTest({
        concurrentUsers: 100,
        duration: 45000,
        rampUpTime: 10000,
        messagesPerSecond: 500, // High message rate
        connectionRate: 50
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 60000); // Wait for completion
      });

      const results = scalabilityTestingService.getTestResults(throughputTest);
      expect(results.performance.messagesPerSecond).to.be.at.least(200);
      expect(results.performance.errorRate).to.be.lessThan(0.15); // Allow higher error rate for high throughput
    });

    it('should maintain message ordering under load', async function() {
      this.timeout(60000);

      const connections = [];
      const receivedMessages = new Map();

      // Create test connections
      for (let i = 0; i < 10; i++) {
        const user = { id: `ordering-test-${i}`, username: `user${i}` };
        const token = jwt.sign(user, 'test-secret');

        const client = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token }
        });

        client.on('connect', () => {
          receivedMessages.set(user.id, []);

          client.on('notification', (notification) => {
            const messages = receivedMessages.get(user.id);
            messages.push({
              id: notification.id,
              timestamp: notification.timestamp,
              received: Date.now()
            });
          });
        });

        connections.push(client);
      }

      // Wait for connections
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send ordered messages
      const messageSequence = Array.from({ length: 100 }, (_, i) => i);

      for (const userId of receivedMessages.keys()) {
        for (const sequenceNumber of messageSequence) {
          // Small delay to maintain order
          await new Promise(resolve => setTimeout(resolve, 10));

          // Send message with sequence number
          const testMessage = {
            type: 'ordering-test',
            sequence: sequenceNumber,
            timestamp: Date.now()
          };

          // This would normally go through the notification service
          // For testing, we'll simulate direct emission
          const client = connections.find(c => c.auth?.token?.includes(userId.split('-')[2]));
          if (client) {
            client.emit('notification', {
              ...testMessage,
              id: `${userId}-${sequenceNumber}`
            });
          }
        }
      }

      // Wait for message delivery
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify message ordering
      let orderingViolations = 0;

      for (const [userId, messages] of receivedMessages) {
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].sequence < messages[i-1].sequence) {
            orderingViolations++;
          }
        }
      }

      // Should maintain order with minimal violations
      expect(orderingViolations).to.be.lessThan(messages.size * 0.05); // Less than 5% violations

      // Cleanup
      connections.forEach(client => client.close());
    });
  });

  describe('Resource Usage Testing', function() {

    it('should maintain memory efficiency under load', async function() {
      this.timeout(90000);

      const initialMemory = process.memoryUsage();
      const memoryTest = await scalabilityTestingService.runTest({
        concurrentUsers: 300,
        duration: 60000,
        rampUpTime: 15000,
        messagesPerSecond: 30,
        connectionRate: 30
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 80000); // Wait for completion
      });

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePerConnection = memoryIncrease / 300;

      // Memory usage should be reasonable
      expect(memoryIncreasePerConnection).to.be.lessThan(1024 * 1024); // Less than 1MB per connection
    });

    it('should handle memory cleanup after disconnections', async function() {
      this.timeout(120000);

      // Create many connections
      const connections = [];
      const connectionCount = 500;

      for (let i = 0; i < connectionCount; i++) {
        const user = { id: `cleanup-test-${i}`, username: `user${i}` };
        const token = jwt.sign(user, 'test-secret');

        const client = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token }
        });

        await new Promise((resolve) => {
          client.on('connect', resolve);
        });

        connections.push(client);
      }

      // Measure memory with connections
      const memoryWithConnections = process.memoryUsage();

      // Disconnect all clients
      connections.forEach(client => client.close());

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Measure memory after cleanup
      const memoryAfterCleanup = process.memoryUsage();
      const memoryReduction = memoryWithConnections.heapUsed - memoryAfterCleanup.heapUsed;

      // Should show significant memory reduction
      expect(memoryReduction).to.be.greaterThan(memoryWithConnections.heapUsed * 0.5);
    });
  });

  describe('Stress Testing', function() {

    it('should handle extreme load scenarios', async function() {
      this.timeout(300000); // 5 minutes

      const stressTest = await scalabilityTestingService.runTest({
        concurrentUsers: 2000,
        duration: 180000, // 3 minutes
        rampUpTime: 60000, // 1 minute ramp-up
        messagesPerSecond: 100,
        connectionRate: 200
      });

      await new Promise((resolve) => {
        scalabilityTestingService.on('test:completed', ({ results }) => {
          if (results.testId === stressTest) {
            testResults = results;
            resolve();
          }
        });
      });

      // System should remain functional even under extreme load
      expect(testResults.summary.successfulConnections).to.be.at.least(1000); // At least 50% success
      expect(testResults.performance.errorRate).to.be.lessThan(0.5); // Less than 50% errors
      expect(testResults.system.memoryUsage.heapUsed).to.be.lessThan(1024 * 1024 * 1024); // Less than 1GB
    });

    it('should recover from temporary overload conditions', async function() {
      this.timeout(180000);

      // Phase 1: Normal load
      const normalTest = await scalabilityTestingService.runTest({
        concurrentUsers: 100,
        duration: 30000,
        messagesPerSecond: 10,
        connectionRate: 20
      });

      await new Promise(resolve => setTimeout(resolve, 40000));

      const normalResults = scalabilityTestingService.getTestResults(normalTest);
      expect(normalResults.performance.errorRate).to.be.lessThan(0.05);

      // Phase 2: Overload
      const overloadTest = await scalabilityTestingService.runTest({
        concurrentUsers: 1000,
        duration: 30000,
        messagesPerSecond: 200,
        connectionRate: 300
      });

      await new Promise(resolve => setTimeout(resolve, 40000));

      const overloadResults = scalabilityTestingService.getTestResults(overloadTest);
      // System may degrade but should not completely fail
      expect(overloadResults.summary.successfulConnections).to.be.greaterThan(0);

      // Phase 3: Recovery - return to normal load
      const recoveryTest = await scalabilityTestingService.runTest({
        concurrentUsers: 100,
        duration: 30000,
        messagesPerSecond: 10,
        connectionRate: 20
      });

      await new Promise(resolve => setTimeout(resolve, 40000));

      const recoveryResults = scalabilityTestingService.getTestResults(recoveryTest);

      // Should recover to normal performance
      expect(recoveryResults.performance.errorRate).to.be.lessThan(0.1);
      expect(recoveryResults.performance.avgLatency).to.be.lessThan(1000);
    });
  });

  describe('Performance Regression Testing', function() {

    it('should maintain performance baselines', async function() {
      this.timeout(120000);

      const baselineTest = await scalabilityTestingService.runTest({
        concurrentUsers: 200,
        duration: 45000,
        rampUpTime: 10000,
        messagesPerSecond: 25,
        connectionRate: 40
      });

      await new Promise(resolve => setTimeout(resolve, 55000));

      const results = scalabilityTestingService.getTestResults(baselineTest);

      // Performance baselines
      expect(results.performance.avgLatency).to.be.lessThan(500); // < 500ms average
      expect(results.performance.p95Latency).to.be.lessThan(1500); // < 1.5s P95
      expect(results.performance.errorRate).to.be.lessThan(0.05); // < 5% errors
      expect(results.performance.connectionsPerSecond).to.be.at.least(10);
      expect(results.performance.messagesPerSecond).to.be.at.least(15);
    });
  });
});