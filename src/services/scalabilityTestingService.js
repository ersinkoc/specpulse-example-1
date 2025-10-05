const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const { Worker } = require('worker_threads');
const os = require('os');

/**
 * Scalability Testing Service
 * Provides comprehensive load testing and scalability analysis for the notification system
 */
class ScalabilityTestingService extends EventEmitter {
  constructor() {
    super();

    this.testRuns = new Map(); // testId -> test run info
    this.activeWorkers = new Set();
    this.maxWorkers = os.cpus().length;
    this.defaultTestConfig = {
      duration: 60000, // 1 minute
      rampUpTime: 10000, // 10 seconds
      concurrentUsers: 100,
      messagesPerSecond: 50,
      connectionRate: 10, // connections per second
      thinkTime: 1000, // 1 second between actions
      enableMetrics: true,
      enableMemoryMonitoring: true,
      enableLatencyTracking: true
    };

    // Test results storage
    this.results = new Map(); // testId -> results

    logger.info('Scalability testing service initialized');
  }

  /**
   * Run scalability test
   */
  async runTest(testConfig = {}) {
    try {
      const testId = this.generateTestId();
      const config = { ...this.defaultTestConfig, ...testConfig };

      logger.info(`Starting scalability test: ${testId}`, config);

      // Initialize test run
      const testRun = {
        id: testId,
        config,
        status: 'initializing',
        startTime: Date.now(),
        endTime: null,
        metrics: {
          connections: {
            total: 0,
            successful: 0,
            failed: 0,
            concurrent: 0,
            rate: 0
          },
          messages: {
            sent: 0,
            delivered: 0,
            failed: 0,
            rate: 0,
            avgLatency: 0,
            p95Latency: 0,
            p99Latency: 0
          },
          performance: {
            cpuUsage: [],
            memoryUsage: [],
            responseTime: [],
            throughput: []
          },
          errors: []
        }
      };

      this.testRuns.set(testId, testRun);

      // Create test workers
      const workers = await this.createTestWorkers(testId, config);

      // Start the test
      await this.startTest(testId, workers);

      return testId;

    } catch (error) {
      logger.error('Failed to run scalability test:', error);
      throw error;
    }
  }

  /**
   * Create test workers
   */
  async createTestWorkers(testId, config) {
    const workers = [];
    const numWorkers = Math.min(config.concurrentUsers / 10, this.maxWorkers);

    for (let i = 0; i < numWorkers; i++) {
      const workerData = {
        testId,
        workerId: `worker-${i}`,
        config,
        userIndex: i * 10,
        usersPerWorker: Math.min(10, config.concurrentUsers - i * 10)
      };

      const worker = new Worker(`
        const { parentPort } = require('worker_threads');
        const WebSocket = require('ws');
        const { performance } = require('perf_hooks');

        // Test worker implementation
        async function runTest(data) {
          const { testId, workerId, config, userIndex, usersPerWorker } = data;
          let connections = [];
          let metrics = {
            connections: 0,
            messages: 0,
            errors: 0,
            latencies: [],
            startTimes: []
          };

          try {
            // WebSocket connection
            const ws = new WebSocket('ws://localhost:3000');

            await new Promise((resolve, reject) => {
              ws.on('open', resolve);
              ws.on('error', reject);
              setTimeout(() => reject(new Error('Connection timeout')), 10000);
            });

            // Send test start notification
            parentPort.postMessage({
              type: 'worker_ready',
              workerId,
              testId
            });

            // Wait for test start signal
            await new Promise((resolve) => {
              const handler = (message) => {
                if (message.type === 'start_test' && message.testId === testId) {
                  parentPort.off('message', handler);
                  resolve();
                }
              };
              parentPort.on('message', handler);
            });

            // Ramp-up phase
            const rampUpDelay = config.rampUpTime / usersPerWorker;
            for (let i = 0; i < usersPerWorker; i++) {
              try {
                await connectWebSocket(`user-${testId}-${userIndex}-${i}`, ws);
                connections.push(ws);
                metrics.connections++;
                await new Promise(resolve => setTimeout(resolve, rampUpDelay));
              } catch (error) {
                metrics.errors++;
                parentPort.postMessage({
                  type: 'error',
                  workerId,
                  error: error.message
                });
              }
            }

            parentPort.postMessage({
              type: 'ramp_up_complete',
              workerId,
              connections: metrics.connections
            });

            // Main test phase
            const testEndTime = Date.now() + config.duration;
            const messageInterval = 1000 / (config.messagesPerSecond / numWorkers);

            const messageIntervalId = setInterval(() => {
              if (Date.now() >= testEndTime) {
                clearInterval(messageIntervalId);
                return;
              }

              try {
                const startTime = performance.now();
                ws.send(JSON.stringify({
                  type: 'test_message',
                  timestamp: startTime,
                  messageId: Math.random().toString(36).substr(2, 9)
                }));

                // Track message latency
                ws.once('message', (data) => {
                  try {
                    const response = JSON.parse(data.toString());
                    const latency = performance.now() - startTime;
                    metrics.latencies.push(latency);
                    metrics.messages++;
                  } catch (error) {
                    metrics.errors++;
                  }
                });

              } catch (error) {
                metrics.errors++;
              }
            }, messageInterval);

            // Wait for test completion
            await new Promise(resolve => {
              const handler = (message) => {
                if (message.type === 'stop_test' && message.testId === testId) {
                  parentPort.off('message', handler);
                  resolve();
                }
              };
              parentPort.on('message', handler);
            });

            // Cleanup phase
            clearInterval(messageIntervalId);

            for (const conn of connections) {
              try {
                conn.close();
              } catch (error) {
                // Ignore close errors
              }
            }

            // Send final metrics
            parentPort.postMessage({
              type: 'test_complete',
              workerId,
              testId,
              metrics: {
                connections: metrics.connections,
                messages: metrics.messages,
                errors: metrics.errors,
                latencies: metrics.latencies
              }
            });

          } catch (error) {
            parentPort.postMessage({
              type: 'error',
              workerId,
              testId,
              error: error.message
            });
          }

          async function connectWebSocket(userId, ws) {
            // Simulate authentication and setup
            return new Promise((resolve, reject) => {
              ws.send(JSON.stringify({
                type: 'authenticate',
                userId,
                token: 'test-token'
              }));

              const handler = (data) => {
                try {
                  const response = JSON.parse(data.toString());
                  if (response.type === 'authenticated') {
                    parentPort.off('message', handler);
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              };

              ws.on('message', handler);
              setTimeout(() => reject(new Error('Authentication timeout')), 5000);
            });
          }

        `, { eval: true });

      worker.on('message', (message) => {
        this.handleWorkerMessage(testId, message);
      });

      worker.on('error', (error) => {
        logger.error(`Worker error: ${error.message}`);
        this.emit('worker:error', { testId, error });
      });

      worker.on('exit', (code) => {
        this.activeWorkers.delete(worker);
        logger.debug(`Worker exited: ${testId}, code: ${code}`);
      });

      workers.push(worker);
      this.activeWorkers.add(worker);

      return workers;

    } catch (error) {
      logger.error('Failed to create test workers:', error);
      throw error;
    }
  }

