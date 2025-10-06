/**
 * Security Scan Performance Optimizer
 * Optimizes vulnerability scanning operations for better performance and resource utilization
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const winston = require('winston');

class ScanOptimizer {
  constructor(config = {}) {
    this.config = {
      // Caching configuration
      cacheEnabled: config.cacheEnabled !== false,
      cacheDirectory: config.cacheDirectory || path.join(process.cwd(), '.cache', 'security'),
      cacheMaxSize: config.cacheMaxSize || 1024 * 1024 * 100, // 100MB
      cacheTTL: config.cacheTTL || 86400000, // 24 hours

      // Parallel processing configuration
      maxConcurrentScans: config.maxConcurrentScans || 4,
      chunkSize: config.chunkSize || 100, // Files per chunk

      // Incremental scanning configuration
      incrementalScanning: config.incrementalScanning !== false,
      changedFilesOnly: config.changedFilesOnly !== false,

      // Resource management
      maxMemoryUsage: config.maxMemoryUsage || 1024 * 1024 * 512, // 512MB
      scanTimeout: config.scanTimeout || 300000, // 5 minutes

      // Performance thresholds
      performanceThresholds: {
        scanTime: config.scanTimeThreshold || 60000, // 1 minute
        memoryUsage: config.memoryUsageThreshold || 1024 * 1024 * 256, // 256MB
        cpuUsage: config.cpuUsageThreshold || 80 // 80%
      },

      ...config
    };

    this.cache = new Map();
    this.scanQueue = [];
    this.activeScanCount = 0;
    this.performanceMetrics = {
      totalScans: 0,
      averageScanTime: 0,
      cacheHitRate: 0,
      memoryUsage: 0,
      lastCleanup: Date.now()
    };

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/security-scan-optimizer.log'
        })
      ]
    });

    this.initializeCache();
  }

  /**
   * Initialize cache directory and clean old cache
   */
  initializeCache() {
    try {
      if (!fs.existsSync(this.config.cacheDirectory)) {
        fs.mkdirSync(this.config.cacheDirectory, { recursive: true });
      }

      // Clean old cache files on startup
      this.cleanupCache();

      this.logger.info('Scan optimizer cache initialized', {
        cacheDirectory: this.config.cacheDirectory,
        cacheMaxSize: this.config.cacheMaxSize
      });
    } catch (error) {
      this.logger.error('Failed to initialize cache:', error);
    }
  }

  /**
   * Generate cache key for scan parameters
   */
  generateCacheKey(scanPath, options = {}) {
    const hash = crypto.createHash('sha256');
    hash.update(`${scanPath}:${JSON.stringify(options)}`);
    return `scan_${hash.digest('hex')}`;
  }

  /**
   * Get cached scan results
   */
  getCachedResult(cacheKey) {
    if (!this.config.cacheEnabled) return null;

    try {
      const cacheFile = path.join(this.config.cacheDirectory, `${cacheKey}.json`);

      if (!fs.existsSync(cacheFile)) {
        return null;
      }

      const stats = fs.statSync(cacheFile);
      const isExpired = (Date.now() - stats.mtime.getTime()) > this.config.cacheTTL;

      if (isExpired) {
        fs.unlinkSync(cacheFile);
        return null;
      }

      const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      this.performanceMetrics.cacheHitRate++;

      this.logger.debug('Cache hit', { cacheKey });
      return cachedData;
    } catch (error) {
      this.logger.warn('Cache retrieval failed:', error);
      return null;
    }
  }

  /**
   * Cache scan results
   */
  cacheResult(cacheKey, result) {
    if (!this.config.cacheEnabled) return;

    try {
      const cacheFile = path.join(this.config.cacheDirectory, `${cacheKey}.json`);
      const cacheData = {
        ...result,
        cachedAt: Date.now(),
        cacheKey
      };

      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));

      this.logger.debug('Result cached', {
        cacheKey,
        size: JSON.stringify(cacheData).length
      });
    } catch (error) {
      this.logger.warn('Cache storage failed:', error);
    }
  }

  /**
   * Clean up expired cache files
   */
  cleanupCache() {
    try {
      const files = fs.readdirSync(this.config.cacheDirectory);
      let totalSize = 0;
      const now = Date.now();

      files.forEach(file => {
        if (!file.endsWith('.json')) return;

        const filePath = path.join(this.config.cacheDirectory, file);
        const stats = fs.statSync(filePath);

        // Remove expired files
        if (now - stats.mtime.getTime() > this.config.cacheTTL) {
          fs.unlinkSync(filePath);
          return;
        }

        totalSize += stats.size;
      });

      // If cache exceeds max size, remove oldest files
      if (totalSize > this.config.cacheMaxSize) {
        const sortedFiles = files
          .filter(file => file.endsWith('.json'))
          .map(file => ({
            file,
            path: path.join(this.config.cacheDirectory, file),
            mtime: fs.statSync(path.join(this.config.cacheDirectory, file)).mtime
          }))
          .sort((a, b) => a.mtime - b.mtime);

        let currentSize = totalSize;
        for (const { file, path: filePath } of sortedFiles) {
          if (currentSize <= this.config.cacheMaxSize * 0.8) break;

          const stats = fs.statSync(filePath);
          fs.unlinkSync(filePath);
          currentSize -= stats.size;

          this.logger.debug('Removed old cache file', { file });
        }
      }

      this.performanceMetrics.lastCleanup = now;
      this.logger.info('Cache cleanup completed', {
        totalSize: totalSize / 1024 / 1024, // MB
        filesRemoved: files.length - fs.readdirSync(this.config.cacheDirectory).length
      });
    } catch (error) {
      this.logger.error('Cache cleanup failed:', error);
    }
  }

  /**
   * Check if scan should be skipped based on changes
   */
  shouldSkipIncrementalScan(scanPath, lastScanTime) {
    if (!this.config.incrementalScanning) return false;

    try {
      const stats = fs.statSync(scanPath);
      return stats.mtime.getTime() <= lastScanTime;
    } catch (error) {
      return false;
    }
  }

  /**
   * Split file list into chunks for parallel processing
   */
  chunkFiles(files, chunkSize = this.config.chunkSize) {
    const chunks = [];
    for (let i = 0; i < files.length; i += chunkSize) {
      chunks.push(files.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Execute scan with performance optimization
   */
  async executeOptimizedScan(scanPath, options = {}) {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(scanPath, options);

    this.logger.info('Starting optimized scan', { scanPath, cacheKey });

    try {
      // Check cache first
      const cachedResult = this.getCachedResult(cacheKey);
      if (cachedResult) {
        this.logger.info('Using cached scan result', {
          scanPath,
          age: Date.now() - cachedResult.cachedAt
        });
        return cachedResult;
      }

      // Check if we can skip incremental scan
      if (this.shouldSkipIncrementalScan(scanPath, options.lastScanTime || 0)) {
        this.logger.info('Skipping incremental scan - no changes', { scanPath });
        return { skipped: true, reason: 'No changes detected' };
      }

      // Wait if too many concurrent scans
      while (this.activeScanCount >= this.config.maxConcurrentScans) {
        await this.sleep(1000);
      }

      this.activeScanCount++;

      try {
        // Get file list and chunk for parallel processing
        const files = await this.getFileList(scanPath);
        const chunks = this.chunkFiles(files);

        // Process chunks in parallel with rate limiting
        const results = [];
        for (let i = 0; i < chunks.length; i += this.config.maxConcurrentScans) {
          const batch = chunks.slice(i, i + this.config.maxConcurrentScans);

          const batchPromises = batch.map(chunk =>
            this.processChunk(chunk, options)
          );

          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults.flat());

          // Check memory usage and pause if needed
          if (this.getMemoryUsage() > this.config.maxMemoryUsage) {
            this.logger.warn('High memory usage detected, pausing scan');
            await this.sleep(5000);
          }
        }

        const scanResult = {
          scanPath,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          filesScanned: files.length,
          vulnerabilities: results.filter(r => r.vulnerabilities?.length > 0),
          totalVulnerabilities: results.reduce((sum, r) => sum + (r.vulnerabilities?.length || 0), 0),
          performanceMetrics: this.getPerformanceMetrics()
        };

        // Cache the results
        this.cacheResult(cacheKey, scanResult);

        // Update performance metrics
        this.updatePerformanceMetrics(scanResult);

        this.logger.info('Optimized scan completed', {
          scanPath,
          duration: scanResult.duration,
          filesScanned: scanResult.filesScanned,
          vulnerabilities: scanResult.totalVulnerabilities
        });

        return scanResult;

      } finally {
        this.activeScanCount--;
      }

    } catch (error) {
      this.logger.error('Optimized scan failed:', error);
      throw error;
    }
  }

  /**
   * Get list of files to scan
   */
  async getFileList(scanPath) {
    const files = [];

    const scanDirectory = (dir) => {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          // Skip common directories that don't need scanning
          if (!['node_modules', '.git', '.cache', 'dist', 'build'].includes(item)) {
            scanDirectory(fullPath);
          }
        } else if (stats.isFile()) {
          // Only scan relevant file types
          const ext = path.extname(item).toLowerCase();
          const relevantExts = ['.js', '.ts', '.json', '.md', '.yml', '.yaml', '.env', '.config'];

          if (relevantExts.includes(ext) || !ext) {
            files.push(fullPath);
          }
        }
      }
    };

    scanDirectory(scanPath);
    return files;
  }

  /**
   * Process a chunk of files
   */
  async processChunk(files, options) {
    const results = [];

    for (const file of files) {
      try {
        const result = await this.scanFile(file, options);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        this.logger.warn('File scan failed:', { file, error: error.message });
      }
    }

    return results;
  }

  /**
   * Scan individual file (placeholder for actual scanning logic)
   */
  async scanFile(file, options) {
    // This would integrate with the actual vulnerability scanner
    // For now, return a mock result
    return {
      file,
      scannedAt: Date.now(),
      vulnerabilities: [] // Would contain actual vulnerabilities
    };
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return usage.heapUsed;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      activeScanCount: this.activeScanCount,
      cacheSize: this.cache.size,
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(scanResult) {
    this.performanceMetrics.totalScans++;

    const scanTime = scanResult.duration;
    const totalScans = this.performanceMetrics.totalScans;

    // Calculate rolling average
    this.performanceMetrics.averageScanTime =
      ((this.performanceMetrics.averageScanTime * (totalScans - 1)) + scanTime) / totalScans;

    this.performanceMetrics.memoryUsage = this.getMemoryUsage();
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all cache
   */
  clearCache() {
    try {
      const files = fs.readdirSync(this.config.cacheDirectory);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.config.cacheDirectory, file));
        }
      }

      this.cache.clear();
      this.logger.info('Cache cleared completely');
    } catch (error) {
      this.logger.error('Failed to clear cache:', error);
    }
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations() {
    const metrics = this.getPerformanceMetrics();
    const recommendations = [];

    if (metrics.averageScanTime > this.config.performanceThresholds.scanTime) {
      recommendations.push({
        type: 'performance',
        message: 'Average scan time exceeds threshold',
        suggestion: 'Consider increasing chunk size or reducing scan scope'
      });
    }

    if (metrics.memoryUsage > this.config.performanceThresholds.memoryUsage) {
      recommendations.push({
        type: 'memory',
        message: 'Memory usage exceeds threshold',
        suggestion: 'Reduce concurrent scans or implement memory pooling'
      });
    }

    if (metrics.cacheHitRate < 0.5 && metrics.totalScans > 10) {
      recommendations.push({
        type: 'cache',
        message: 'Low cache hit rate',
        suggestion: 'Increase cache TTL or review cache key generation'
      });
    }

    return recommendations;
  }
}

module.exports = ScanOptimizer;