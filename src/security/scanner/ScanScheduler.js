/**
 * Scan Scheduler
 * Manages automated vulnerability scanning schedules
 */

const cron = require('node-cron');
const VulnerabilityScanner = require('./VulnerabilityScanner');
const winston = require('winston');

class ScanScheduler {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      defaultSchedule: config.defaultSchedule || '0 2 * * *', // Daily at 2 AM
      maxConcurrentScans: config.maxConcurrentScans || 3,
      scanTimeout: config.scanTimeout || 1800000, // 30 minutes
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 300000, // 5 minutes
      notificationChannels: config.notificationChannels || ['email'],
      ...config
    };

    this.scheduledJobs = new Map();
    this.activeScans = new Set();
    this.scanQueue = [];
    this.scanner = new VulnerabilityScanner(config.scanner);

    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({ format: winston.format.simple() }),
        new winston.transports.File({
          filename: 'logs/scan-scheduler.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize scan scheduler
   */
  async initialize() {
    try {
      if (this.config.enabled) {
        // Start default scheduled scan
        this.scheduleScan('default', this.config.defaultSchedule, {
          type: 'scheduled',
          priority: 'normal'
        });

        this.logger.info('Scan scheduler initialized with default schedule');
      } else {
        this.logger.info('Scan scheduler is disabled');
      }
    } catch (error) {
      this.logger.error('Failed to initialize scan scheduler:', error);
      throw error;
    }
  }

  /**
   * Schedule a new scan job
   */
  scheduleScan(name, cronExpression, options = {}) {
    try {
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }

      // Check if job already exists
      if (this.scheduledJobs.has(name)) {
        throw new Error(`Scan job '${name}' already exists`);
      }

      // Create scheduled job
      const job = cron.schedule(cronExpression, async () => {
        await this.executeScan(name, options);
      }, {
        scheduled: false,
        timezone: options.timezone || 'UTC'
      });

      // Store job information
      this.scheduledJobs.set(name, {
        job,
        cronExpression,
        options,
        createdAt: new Date(),
        lastRun: null,
        nextRun: this.getNextRunTime(cronExpression),
        active: true
      });

      // Start the job
      job.start();

      this.logger.info(`Scheduled scan job '${name}' with cron: ${cronExpression}`);

      return {
        name,
        cronExpression,
        nextRun: this.getNextRunTime(cronExpression),
        active: true
      };

    } catch (error) {
      this.logger.error(`Failed to schedule scan '${name}':`, error);
      throw error;
    }
  }

  /**
   * Execute a scan
   */
  async executeScan(name, options = {}) {
    const scanId = `${name}-${Date.now()}`;

    try {
      // Check concurrent scan limit
      if (this.activeScans.size >= this.config.maxConcurrentScans) {
        this.logger.warn(`Scan queue full, queuing scan ${scanId}`);
        this.queueScan(scanId, name, options);
        return;
      }

      this.activeScans.add(scanId);
      this.logger.info(`Starting scan ${scanId}`);

      // Execute scan with timeout
      const scanPromise = this.scanner.scan();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Scan timeout')), this.config.scanTimeout);
      });

      const results = await Promise.race([scanPromise, timeoutPromise]);

      // Update job statistics
      if (this.scheduledJobs.has(name)) {
        const jobInfo = this.scheduledJobs.get(name);
        jobInfo.lastRun = new Date();
        jobInfo.nextRun = this.getNextRunTime(jobInfo.cronExpression);
        jobInfo.runCount = (jobInfo.runCount || 0) + 1;
      }

      // Process results
      await this.processScanResults(scanId, results, options);

      this.logger.info(`Scan ${scanId} completed successfully`, {
        vulnerabilitiesFound: results.length,
        critical: results.filter(v => v.severity === 'critical').length,
        high: results.filter(v => v.severity === 'high').length
      });

      // Process queued scans
      this.processScanQueue();

    } catch (error) {
      this.logger.error(`Scan ${scanId} failed:`, error);

      // Retry logic
      if (options.retryCount < this.config.retryAttempts) {
        this.logger.info(`Retrying scan ${scanId} (attempt ${options.retryCount + 1}/${this.config.retryAttempts})`);

        setTimeout(async () => {
          await this.executeScan(name, {
            ...options,
            retryCount: (options.retryCount || 0) + 1
          });
        }, this.config.retryDelay);
      } else {
        this.logger.error(`Scan ${scanId} failed after ${this.config.retryAttempts} attempts`);

        // Send failure notification
        await this.sendFailureNotification(scanId, error, options);
      }

    } finally {
      this.activeScans.delete(scanId);
    }
  }

  /**
   * Queue a scan for later execution
   */
  queueScan(scanId, name, options) {
    this.scanQueue.push({
      scanId,
      name,
      options,
      queuedAt: new Date()
    });

    this.logger.info(`Queued scan ${scanId} (queue length: ${this.scanQueue.length})`);
  }

  /**
   * Process queued scans
   */
  processScanQueue() {
    while (this.scanQueue.length > 0 && this.activeScans.size < this.config.maxConcurrentScans) {
      const queuedScan = this.scanQueue.shift();
      this.executeScan(queuedScan.name, queuedScan.options);
    }
  }

  /**
   * Process scan results
   */
  async processScanResults(scanId, results, options) {
    try {
      // Categorize vulnerabilities
      const categorized = this.categorizeVulnerabilities(results);

      // Send notifications based on severity
      if (categorized.critical.length > 0 || categorized.high.length > 0) {
        await this.sendVulnerabilityAlert(scanId, categorized, options);
      }

      // Generate and save report
      const report = await this.generateScanReport(scanId, results, categorized);
      await this.saveScanReport(report);

    } catch (error) {
      this.logger.error(`Failed to process scan results for ${scanId}:`, error);
    }
  }

  /**
   * Categorize vulnerabilities by severity
   */
  categorizeVulnerabilities(vulnerabilities) {
    return {
      critical: vulnerabilities.filter(v => v.severity === 'critical'),
      high: vulnerabilities.filter(v => v.severity === 'high'),
      medium: vulnerabilities.filter(v => v.severity === 'medium'),
      low: vulnerabilities.filter(v => v.severity === 'low'),
      info: vulnerabilities.filter(v => v.severity === 'info')
    };
  }

  /**
   * Send vulnerability alert
   */
  async sendVulnerabilityAlert(scanId, categorized, options) {
    const alert = {
      scanId,
      timestamp: new Date(),
      critical: categorized.critical.length,
      high: categorized.high.length,
      medium: categorized.medium.length,
      low: categorized.low.length,
      total: categorized.critical.length + categorized.high.length + categorized.medium.length + categorized.low.length,
      vulnerabilities: [...categorized.critical, ...categorized.high]
    };

    // This would integrate with the notification system
    this.logger.warn('Vulnerability alert:', alert);

    // Send to configured notification channels
    for (const channel of this.config.notificationChannels) {
      try {
        await this.sendNotification(channel, alert);
      } catch (error) {
        this.logger.error(`Failed to send notification via ${channel}:`, error);
      }
    }
  }

  /**
   * Send notification through specific channel
   */
  async sendNotification(channel, alert) {
    // Placeholder for notification implementation
    this.logger.info(`Sending ${channel} notification for scan ${alert.scanId}`, {
      critical: alert.critical,
      high: alert.high,
      total: alert.total
    });
  }

  /**
   * Send failure notification
   */
  async sendFailureNotification(scanId, error, options) {
    const alert = {
      scanId,
      timestamp: new Date(),
      error: error.message,
      retryCount: options.retryCount || 0
    };

    this.logger.error('Scan failure notification:', alert);
  }

  /**
   * Generate scan report
   */
  async generateScanReport(scanId, results, categorized) {
    return {
      scanId,
      timestamp: new Date(),
      summary: {
        total: results.length,
        critical: categorized.critical.length,
        high: categorized.high.length,
        medium: categorized.medium.length,
        low: categorized.low.length,
        info: categorized.info.length
      },
      vulnerabilities: results.map(v => v.toSummary()),
      recommendations: this.generateRecommendations(categorized)
    };
  }

  /**
   * Generate recommendations based on scan results
   */
  generateRecommendations(categorized) {
    const recommendations = [];

    if (categorized.critical.length > 0) {
      recommendations.push({
        priority: 'critical',
        action: 'immediate',
        message: `Address ${categorized.critical.length} critical vulnerabilities immediately`,
        affectedPackages: categorized.critical.map(v => v.affectedComponent)
      });
    }

    if (categorized.high.length > 0) {
      recommendations.push({
        priority: 'high',
        action: 'within_24h',
        message: `Review and fix ${categorized.high.length} high-severity vulnerabilities`,
        affectedPackages: categorized.high.map(v => v.affectedComponent)
      });
    }

    return recommendations;
  }

  /**
   * Save scan report
   */
  async saveScanReport(report) {
    try {
      const fs = require('fs').promises;
      const path = require('path');

      const reportsDir = path.join(process.cwd(), 'reports', 'scans');
      await fs.mkdir(reportsDir, { recursive: true });

      const filename = `scan-${report.scanId}.json`;
      const filepath = path.join(reportsDir, filename);

      await fs.writeFile(filepath, JSON.stringify(report, null, 2));

      this.logger.info(`Scan report saved to ${filepath}`);

    } catch (error) {
      this.logger.error('Failed to save scan report:', error);
    }
  }

  /**
   * Get next run time for cron expression
   */
  getNextRunTime(cronExpression) {
    try {
      // This is a simplified implementation
      // In production, you'd use a proper cron parser
      const now = new Date();
      const nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next day as placeholder
      return nextRun;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    const jobs = Array.from(this.scheduledJobs.entries()).map(([name, info]) => ({
      name,
      cronExpression: info.cronExpression,
      active: info.active,
      lastRun: info.lastRun,
      nextRun: info.nextRun,
      runCount: info.runCount || 0
    }));

    return {
      enabled: this.config.enabled,
      activeScans: this.activeScans.size,
      queuedScans: this.scanQueue.length,
      maxConcurrentScans: this.config.maxConcurrentScans,
      scheduledJobs: jobs
    };
  }

  /**
   * Unschedule a scan job
   */
  unscheduleScan(name) {
    if (this.scheduledJobs.has(name)) {
      const jobInfo = this.scheduledJobs.get(name);
      jobInfo.job.stop();
      jobInfo.active = false;
      this.scheduledJobs.delete(name);

      this.logger.info(`Unscheduled scan job '${name}'`);
      return true;
    }

    return false;
  }

  /**
   * Enable/disable a scheduled job
   */
  toggleScan(name, enabled) {
    if (this.scheduledJobs.has(name)) {
      const jobInfo = this.scheduledJobs.get(name);

      if (enabled) {
        jobInfo.job.start();
        jobInfo.active = true;
      } else {
        jobInfo.job.stop();
        jobInfo.active = false;
      }

      this.logger.info(`Scan job '${name}' ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }

    return false;
  }

  /**
   * Shutdown scheduler
   */
  async shutdown() {
    this.logger.info('Shutting down scan scheduler...');

    // Stop all scheduled jobs
    for (const [name, jobInfo] of this.scheduledJobs.entries()) {
      jobInfo.job.stop();
    }

    // Wait for active scans to complete (with timeout)
    const shutdownTimeout = 60000; // 1 minute
    const startTime = Date.now();

    while (this.activeScans.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (this.activeScans.size > 0) {
      this.logger.warn(`Shutdown timeout with ${this.activeScans.size} active scans`);
    }

    this.scheduledJobs.clear();
    this.scanQueue = [];

    this.logger.info('Scan scheduler shutdown complete');
  }
}

module.exports = ScanScheduler;