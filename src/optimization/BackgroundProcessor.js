/**
 * Background Task Processor for Security Operations
 * Handles asynchronous security tasks with job queuing, scheduling, and resource management
 */

const EventEmitter = require('events');
const cron = require('node-cron');
const winston = require('winston');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class BackgroundProcessor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Worker configuration
      maxWorkers: config.maxWorkers || require('os').cpus().length,
      workerTimeout: config.workerTimeout || 300000, // 5 minutes
      workerRestartDelay: config.workerRestartDelay || 5000,

      // Queue configuration
      maxQueueSize: config.maxQueueSize || 1000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000,

      // Scheduling configuration
      scheduledTasks: config.scheduledTasks || {},
      timezone: config.timezone || 'UTC',

      // Resource management
      maxMemoryUsage: config.maxMemoryUsage || 1024 * 1024 * 512, // 512MB
      maxCpuUsage: config.maxCpuUsage || 80, // 80%

      ...config
    };

    // Task queues by priority
    this.queues = {
      high: [],
      medium: [],
      low: []
    };

    // Worker management
    this.workers = new Map();
    this.workerTasks = new Map();
    this.workerStats = {
      total: 0,
      active: 0,
      idle: 0,
      failed: 0
    };

    // Task tracking
    this.tasks = new Map();
    this.taskResults = new Map();
    this.taskStats = {
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
      queued: 0
    };

    // Scheduled tasks
    this.scheduledJobs = new Map();

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/background-processor.log'
        })
      ]
    });

    this.initializeProcessor();
  }

  /**
   * Initialize the background processor
   */
  initializeProcessor() {
    if (!isMainThread) {
      // Worker thread logic
      this.setupWorker();
      return;
    }

    // Main thread logic
    this.startWorkers();
    this.startTaskProcessor();
    this.startScheduledTasks();
    this.startHealthMonitoring();

    this.logger.info('Background processor initialized', {
      maxWorkers: this.config.maxWorkers,
      maxQueueSize: this.config.maxQueueSize
    });
  }

  /**
   * Setup worker thread
   */
  setupWorker() {
    parentPort.on('message', async (task) => {
      try {
        this.logger.debug('Worker received task', { taskId: task.id, type: task.type });

        const result = await this.executeTask(task);

        parentPort.postMessage({
          taskId: task.id,
          success: true,
          result,
          completedAt: Date.now()
        });
      } catch (error) {
        this.logger.error('Worker task failed', {
          taskId: task.id,
          error: error.message,
          stack: error.stack
        });

        parentPort.postMessage({
          taskId: task.id,
          success: false,
          error: {
            message: error.message,
            stack: error.stack
          },
          completedAt: Date.now()
        });
      }
    });

    // Handle worker termination
    process.on('exit', () => {
      parentPort.postMessage({ type: 'worker-exit' });
    });
  }

  /**
   * Start worker threads
   */
  startWorkers() {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      this.startWorker(i);
    }
  }

  /**
   * Start a single worker thread
   */
  startWorker(workerId) {
    const worker = new Worker(__filename, {
      workerData: { workerId }
    });

    worker.on('message', (message) => {
      if (message.type === 'worker-exit') {
        this.handleWorkerExit(workerId);
        return;
      }

      this.handleWorkerMessage(workerId, message);
    });

    worker.on('error', (error) => {
      this.logger.error('Worker error:', { workerId, error: error.message });
      this.handleWorkerExit(workerId);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.logger.error('Worker exited with error:', { workerId, code });
        this.handleWorkerExit(workerId);
      }
    });

    this.workers.set(workerId, worker);
    this.workerStats.total++;
    this.workerStats.idle++;

    this.logger.debug('Worker started', { workerId });
  }

  /**
   * Handle worker exit
   */
  handleWorkerExit(workerId) {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.terminate();
      this.workers.delete(workerId);
      this.workerStats.total--;
      this.workerStats.failed++;
    }

    // Restart worker after delay
    setTimeout(() => {
      this.startWorker(workerId);
    }, this.config.workerRestartDelay);
  }

  /**
   * Handle worker message
   */
  handleWorkerMessage(workerId, message) {
    const task = this.tasks.get(message.taskId);
    if (!task) return;

    if (message.success) {
      this.handleTaskCompletion(task, message.result);
    } else {
      this.handleTaskFailure(task, message.error);
    }

    // Update worker stats
    const currentTask = this.workerTasks.get(workerId);
    if (currentTask) {
      this.workerTasks.delete(workerId);
      this.workerStats.active--;
      this.workerStats.idle++;
    }
  }

  /**
   * Add task to queue
   */
  addTask(taskData, options = {}) {
    const task = {
      id: this.generateTaskId(),
      type: taskData.type,
      data: taskData,
      priority: options.priority || 'medium',
      retryCount: 0,
      createdAt: Date.now(),
      scheduledAt: options.scheduledAt || Date.now(),
      timeout: options.timeout || this.config.workerTimeout,
      ...options
    };

    // Validate queue capacity
    const totalQueued = Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
    if (totalQueued >= this.config.maxQueueSize) {
      throw new Error('Task queue is full');
    }

    // Add to appropriate queue
    this.queues[task.priority].push(task);
    this.tasks.set(task.id, task);
    this.taskStats.total++;
    this.taskStats.queued++;

    this.logger.info('Task added to queue', {
      taskId: task.id,
      type: task.type,
      priority: task.priority,
      queueSize: totalQueued + 1
    });

    this.emit('taskAdded', task);
    return task.id;
  }

  /**
   * Process tasks from queues
   */
  startTaskProcessor() {
    setInterval(() => {
      this.processQueuedTasks();
    }, 1000); // Process every second
  }

  /**
   * Process queued tasks
   */
  processQueuedTasks() {
    // Get available workers
    const availableWorkers = Array.from(this.workers.entries())
      .filter(([workerId, worker]) => !this.workerTasks.has(workerId))
      .slice(0, Math.min(this.workerStats.idle, 5)); // Process up to 5 tasks per interval

    if (availableWorkers.length === 0) return;

    // Get tasks by priority order
    const tasks = [
      ...this.queues.high.splice(0, availableWorkers.length),
      ...this.queues.medium.splice(0, availableWorkers.length - this.queues.high.length),
      ...this.queues.low.splice(0, availableWorkers.length - this.queues.high.length - this.queues.medium.length)
    ];

    // Assign tasks to workers
    tasks.forEach((task, index) => {
      if (index < availableWorkers.length) {
        const [workerId, worker] = availableWorkers[index];
        this.assignTaskToWorker(workerId, worker, task);
      } else {
        // Put task back in queue
        this.queues[task.priority].unshift(task);
      }
    });
  }

  /**
   * Assign task to worker
   */
  assignTaskToWorker(workerId, worker, task) {
    // Check if task is scheduled for future
    if (task.scheduledAt > Date.now()) {
      this.queues[task.priority].unshift(task);
      return;
    }

    // Check system resources
    if (!this.checkSystemResources()) {
      this.queues[task.priority].unshift(task);
      return;
    }

    this.workerTasks.set(workerId, task);
    this.workerStats.active++;
    this.workerStats.idle--;
    this.taskStats.running++;
    this.taskStats.queued--;

    task.startedAt = Date.now();

    worker.postMessage(task);

    this.logger.debug('Task assigned to worker', {
      taskId: task.id,
      workerId,
      type: task.type
    });

    // Set task timeout
    setTimeout(() => {
      if (this.tasks.has(task.id)) {
        this.handleTaskTimeout(task);
      }
    }, task.timeout);

    this.emit('taskStarted', task);
  }

  /**
   * Check system resources
   */
  checkSystemResources() {
    const memUsage = process.memoryUsage();
    const memoryUsagePercent = (memUsage.heapUsed / this.config.maxMemoryUsage) * 100;

    if (memoryUsagePercent > 90) {
      this.logger.warn('High memory usage, rejecting new tasks', {
        usage: memoryUsagePercent,
        threshold: 90
      });
      return false;
    }

    return true;
  }

  /**
   * Execute task (in worker thread)
   */
  async executeTask(task) {
    switch (task.type) {
      case 'vulnerability_scan':
        return this.executeVulnerabilityScan(task.data);
      case 'security_audit':
        return this.executeSecurityAudit(task.data);
      case 'compliance_check':
        return this.executeComplianceCheck(task.data);
      case 'report_generation':
        return this.executeReportGeneration(task.data);
      case 'data_cleanup':
        return this.executeDataCleanup(task.data);
      case 'metrics_calculation':
        return this.executeMetricsCalculation(task.data);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Execute vulnerability scan task
   */
  async executeVulnerabilityScan(data) {
    const VulnerabilityScanner = require('../security/scanner/VulnerabilityScanner');
    const scanner = new VulnerabilityScanner(data.config);

    const result = await scanner.scanPath(data.scanPath, data.options);
    return result;
  }

  /**
   * Execute security audit task
   */
  async executeSecurityAudit(data) {
    // Mock security audit implementation
    const auditResult = {
      auditId: this.generateTaskId(),
      timestamp: Date.now(),
      scope: data.scope,
      findings: [
        {
          type: 'security_misconfiguration',
          severity: 'medium',
          description: 'Sample security finding',
          recommendation: 'Apply security best practices'
        }
      ],
      complianceScore: 85,
      status: 'completed'
    };

    return auditResult;
  }

  /**
   * Execute compliance check task
   */
  async executeComplianceCheck(data) {
    // Mock compliance check implementation
    const complianceResult = {
      checkId: this.generateTaskId(),
      framework: data.framework,
      timestamp: Date.now(),
      score: 92,
      requirements: [
        {
          requirement: 'Data encryption at rest',
          status: 'compliant',
          evidence: 'AES-256 encryption enabled'
        },
        {
          requirement: 'Access control',
          status: 'compliant',
          evidence: 'RBAC implemented'
        }
      ],
      status: 'completed'
    };

    return complianceResult;
  }

  /**
   * Execute report generation task
   */
  async executeReportGeneration(data) {
    // Mock report generation implementation
    const report = {
      reportId: this.generateTaskId(),
      type: data.type,
      timestamp: Date.now(),
      data: {
        executive_summary: 'Security status summary',
        metrics: this.generateMockMetrics(),
        recommendations: [
          'Update vulnerable dependencies',
          'Implement additional security controls'
        ]
      },
      status: 'completed'
    };

    return report;
  }

  /**
   * Execute data cleanup task
   */
  async executeDataCleanup(data) {
    // Mock data cleanup implementation
    const cleanupResult = {
      cleanupId: this.generateTaskId(),
      timestamp: Date.now(),
      recordsDeleted: 1250,
      spaceFreed: '15.3 MB',
      status: 'completed'
    };

    return cleanupResult;
  }

  /**
   * Execute metrics calculation task
   */
  async executeMetricsCalculation(data) {
    // Mock metrics calculation implementation
    const metrics = {
      metricsId: this.generateTaskId(),
      timestamp: Date.now(),
      type: data.type,
      data: this.generateMockMetrics(),
      status: 'completed'
    };

    return metrics;
  }

  /**
   * Generate mock metrics
   */
  generateMockMetrics() {
    return {
      vulnerabilities: {
        total: 45,
        critical: 2,
        high: 8,
        medium: 25,
        low: 10
      },
      incidents: {
        total: 3,
        open: 1,
        resolved: 2
      },
      compliance: {
        overall: 89,
        gdpr: 92,
        soc2: 87
      },
      scans: {
        lastScan: new Date().toISOString(),
        totalScans: 156,
        averageScanTime: '2.3 minutes'
      }
    };
  }

  /**
   * Handle task completion
   */
  handleTaskCompletion(task, result) {
    task.completedAt = Date.now();
    task.duration = task.completedAt - task.startedAt;
    task.status = 'completed';

    this.taskResults.set(task.id, result);
    this.tasks.delete(task.id);
    this.taskStats.completed++;
    this.taskStats.running--;

    this.logger.info('Task completed', {
      taskId: task.id,
      type: task.type,
      duration: task.duration
    });

    this.emit('taskCompleted', task, result);
  }

  /**
   * Handle task failure
   */
  handleTaskFailure(task, error) {
    task.error = error;
    task.failedAt = Date.now();
    task.duration = task.failedAt - task.startedAt;
    task.retryCount++;

    this.taskStats.failed++;
    this.taskStats.running--;

    // Retry logic
    if (task.retryCount < this.config.retryAttempts) {
      task.status = 'retrying';
      this.tasks.delete(task.id);

      setTimeout(() => {
        this.queues[task.priority].push(task);
        this.tasks.set(task.id, task);
        this.taskStats.queued++;
      }, this.config.retryDelay * task.retryCount);

      this.logger.warn('Task failed, scheduling retry', {
        taskId: task.id,
        attempt: task.retryCount,
        error: error.message
      });
    } else {
      task.status = 'failed';
      this.taskResults.set(task.id, { error, failed: true });

      this.logger.error('Task failed permanently', {
        taskId: task.id,
        attempts: task.retryCount,
        error: error.message
      });

      this.emit('taskFailed', task, error);
    }
  }

  /**
   * Handle task timeout
   */
  handleTaskTimeout(task) {
    if (this.tasks.has(task.id)) {
      this.handleTaskFailure(task, {
        message: 'Task timeout',
        timeout: task.timeout
      });
    }
  }

  /**
   * Start scheduled tasks
   */
  startScheduledTasks() {
    const defaultTasks = {
      // Daily vulnerability scan at 2 AM
      vulnerability_scan: {
        schedule: '0 2 * * *',
        type: 'vulnerability_scan',
        data: {
          scanPath: process.cwd(),
          config: {
            timeout: 300000,
            cacheEnabled: true
          }
        },
        priority: 'medium'
      },

      // Hourly metrics calculation
      metrics_calculation: {
        schedule: '0 * * * *',
        type: 'metrics_calculation',
        data: {
          type: 'security_metrics',
          timeRange: '1h'
        },
        priority: 'low'
      },

      // Weekly data cleanup on Sunday at 3 AM
      data_cleanup: {
        schedule: '0 3 * * 0',
        type: 'data_cleanup',
        data: {
          retentionDays: 90,
          types: ['audit_logs', 'temp_files']
        },
        priority: 'low'
      },

      // Daily compliance check at 9 AM
      compliance_check: {
        schedule: '0 9 * * *',
        type: 'compliance_check',
        data: {
          framework: 'gdpr',
          scope: 'full'
        },
        priority: 'medium'
      }
    };

    // Merge with custom scheduled tasks
    const allTasks = { ...defaultTasks, ...this.config.scheduledTasks };

    for (const [name, taskConfig] of Object.entries(allTasks)) {
      if (cron.validate(taskConfig.schedule)) {
        const job = cron.schedule(taskConfig.schedule, () => {
          this.addTask(taskConfig.data, {
            type: taskConfig.type,
            priority: taskConfig.priority,
            scheduled: true,
            scheduleName: name
          });

          this.logger.info('Scheduled task executed', { name, type: taskConfig.type });
        }, {
          scheduled: false,
          timezone: this.config.timezone
        });

        job.start();
        this.scheduledJobs.set(name, job);

        this.logger.info('Scheduled task registered', {
          name,
          schedule: taskConfig.schedule,
          type: taskConfig.type
        });
      } else {
        this.logger.error('Invalid cron schedule', { name, schedule: taskConfig.schedule });
      }
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    setInterval(() => {
      this.checkHealth();
    }, 60000); // Check every minute
  }

  /**
   * Check system health
   */
  checkHealth() {
    const health = {
      timestamp: Date.now(),
      workers: { ...this.workerStats },
      tasks: { ...this.taskStats },
      queues: {
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length
      },
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };

    // Log warnings for potential issues
    if (health.tasks.failed > 10) {
      this.logger.warn('High task failure rate', { failed: health.tasks.failed });
    }

    if (health.queues.high > 50) {
      this.logger.warn('High priority queue backing up', { size: health.queues.high });
    }

    if (health.workers.failed > 3) {
      this.logger.warn('Multiple worker failures', { failed: health.workers.failed });
    }

    this.emit('healthCheck', health);
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      return {
        id: task.id,
        type: task.type,
        status: task.status,
        priority: task.priority,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        retryCount: task.retryCount
      };
    }

    const result = this.taskResults.get(taskId);
    if (result) {
      return {
        id: taskId,
        status: result.failed ? 'failed' : 'completed',
        result
      };
    }

    return null;
  }

  /**
   * Get processor statistics
   */
  getStats() {
    return {
      workers: { ...this.workerStats },
      tasks: { ...this.taskStats },
      queues: {
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length
      },
      scheduledTasks: this.scheduledJobs.size
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('Shutting down background processor...');

    // Stop scheduled tasks
    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      this.logger.debug('Stopped scheduled task', { name });
    }

    // Wait for running tasks to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const shutdownStart = Date.now();

    while (this.taskStats.running > 0 && (Date.now() - shutdownStart) < shutdownTimeout) {
      await this.sleep(1000);
    }

    // Terminate workers
    for (const [workerId, worker] of this.workers) {
      worker.terminate();
      this.logger.debug('Terminated worker', { workerId });
    }

    this.logger.info('Background processor shutdown complete');
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Handle worker thread execution
if (!isMainThread) {
  const processor = new BackgroundProcessor(workerData);
}

module.exports = BackgroundProcessor;