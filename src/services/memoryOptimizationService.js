const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const v8 = require('v8');
const { performance } = require('perf_hooks');

/**
 * Memory Optimization Service
 * Provides comprehensive memory management and optimization for the notification system
 */
class MemoryOptimizationService extends EventEmitter {
  constructor() {
    super();

    this.isEnabled = true;
    this.monitoringInterval = 30000; // 30 seconds
    this.cleanupInterval = 60000; // 1 minute
    this.gcInterval = 300000; // 5 minutes

    // Memory thresholds and limits
    this.thresholds = {
      heapUsed: 0.8, // 80% of heap limit
      heapTotal: 0.9, // 90% of available memory
      rss: 0.85, // 85% of RSS
      external: 0.7, // 70% of external memory
      arrayBuffers: 0.6 // 60% of array buffers
    };

    // Optimization settings
    this.config = {
      enableAutoGC: true,
      enableWeakReferences: true,
      enableObjectPooling: true,
      enableMemoryProfiling: false,
      maxObjectPoolSize: 1000,
      maxCacheSize: 10000,
      cacheCleanupThreshold: 0.8,
      compressionThreshold: 1024, // 1KB
      enableCompression: true
    };

    // Object pools for frequently used objects
    this.objectPools = {
      notifications: [],
      messages: [],
      events: [],
      buffers: [],
      strings: []
    };

    // Caches with LRU eviction
    this.caches = {
      userSessions: new Map(),
      connectionMetadata: new Map(),
      notificationCache: new Map(),
      templateCache: new Map(),
      rateLimitData: new Map()
    };

    // Memory monitoring
    this.memoryStats = {
      current: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        arrayBuffers: 0
      },
      peak: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        arrayBuffers: 0
      },
      gc: {
        collections: 0,
        duration: 0,
        lastCollection: null,
        types: {
          scavenge: 0,
          markSweepCompact: 0,
          incrementalMarking: 0,
          weakPhantom: 0
        }
      },
      optimizations: {
        cacheCleanups: 0,
        objectPoolHits: 0,
        objectPoolMisses: 0,
        compressions: 0,
        weakReferencesCleaned: 0
      }
    };

    // Weak references for cleanup
    this.weakRefs = new Set();

    // Start optimization services
    this.startOptimizationServices();

    logger.info('Memory optimization service initialized');
  }

  /**
   * Start all optimization services
   */
  startOptimizationServices() {
    if (this.isEnabled) {
      this.startMemoryMonitoring();
      this.startPeriodicCleanup();
      this.startGCStatistics();

      if (this.config.enableAutoGC) {
        this.startAutoGC();
      }

      if (this.config.enableWeakReferences) {
        this.startWeakReferenceCleanup();
      }
    }
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    setInterval(() => {
      this.collectMemoryStats();
      this.checkMemoryThresholds();
    }, this.monitoringInterval);
  }

  /**
   * Collect current memory statistics
   */
  collectMemoryStats() {
    try {
      const memUsage = process.memoryUsage();
      const heapStats = v8.getHeapStatistics();

      this.memoryStats.current = {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        arrayBuffers: memUsage.arrayBuffers
      };

      // Update peak values
      for (const [key, value] of Object.entries(this.memoryStats.current)) {
        if (value > this.memoryStats.peak[key]) {
          this.memoryStats.peak[key] = value;
        }
      }

      // Calculate memory efficiency metrics
      const heapEfficiency = this.memoryStats.current.heapUsed / this.memoryStats.current.heapTotal;
      const externalRatio = this.memoryStats.current.external / this.memoryStats.current.heapUsed;

      // Emit memory stats event
      this.emit('memory:stats', {
        current: this.memoryStats.current,
        peak: this.memoryStats.peak,
        efficiency: {
          heapEfficiency,
          externalRatio,
          totalMemory: this.memoryStats.current.rss
        },
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Failed to collect memory statistics:', error);
    }
  }

  /**
   * Check memory thresholds and trigger optimizations
   */
  checkMemoryThresholds() {
    try {
      const memUsage = process.memoryUsage();
      const totalMemory = require('os').totalmem();
      const freeMemory = require('os').freemem();

      // Check heap usage
      const heapUsageRatio = memUsage.heapUsed / memUsage.heapTotal;
      if (heapUsageRatio > this.thresholds.heapUsed) {
        logger.warn('High heap usage detected', {
          usage: `${(heapUsageRatio * 100).toFixed(2)}%`,
          used: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          total: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`
        });

        this.triggerOptimization('high_heap_usage');
      }

      // Check RSS usage
      const rssUsageRatio = memUsage.rss / totalMemory;
      if (rssUsageRatio > this.thresholds.rss) {
        logger.warn('High RSS usage detected', {
          usage: `${(rssUsageRatio * 100).toFixed(2)}%`,
          used: `${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`,
          systemTotal: `${(totalMemory / 1024 / 1024).toFixed(2)}MB`
        });

        this.triggerOptimization('high_rss_usage');
      }

      // Check external memory
      if (memUsage.external > 0) {
        const externalRatio = memUsage.external / memUsage.heapUsed;
        if (externalRatio > this.thresholds.external) {
          logger.warn('High external memory usage detected', {
            external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
            heap: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
            ratio: `${(externalRatio * 100).toFixed(2)}%`
          });

          this.triggerOptimization('high_external_usage');
        }
      }

      // Check system memory pressure
      const systemMemoryPressure = 1 - (freeMemory / totalMemory);
      if (systemMemoryPressure > 0.9) {
        logger.warn('High system memory pressure', {
          used: `${((totalMemory - freeMemory) / 1024 / 1024).toFixed(2)}MB`,
          free: `${(freeMemory / 1024 / 1024).toFixed(2)}MB`,
          pressure: `${(systemMemoryPressure * 100).toFixed(2)}%`
        });

        this.triggerOptimization('system_memory_pressure');
      }

    } catch (error) {
      logger.error('Failed to check memory thresholds:', error);
    }
  }

  /**
   * Trigger memory optimization based on conditions
   */
  triggerOptimization(reason) {
    try {
      logger.info(`Triggering memory optimization: ${reason}`);

      switch (reason) {
        case 'high_heap_usage':
          this.optimizeHeapUsage();
          break;
        case 'high_rss_usage':
          this.optimizeRSSUsage();
          break;
        case 'high_external_usage':
          this.optimizeExternalMemory();
          break;
        case 'system_memory_pressure':
          this.optimizeForSystemPressure();
          break;
        default:
          this.performGeneralOptimization();
      }

      this.emit('memory:optimization', { reason, timestamp: Date.now() });

    } catch (error) {
      logger.error(`Failed to trigger optimization for ${reason}:`, error);
    }
  }

  /**
   * Optimize heap usage
   */
  optimizeHeapUsage() {
    try {
      // Clear caches
      this.clearOldCacheEntries();

      // Clean object pools
      this.cleanupObjectPools();

      // Force garbage collection if enabled
      if (this.config.enableAutoGC) {
        this.forceGarbageCollection();
      }

      // Clean up weak references
      this.cleanupWeakReferences();

      logger.info('Heap usage optimization completed');

    } catch (error) {
      logger.error('Failed to optimize heap usage:', error);
    }
  }

  /**
   * Optimize RSS usage
   */
  optimizeRSSUsage() {
    try {
      // More aggressive cleanup for RSS
      this.clearAllCaches();
      this.cleanupObjectPools();
      this.cleanupWeakReferences();

      // Force multiple garbage collections
      if (this.config.enableAutoGC) {
        this.forceGarbageCollection();
        setTimeout(() => this.forceGarbageCollection(), 100);
      }

      logger.info('RSS usage optimization completed');

    } catch (error) {
      logger.error('Failed to optimize RSS usage:', error);
    }
  }

  /**
   * Optimize external memory usage
   */
  optimizeExternalMemory() {
    try {
      // Focus on external memory cleanup
      this.cleanupWeakReferences();
      this.clearLargeBuffers();

      // Clear caches that might hold external references
      for (const [cacheName, cache] of this.caches) {
        if (cache.size > this.config.maxCacheSize * 0.5) {
          this.clearCache(cacheName, 0.5); // Clear 50% of entries
        }
      }

      logger.info('External memory optimization completed');

    } catch (error) {
      logger.error('Failed to optimize external memory:', error);
    }
  }

  /**
   * Optimize for system memory pressure
   */
  optimizeForSystemPressure() {
    try {
      // Most aggressive optimization
      this.clearAllCaches();
      this.cleanupObjectPools();
      this.cleanupWeakReferences();
      this.clearLargeBuffers();

      // Force immediate garbage collection
      if (this.config.enableAutoGC) {
        this.forceGarbageCollection();
      }

      logger.info('System memory pressure optimization completed');

    } catch (error) {
      logger.error('Failed to optimize for system memory pressure:', error);
    }
  }

  /**
   * Perform general optimization
   */
  performGeneralOptimization() {
    try {
      this.clearOldCacheEntries();
      this.cleanupObjectPools();
      this.cleanupWeakReferences();

      logger.info('General memory optimization completed');

    } catch (error) {
      logger.error('Failed to perform general optimization:', error);
    }
  }

  /**
   * Get object from pool
   */
  getFromPool(poolName) {
    if (!this.config.enableObjectPooling) {
      return null;
    }

    const pool = this.objectPools[poolName];
    if (pool && pool.length > 0) {
      this.memoryStats.optimizations.objectPoolHits++;
      return pool.pop();
    }

    this.memoryStats.optimizations.objectPoolMisses++;
    return null;
  }

  /**
   * Return object to pool
   */
  returnToPool(poolName, obj) {
    if (!this.config.enableObjectPooling) {
      return;
    }

    const pool = this.objectPools[poolName];
    if (pool && pool.length < this.config.maxObjectPoolSize) {
      // Reset object if possible
      this.resetObject(obj);
      pool.push(obj);
    }
  }

  /**
   * Reset object for reuse
   */
  resetObject(obj) {
    if (obj && typeof obj === 'object') {
      // Clear object properties
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          delete obj[key];
        }
      }
    }
  }

  /**
   * Cleanup object pools
   */
  cleanupObjectPools() {
    try {
      for (const [poolName, pool] of Object.entries(this.objectPools)) {
        // Keep only recent objects
        if (pool.length > this.config.maxObjectPoolSize * 0.5) {
          const keepCount = Math.floor(this.config.maxObjectPoolSize * 0.5);
          this.objectPools[poolName] = pool.slice(-keepCount);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup object pools:', error);
    }
  }

  /**
   * Add entry to cache with size management
   */
  addToCache(cacheName, key, value, maxSize = null) {
    const cache = this.caches[cacheName];
    if (!cache) {
      return;
    }

    const sizeLimit = maxSize || this.config.maxCacheSize;

    // Check if cache is full
    if (cache.size >= sizeLimit) {
      // Remove oldest entries
      const entriesToRemove = Math.floor(sizeLimit * this.config.cacheCleanupThreshold);
      const keysToRemove = Array.from(cache.keys()).slice(0, entriesToRemove);

      for (const keyToRemove of keysToRemove) {
        cache.delete(keyToRemove);
      }

      this.memoryStats.optimizations.cacheCleanups++;
    }

    // Add new entry
    cache.set(key, {
      value,
      addedAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now()
    });
  }

  /**
   * Get entry from cache
   */
  getFromCache(cacheName, key) {
    const cache = this.caches[cacheName];
    if (!cache) {
      return null;
    }

    const entry = cache.get(key);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      return entry.value;
    }

    return null;
  }

  /**
   * Clear specific cache
   */
  clearCache(cacheName, ratio = 1.0) {
    const cache = this.caches[cacheName];
    if (!cache) {
      return;
    }

    const entriesToRemove = Math.floor(cache.size * ratio);
    const keysToRemove = Array.from(cache.keys()).slice(0, entriesToRemove);

    for (const keyToRemove of keysToRemove) {
      cache.delete(keyToRemove);
    }

    this.memoryStats.optimizations.cacheCleanups++;
  }

  /**
   * Clear old cache entries based on age
   */
  clearOldCacheEntries() {
    try {
      const now = Date.now();
      const maxAge = 30 * 60 * 1000; // 30 minutes

      for (const [cacheName, cache] of Object.entries(this.caches)) {
        const keysToRemove = [];

        for (const [key, entry] of cache) {
          if (now - entry.addedAt > maxAge) {
            keysToRemove.push(key);
          }
        }

        for (const keyToRemove of keysToRemove) {
          cache.delete(keyToRemove);
        }

        if (keysToRemove.length > 0) {
          this.memoryStats.optimizations.cacheCleanups++;
          logger.debug(`Cleared ${keysToRemove.length} old entries from cache: ${cacheName}`);
        }
      }
    } catch (error) {
      logger.error('Failed to clear old cache entries:', error);
    }
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    try {
      for (const cacheName of Object.keys(this.caches)) {
        this.caches[cacheName].clear();
      }

      this.memoryStats.optimizations.cacheCleanups++;
      logger.info('All caches cleared');

    } catch (error) {
      logger.error('Failed to clear all caches:', error);
    }
  }

  /**
   * Create weak reference
   */
  createWeakReference(target, cleanupCallback) {
    if (!this.config.enableWeakReferences) {
      return null;
    }

    try {
      const weakRef = new WeakRef(target);
      this.weakRefs.add({ weakRef, cleanupCallback });
      return weakRef;
    } catch (error) {
      logger.error('Failed to create weak reference:', error);
      return null;
    }
  }

  /**
   * Cleanup weak references
   */
  cleanupWeakReferences() {
    try {
      const toRemove = [];

      for (const refInfo of this.weakRefs) {
        const { weakRef, cleanupCallback } = refInfo;

        // Check if the target is still alive
        if (weakRef.deref() === undefined) {
          // Target was garbage collected, run cleanup
          if (cleanupCallback) {
            cleanupCallback();
          }
          toRemove.push(refInfo);
        }
      }

      // Remove cleaned up references
      for (const refInfo of toRemove) {
        this.weakRefs.delete(refInfo);
      }

      if (toRemove.length > 0) {
        this.memoryStats.optimizations.weakReferencesCleaned += toRemove.length;
      }

    } catch (error) {
      logger.error('Failed to cleanup weak references:', error);
    }
  }

  /**
   * Clear large buffers
   */
  clearLargeBuffers() {
    try {
      // Clear buffer pool
      const bufferPool = this.objectPools.buffers;
      if (bufferPool) {
        const largeBuffers = bufferPool.filter(buffer =>
          buffer && buffer.length > 1024 * 100 // 100KB
        );

        // Remove large buffers
        for (const buffer of largeBuffers) {
          const index = bufferPool.indexOf(buffer);
          if (index !== -1) {
            bufferPool.splice(index, 1);
          }
        }

        if (largeBuffers.length > 0) {
          logger.debug(`Cleared ${largeBuffers.length} large buffers`);
        }
      }
    } catch (error) {
      logger.error('Failed to clear large buffers:', error);
    }
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup() {
    setInterval(() => {
      this.clearOldCacheEntries();
      this.cleanupObjectPools();
      this.cleanupWeakReferences();
    }, this.cleanupInterval);
  }

  /**
   * Start GC statistics collection
   */
  startGCStatistics() {
    try {
      const gcStats = v8.getHeapStatistics();

      // Track GC performance
      setInterval(() => {
        const newStats = v8.getHeapStatistics();

        // Detect GC events by comparing statistics
        if (newStats.number_of_native_contexts !== gcStats.number_of_native_contexts) {
          this.memoryStats.gc.collections++;
          this.memoryStats.gc.lastCollection = new Date().toISOString();
        }

        Object.assign(gcStats, newStats);
      }, 1000);

    } catch (error) {
      logger.error('Failed to start GC statistics:', error);
    }
  }

  /**
   * Start automatic garbage collection
   */
  startAutoGC() {
    setInterval(() => {
      if (this.shouldTriggerGC()) {
        this.forceGarbageCollection();
      }
    }, this.gcInterval);
  }

  /**
   * Check if garbage collection should be triggered
   */
  shouldTriggerGC() {
    try {
      const memUsage = process.memoryUsage();
      const heapUsageRatio = memUsage.heapUsed / memUsage.heapTotal;

      // Trigger GC if heap usage is high
      return heapUsageRatio > 0.75;
    } catch (error) {
      return false;
    }
  }

  /**
   * Force garbage collection
   */
  forceGarbageCollection() {
    try {
      if (global.gc) {
        const startTime = performance.now();
        global.gc();
        const duration = performance.now() - startTime;

        this.memoryStats.gc.duration += duration;
        logger.debug(`Forced garbage collection completed in ${duration.toFixed(2)}ms`);
      } else {
        logger.debug('Garbage collection not available (run with --expose-gc)');
      }
    } catch (error) {
      logger.error('Failed to force garbage collection:', error);
    }
  }

  /**
   * Start weak reference cleanup
   */
  startWeakReferenceCleanup() {
    setInterval(() => {
      this.cleanupWeakReferences();
    }, 30000); // Every 30 seconds
  }

  /**
   * Get memory statistics
   */
  getMemoryStats() {
    return {
      current: this.memoryStats.current,
      peak: this.memoryStats.peak,
      gc: this.memoryStats.gc,
      optimizations: this.memoryStats.optimizations,
      config: this.config,
      pools: Object.fromEntries(
        Object.entries(this.objectPools).map(([name, pool]) => [name, pool.length])
      ),
      caches: Object.fromEntries(
        Object.entries(this.caches).map(([name, cache]) => [name, cache.size])
      ),
      timestamp: Date.now()
    };
  }

  /**
   * Get memory recommendations
   */
  getMemoryRecommendations() {
    const recommendations = [];
    const stats = this.memoryStats.current;

    // Heap usage recommendations
    const heapUsageRatio = stats.heapUsed / stats.heapTotal;
    if (heapUsageRatio > 0.8) {
      recommendations.push({
        type: 'heap_usage',
        priority: 'high',
        message: `High heap usage (${(heapUsageRatio * 100).toFixed(1)}%). Consider increasing heap size or optimizing memory usage.`,
        current: heapUsageRatio,
        recommended: 0.7
      });
    }

    // External memory recommendations
    if (stats.external > 0) {
      const externalRatio = stats.external / stats.heapUsed;
      if (externalRatio > 0.5) {
        recommendations.push({
          type: 'external_memory',
          priority: 'medium',
          message: `High external memory usage (${(externalRatio * 100).toFixed(1)}% of heap). Check for Buffer leaks.`,
          current: externalRatio,
          recommended: 0.3
        });
      }
    }

    // Cache size recommendations
    const totalCacheSize = Object.values(this.caches).reduce((sum, cache) => sum + cache.size, 0);
    if (totalCacheSize > this.config.maxCacheSize) {
      recommendations.push({
        type: 'cache_size',
        priority: 'medium',
        message: `Cache size (${totalCacheSize}) exceeds recommended limit (${this.config.maxCacheSize}). Consider reducing cache size.`,
        current: totalCacheSize,
        recommended: this.config.maxCacheSize
      });
    }

    // GC recommendations
    if (this.memoryStats.gc.collections > 0) {
      const avgGCDuration = this.memoryStats.gc.duration / this.memoryStats.gc.collections;
      if (avgGCDuration > 100) { // 100ms
        recommendations.push({
          type: 'gc_performance',
          priority: 'medium',
          message: `High average GC duration (${avgGCDuration.toFixed(2)}ms). Consider reducing object allocation rates.`,
          current: avgGCDuration,
          recommended: 50
        });
      }
    }

    return recommendations;
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.memoryStats = {
      current: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        arrayBuffers: 0
      },
      peak: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        arrayBuffers: 0
      },
      gc: {
        collections: 0,
        duration: 0,
        lastCollection: null,
        types: {
          scavenge: 0,
          markSweepCompact: 0,
          incrementalMarking: 0,
          weakPhantom: 0
        }
      },
      optimizations: {
        cacheCleanups: 0,
        objectPoolHits: 0,
        objectPoolMisses: 0,
        compressions: 0,
        weakReferencesCleaned: 0
      }
    };

    logger.info('Memory optimization statistics reset');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info('Memory optimization configuration updated', newConfig);
  }

  /**
   * Enable/disable service
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    logger.info(`Memory optimization service ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Shutdown the service
   */
  shutdown() {
    logger.info('Shutting down memory optimization service');

    this.isEnabled = false;

    // Clear all caches and pools
    this.clearAllCaches();

    for (const pool of Object.values(this.objectPools)) {
      pool.length = 0;
    }

    this.weakRefs.clear();
    this.removeAllListeners();

    logger.info('Memory optimization service shutdown complete');
  }
}

// Create singleton instance
const memoryOptimizationService = new MemoryOptimizationService();

module.exports = memoryOptimizationService;