  /**
   * Start the test
   */
  async startTest(testId, workers) {
    try {
      const testRun = this.testRuns.get(testId);
      testRun.status = 'running';

      // Send start signal to all workers
      for (const worker of workers) {
        worker.postMessage({
          type: 'start_test',
          testId
        });
      }

      // Set test end timer
      setTimeout(async () => {
        await this.stopTest(testId);
      }, testRun.config.duration);

      logger.info(`Scalability test started: ${testId} with ${workers.length} workers`);

      this.emit('test:started', { testId, workers: workers.length });

    } catch (error) {
      logger.error(`Failed to start test ${testId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the test
   */
  async stopTest(testId) {
    try {
      const testRun = this.testRuns.get(testId);
      if (!testRun || testRun.status !== 'running') {
        return;
      }

      testRun.status = 'stopping';
      testRun.endTime = Date.now();

      // Send stop signal to all workers
      for (const worker of this.activeWorkers) {
        worker.postMessage({
          type: 'stop_test',
          testId
        });
      }

      // Wait for all workers to complete
      await this.waitForWorkersToComplete(testId);

      // Calculate final results
      await this.calculateTestResults(testId);

      testRun.status = 'completed';

      logger.info(`Scalability test completed: ${testId}`);
      this.emit('test:completed', { testId, results: this.results.get(testId) });

    } catch (error) {
      logger.error(`Failed to stop test ${testId}:`, error);
    }
  }

  /**
   * Wait for all workers to complete
   */
  async waitForWorkersToComplete(testId) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const activeWorkersForTest = Array.from(this.activeWorkers).filter(worker =>
          worker.threadId && this.testRuns.has(testId)
        );

        if (activeWorkersForTest.length === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Handle worker messages
   */
  handleWorkerMessage(testId, message) {
    try {
      const testRun = this.testRuns.get(testId);
      if (!testRun) {
        return;
      }

      switch (message.type) {
        case 'worker_ready':
          logger.debug(`Worker ready: ${message.workerId}`);
          break;

        case 'ramp_up_complete':
          logger.info(`Ramp up complete: ${message.workerId}, connections: ${message.connections}`);
          break;

        case 'test_complete':
          this.aggregateWorkerResults(testId, message);
          break;

        case 'error':
          testRun.metrics.errors.push({
            timestamp: Date.now(),
            workerId: message.workerId,
            error: message.error
          });
          logger.error(`Worker error: ${message.workerId} - ${message.error}`);
          break;

        default:
          logger.debug(`Unknown worker message type: ${message.type}`);
      }

    } catch (error) {
      logger.error('Failed to handle worker message:', error);
    }
  }

  /**
   * Aggregate results from workers
   */
  aggregateWorkerResults(testId, message) {
    try {
      const testRun = this.testRuns.get(testId);
      if (!testRun) {
        return;
      }

      // Update metrics with worker results
      testRun.metrics.connections.total += message.metrics.connections || 0;
      testRun.metrics.messages.sent += message.metrics.messages || 0;
      testRun.metrics.errors += message.metrics.errors || 0;

      // Add latency data
      if (message.metrics.latencies) {
        testRun.metrics.performance.responseTime.push(...message.metrics.latencies);
      }

      logger.debug(`Worker results aggregated: ${message.workerId}`);

    } catch (error) {
      logger.error('Failed to aggregate worker results:', error);
    }
  }

  /**
   * Calculate final test results
   */
  async calculateTestResults(testId) {
    try {
      const testRun = this.testRuns.get(testId);
      const results = {
        testId,
        config: testRun.config,
        duration: testRun.endTime - testRun.startTime,
        status: testRun.status,
        timestamp: Date.now(),
        summary: {
          totalConnections: testRun.metrics.connections.total,
          successfulConnections: testRun.metrics.connections.total - testRun.metrics.errors.length,
          failedConnections: testRun.metrics.errors.length,
          totalMessages: testRun.metrics.messages.sent,
          successfulMessages: testRun.metrics.messages.sent - testRun.metrics.errors.length,
          failedMessages: testRun.metrics.errors.length
        },
        performance: {
          connectionsPerSecond: testRun.metrics.connections.total / (testRun.duration / 1000),
          messagesPerSecond: testRun.metrics.messages.sent / (testRun.duration / 1000),
          errorRate: testRun.metrics.errors.length / (testRun.metrics.connections.total || 1),
          avgLatency: this.calculateAverage(testRun.metrics.performance.responseTime),
          p95Latency: this.calculatePercentile(testRun.metrics.performance.responseTime, 95),
          p99Latency: this.calculatePercentile(testRun.metrics.performance.responseTime, 99),
          maxLatency: Math.max(...testRun.metrics.performance.responseTime, 0)
        },
        system: {
          cpuUsage: await this.getSystemMetrics('cpu'),
          memoryUsage: await this.getSystemMetrics('memory')
        },
        errors: testRun.metrics.errors
      };

      this.results.set(testId, results);
      return results;

    } catch (error) {
      logger.error(`Failed to calculate results for test ${testId}:`, error);
      return null;
    }
  }

  /**
   * Get system metrics
   */
  async getSystemMetrics(type) {
    try {
      if (type === 'cpu') {
        const cpus = os.cpus();
        const totalIdle = cpus.reduce((sum, cpu) => sum + cpu.idle, 0);
        const totalTick = cpus.reduce((sum, cpu) => sum + (cpu.idle + cpu.user + cpu.nice + cpu.sys), 0);
        return ((totalTick - totalIdle) / totalTick) * 100;
      }

      if (type === 'memory') {
        const memUsage = process.memoryUsage();
        return {
          heapUsed: memUsage.heapUsed / 1024 / 1024, // MB
          heapTotal: memUsage.heapTotal / 1024 / 1024, // MB
          rss: memUsage.rss / 1024 / 1024, // MB
          external: memUsage.external / 1024 / 1024 // MB
        };
      }

      return 0;

    } catch (error) {
      logger.error(`Failed to get system metrics for ${type}:`, error);
      return 0;
    }
  }

  /**
   * Calculate average
   */
  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get test results
   */
  getTestResults(testId) {
    return this.results.get(testId);
  }

  /**
   * Get all test results
   */
  getAllTestResults() {
    return Array.from(this.results.values());
  }

  /**
   * Generate test ID
   */
  generateTestId() {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get test run status
   */
  getTestRunStatus(testId) {
    const testRun = this.testRuns.get(testId);
    return testRun ? {
      id: testId,
      status: testRun.status,
      startTime: testRun.startTime,
      endTime: testRun.endTime,
      duration: testRun.endTime ? testRun.endTime - testRun.startTime : 0,
      config: testRun.config
    } : null;
  }

  /**
   * Cancel test
   */
  async cancelTest(testId) {
    try {
      const testRun = this.testRuns.get(testId);
      if (testRun && testRun.status === 'running') {
        await this.stopTest(testId);
        testRun.status = 'cancelled';

        logger.info(`Test cancelled: ${testId}`);
        this.emit('test:cancelled', { testId });

        return true;
      }

      return false;

    } catch (error) {
      logger.error(`Failed to cancel test ${testId}:`, error);
      return false;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      activeTests: Array.from(this.testRuns.values()).filter(run => run.status === 'running').length,
      completedTests: this.results.size,
      activeWorkers: this.activeWorkers.size,
      maxWorkers: this.maxWorkers,
      timestamp: Date.now()
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    logger.info('Shutting down scalability testing service');

    // Cancel all active tests
    for (const [testId, testRun] of this.testRuns) {
      if (testRun.status === 'running') {
        await this.cancelTest(testId);
      }
    }

    // Terminate all workers
    for (const worker of this.activeWorkers) {
      worker.terminate();
    }

    this.activeWorkers.clear();
    this.testRuns.clear();
    this.results.clear();
    this.removeAllListeners();

    logger.info('Scalability testing service shutdown complete');
  }
}

// Create singleton instance
const scalabilityTestingService = new ScalabilityTestingService();

module.exports = scalabilityTestingService;