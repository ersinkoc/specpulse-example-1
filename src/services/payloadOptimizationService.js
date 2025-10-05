const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const zlib = require('zlib');
const { promisify } = require('util');

/**
 * Payload Optimization Service
 * Provides message compression, payload optimization, and size management
 */
class PayloadOptimizationService extends EventEmitter {
  constructor() {
    super();

    // Configuration
    this.config = {
      // Compression settings
      compression: {
        enabled: true,
        threshold: 1024, // Compress messages larger than 1KB
        algorithm: 'gzip', // gzip, deflate, brotli, or auto
        level: 6, // Compression level (1-9 for gzip/deflate, 1-11 for brotli)
        windowBits: 15, // Compression window size
        memLevel: 8, // Memory level for compression
        strategy: 0 // Compression strategy
      },

      // Payload optimization
      optimization: {
        enabled: true,
        removeNullFields: true,
        removeUndefinedFields: true,
        convertArraysToObjects: false, // For small arrays
        compressNumbers: false, // Use binary representation
        shortFieldNames: false, // Use field name mapping
        minification: {
          enabled: true,
          removeWhitespace: true,
          removeComments: true
        }
      },

      // Size thresholds
      thresholds: {
        small: 512, // bytes
        medium: 2048, // bytes
        large: 10240, // bytes
        extraLarge: 51200, // bytes
        maxPayloadSize: 102400 // 100KB max
      },

      // Monitoring
      monitoring: {
        enabled: true,
        trackSizes: true,
        trackCompressionRatios: true,
        alertOnLargePayloads: true,
        largePayloadThreshold: 50 * 1024 // 50KB
      }
    };

    // Compression helpers
    this.compressors = {
      gzip: {
        compress: promisify(zlib.gzip),
        decompress: promisify(zlib.gunzip)
      },
      deflate: {
        compress: promisify(zlib.deflate),
        decompress: promisify(zlib.inflate)
      },
      brotli: {
        compress: promisify(zlib.brotliCompress),
        decompress: promisify(zlib.brotliDecompress)
      }
    };

    // Field name mapping for optimization
    this.fieldNameMap = new Map();
    this.reverseFieldNameMap = new Map();

    // Statistics
    this.stats = {
      compression: {
        total: 0,
        compressed: 0,
        failed: 0,
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        avgCompressionRatio: 0
      },
      optimization: {
        total: 0,
        optimized: 0,
        failed: 0,
        totalOriginalSize: 0,
        totalOptimizedSize: 0,
        avgOptimizationRatio: 0
      },
      monitoring: {
        payloadSizes: [],
        compressionRatios: [],
        largePayloads: 0,
        oversizedPayloads: 0
      }
    };

    // Initialize field name mapping
    this.initializeFieldNameMap();

    logger.info('Payload optimization service initialized');
  }

  /**
   * Initialize common field name mappings
   */
  initializeFieldNameMap() {
    const commonFields = [
      'userId', 'username', 'message', 'timestamp', 'type', 'id', 'data',
      'title', 'content', 'sender', 'receiver', 'channel', 'priority',
      'status', 'created', 'updated', 'metadata', 'payload', 'event',
      'notification', 'messageId', 'channelId', 'sessionId', 'device'
    ];

    commonFields.forEach((field, index) => {
      const shortName = `f${index}`;
      this.fieldNameMap.set(field, shortName);
      this.reverseFieldNameMap.set(shortName, field);
    });
  }

  /**
   * Optimize and compress a message payload
   */
  async processMessage(message, options = {}) {
    try {
      const startTime = Date.now();
      const config = { ...this.config, ...options };

      let processedMessage = message;
      let originalSize = this.calculateSize(message);
      let optimizedSize = originalSize;
      let compressedSize = originalSize;
      let compressionSteps = [];

      // Step 1: Payload optimization
      if (config.optimization.enabled) {
        processedMessage = await this.optimizePayload(processedMessage, config.optimization);
        optimizedSize = this.calculateSize(processedMessage);
        compressionSteps.push('optimization');
      }

      // Step 2: Compression
      let isCompressed = false;
      if (config.compression.enabled && this.shouldCompress(processedMessage, config.compression)) {
        const compressionResult = await this.compressPayload(processedMessage, config.compression);
        if (compressionResult.compressed) {
          processedMessage = compressionResult.data;
          compressedSize = this.calculateSize(processedMessage);
          isCompressed = true;
          compressionSteps.push(config.compression.algorithm);
        }
      }

      // Step 3: Size validation
      if (compressedSize > config.thresholds.maxPayloadSize) {
        logger.warn(`Payload exceeds maximum size: ${compressedSize} bytes`);
        this.stats.monitoring.oversizedPayloads++;
        this.emit('payload:oversized', { size: compressedSize, maxSize: config.thresholds.maxPayloadSize });
      }

      // Create result with metadata
      const result = {
        data: processedMessage,
        metadata: {
          originalSize,
          optimizedSize,
          compressedSize,
          compressionSteps,
          isCompressed,
          compressionRatio: originalSize > 0 ? (1 - compressedSize / originalSize) : 0,
          optimizationRatio: originalSize > 0 ? (1 - optimizedSize / originalSize) : 0,
          processingTime: Date.now() - startTime,
          algorithm: config.compression.algorithm,
          compressionLevel: config.compression.level
        }
      };

      // Update statistics
      this.updateStatistics(result.metadata, config.monitoring);

      // Emit events
      if (config.monitoring.enabled) {
        this.emit('payload:processed', result);
      }

      if (config.monitoring.alertOnLargePayloads && originalSize > config.monitoring.largePayloadThreshold) {
        this.stats.monitoring.largePayloads++;
        this.emit('payload:large', { originalSize, compressedSize, message });
      }

      return result;

    } catch (error) {
      logger.error('Failed to process message payload:', error);
      this.stats.compression.failed++;
      this.stats.optimization.failed++;

      // Return original message on failure
      return {
        data: message,
        metadata: {
          originalSize: this.calculateSize(message),
          error: error.message,
          processingTime: Date.now() - Date.now()
        }
      };
    }
  }

  /**
   * Decompress and restore a message payload
   */
  async restoreMessage(compressedMessage, metadata = {}) {
    try {
      let restoredMessage = compressedMessage;

      // Decompression
      if (metadata.isCompressed && metadata.algorithm) {
        const decompressionResult = await this.decompressPayload(restoredMessage, metadata.algorithm);
        if (decompressionResult.success) {
          restoredMessage = decompressionResult.data;
        }
      }

      // Restore optimized payload
      if (metadata.compressionSteps && metadata.compressionSteps.includes('optimization')) {
        restoredMessage = this.restoreOptimizedPayload(restoredMessage);
      }

      return {
        data: restoredMessage,
        success: true
      };

    } catch (error) {
      logger.error('Failed to restore message payload:', error);
      return {
        data: compressedMessage,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Optimize payload by removing unnecessary data and using field name mapping
   */
  async optimizePayload(payload, config) {
    try {
      if (typeof payload !== 'object' || payload === null) {
        return payload;
      }

      let optimized = JSON.parse(JSON.stringify(payload));

      // Remove null and undefined fields
      if (config.removeNullFields) {
        optimized = this.removeNullFields(optimized);
      }

      if (config.removeUndefinedFields) {
        optimized = this.removeUndefinedFields(optimized);
      }

      // Field name mapping
      if (config.shortFieldNames) {
        optimized = this.mapFieldNames(optimized);
      }

      // Convert small arrays to objects
      if (config.convertArraysToObjects) {
        optimized = this.convertSmallArraysToObjects(optimized);
      }

      // Number compression (simplified)
      if (config.compressNumbers) {
        optimized = this.compressNumbers(optimized);
      }

      // JSON minification
      if (config.minification.enabled) {
        return JSON.stringify(optimized);
      }

      return optimized;

    } catch (error) {
      logger.error('Failed to optimize payload:', error);
      return payload;
    }
  }

  /**
   * Restore optimized payload
   */
  restoreOptimizedPayload(payload) {
    try {
      let restored = typeof payload === 'string' ? JSON.parse(payload) : payload;

      // Restore field names
      restored = this.restoreFieldNames(restored);

      // Restore number compression
      restored = this.restoreNumbers(restored);

      // Restore converted arrays
      restored = this.restoreConvertedArrays(restored);

      return restored;

    } catch (error) {
      logger.error('Failed to restore optimized payload:', error);
      return payload;
    }
  }

  /**
   * Compress payload using specified algorithm
   */
  async compressPayload(data, config) {
    try {
      const algorithm = config.algorithm === 'auto' ? this.selectBestAlgorithm(data) : config.algorithm;
      const compressor = this.compressors[algorithm];

      if (!compressor) {
        throw new Error(`Unsupported compression algorithm: ${algorithm}`);
      }

      // Convert to buffer if needed
      const input = typeof data === 'string' ? Buffer.from(data) : Buffer.from(JSON.stringify(data));

      // Configure compression options
      const options = {
        level: config.level,
        windowBits: config.windowBits,
        memLevel: config.memLevel,
        strategy: config.strategy
      };

      const compressed = await compressor.compress(input, options);

      // Create compressed message with metadata
      const compressedMessage = {
        _compressed: true,
        _algorithm: algorithm,
        _originalSize: input.length,
        _compressedSize: compressed.length,
        _data: compressed.toString('base64')
      };

      return {
        compressed: true,
        data: compressedMessage,
        algorithm,
        originalSize: input.length,
        compressedSize: compressed.length
      };

    } catch (error) {
      logger.error('Failed to compress payload:', error);
      return { compressed: false, data };
    }
  }

  /**
   * Decompress payload
   */
  async decompressPayload(compressedMessage, algorithm) {
    try {
      const compressor = this.compressors[algorithm];
      if (!compressor) {
        throw new Error(`Unsupported decompression algorithm: ${algorithm}`);
      }

      const compressedData = Buffer.from(compressedMessage._data, 'base64');
      const decompressed = await compressor.decompress(compressedData);

      let restoredData;
      try {
        restoredData = JSON.parse(decompressed.toString());
      } catch {
        restoredData = decompressed.toString();
      }

      return {
        success: true,
        data: restoredData,
        originalSize: compressedMessage._originalSize,
        compressedSize: compressedMessage._compressedSize
      };

    } catch (error) {
      logger.error('Failed to decompress payload:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Determine if payload should be compressed
   */
  shouldCompress(data, config) {
    const size = this.calculateSize(data);
    return size >= config.threshold;
  }

  /**
   * Select best compression algorithm based on data characteristics
   */
  selectBestAlgorithm(data) {
    const size = this.calculateSize(data);
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

    // For very small payloads, compression might not help
    if (size < 512) {
      return 'none';
    }

    // Sample data characteristics
    const hasRepeatingPatterns = /(.)\1{3,}/.test(dataStr);
    const hasJsonStructure = dataStr.startsWith('{') && dataStr.endsWith('}');
    const isTextHeavy = /[a-zA-Z\s]{20,}/.test(dataStr);

    // Algorithm selection based on data type
    if (hasJsonStructure && hasRepeatingPatterns) {
      return 'gzip'; // Good for structured, repetitive data
    } else if (isTextHeavy) {
      return 'brotli'; // Better for text content
    } else {
      return 'deflate'; // Good balance for general use
    }
  }

  /**
   * Remove null fields from object recursively
   */
  removeNullFields(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeNullFields(item)).filter(item => item !== null);
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        result[key] = this.removeNullFields(value);
      }
    }
    return result;
  }

  /**
   * Remove undefined fields from object recursively
   */
  removeUndefinedFields(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeUndefinedFields(item)).filter(item => item !== undefined);
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = this.removeUndefinedFields(value);
      }
    }
    return result;
  }

  /**
   * Map field names to shorter versions
   */
  mapFieldNames(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.mapFieldNames(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const shortKey = this.fieldNameMap.get(key) || key;
      result[shortKey] = this.mapFieldNames(value);
    }
    return result;
  }

  /**
   * Restore field names from mapped versions
   */
  restoreFieldNames(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.restoreFieldNames(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const originalKey = this.reverseFieldNameMap.get(key) || key;
      result[originalKey] = this.restoreFieldNames(value);
    }
    return result;
  }

  /**
   * Convert small arrays to objects for better compression
   */
  convertSmallArraysToObjects(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      if (obj.length <= 3 && obj.every(item => typeof item === 'object' && item !== null)) {
        // Convert small arrays of objects to object with numeric keys
        const result = {};
        obj.forEach((item, index) => {
          result[`i${index}`] = this.convertSmallArraysToObjects(item);
        });
        return result;
      } else {
        return obj.map(item => this.convertSmallArraysToObjects(item));
      }
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.convertSmallArraysToObjects(value);
    }
    return result;
  }

  /**
   * Restore converted arrays back to array format
   */
  restoreConvertedArrays(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    // Check if this looks like a converted array
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every(key => /^i\d+$/.test(key))) {
      const indices = keys.map(key => parseInt(key.substring(1))).sort((a, b) => a - b);
      if (indices.every((index, i) => index === i)) {
        return indices.map(index => this.restoreConvertedArrays(obj[`i${index}`]));
      }
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.restoreConvertedArrays(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.restoreConvertedArrays(value);
    }
    return result;
  }

  /**
   * Compress numbers (simplified implementation)
   */
  compressNumbers(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.compressNumbers(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number' && Number.isInteger(value)) {
        // Convert large integers to strings for better compression
        result[key] = value > 1000000 ? value.toString() : value;
      } else {
        result[key] = this.compressNumbers(value);
      }
    }
    return result;
  }

  /**
   * Restore compressed numbers
   */
  restoreNumbers(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.restoreNumbers(item));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && /^\d+$/.test(value)) {
        const num = parseInt(value, 10);
        result[key] = num > 1000000 ? num : value;
      } else {
        result[key] = this.restoreNumbers(value);
      }
    }
    return result;
  }

  /**
   * Calculate size of data
   */
  calculateSize(data) {
    if (typeof data === 'string') {
      return Buffer.byteLength(data, 'utf8');
    } else if (Buffer.isBuffer(data)) {
      return data.length;
    } else {
      return Buffer.byteLength(JSON.stringify(data), 'utf8');
    }
  }

  /**
   * Update optimization statistics
   */
  updateStatistics(metadata, monitoring) {
    // Compression statistics
    this.stats.compression.total++;
    if (metadata.isCompressed) {
      this.stats.compression.compressed++;
      this.stats.compression.totalOriginalSize += metadata.originalSize;
      this.stats.compression.totalCompressedSize += metadata.compressedSize;
    }

    // Optimization statistics
    this.stats.optimization.total++;
    if (metadata.optimizationRatio > 0) {
      this.stats.optimization.optimized++;
      this.stats.optimization.totalOriginalSize += metadata.originalSize;
      this.stats.optimization.totalOptimizedSize += metadata.optimizedSize;
    }

    // Monitoring statistics
    if (monitoring.trackSizes) {
      this.stats.monitoring.payloadSizes.push({
        size: metadata.compressedSize,
        timestamp: Date.now()
      });

      // Keep only last 1000 entries
      if (this.stats.monitoring.payloadSizes.length > 1000) {
        this.stats.monitoring.payloadSizes.shift();
      }
    }

    if (monitoring.trackCompressionRatios && metadata.compressionRatio > 0) {
      this.stats.monitoring.compressionRatios.push({
        ratio: metadata.compressionRatio,
        timestamp: Date.now()
      });

      // Keep only last 1000 entries
      if (this.stats.monitoring.compressionRatios.length > 1000) {
        this.stats.monitoring.compressionRatios.shift();
      }
    }

    // Calculate averages
    this.calculateAverageRatios();
  }

  /**
   * Calculate average compression and optimization ratios
   */
  calculateAverageRatios() {
    if (this.stats.compression.compressed > 0) {
      this.stats.compression.avgCompressionRatio =
        1 - (this.stats.compression.totalCompressedSize / this.stats.compression.totalOriginalSize);
    }

    if (this.stats.optimization.optimized > 0) {
      this.stats.optimization.avgOptimizationRatio =
        1 - (this.stats.optimization.totalOptimizedSize / this.stats.optimization.totalOriginalSize);
    }
  }

  /**
   * Get payload size category
   */
  getSizeCategory(size) {
    const thresholds = this.config.thresholds;
    if (size <= thresholds.small) return 'small';
    if (size <= thresholds.medium) return 'medium';
    if (size <= thresholds.large) return 'large';
    if (size <= thresholds.extraLarge) return 'extraLarge';
    return 'massive';
  }

  /**
   * Get optimization statistics
   */
  getStats() {
    return {
      ...this.stats,
      timestamp: Date.now(),
      config: this.config
    };
  }

  /**
   * Get compression performance metrics
   */
  getCompressionMetrics() {
    const recentPayloads = this.stats.monitoring.payloadSizes.slice(-100);
    const recentRatios = this.stats.monitoring.compressionRatios.slice(-100);

    return {
      totalProcessed: this.stats.compression.total,
      compressionRate: this.stats.compression.total > 0 ?
        this.stats.compression.compressed / this.stats.compression.total : 0,
      averageCompressionRatio: this.stats.compression.avgCompressionRatio,
      totalBytesSaved: this.stats.compression.totalOriginalSize - this.stats.compression.totalCompressedSize,
      recentAverageSize: recentPayloads.length > 0 ?
        recentPayloads.reduce((sum, p) => sum + p.size, 0) / recentPayloads.length : 0,
      recentAverageRatio: recentRatios.length > 0 ?
        recentRatios.reduce((sum, r) => sum + r.ratio, 0) / recentRatios.length : 0,
      sizeDistribution: this.getSizeDistribution(),
      algorithmPerformance: this.getAlgorithmPerformance()
    };
  }

  /**
   * Get payload size distribution
   */
  getSizeDistribution() {
    const distribution = {
      small: 0,
      medium: 0,
      large: 0,
      extraLarge: 0,
      massive: 0
    };

    for (const payload of this.stats.monitoring.payloadSizes) {
      const category = this.getSizeCategory(payload.size);
      distribution[category]++;
    }

    const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      for (const category in distribution) {
        distribution[category] = (distribution[category] / total) * 100;
      }
    }

    return distribution;
  }

  /**
   * Get algorithm performance metrics
   */
  getAlgorithmPerformance() {
    // This would be populated with detailed algorithm performance metrics
    // For now, return placeholder data
    return {
      gzip: { usage: 0, avgRatio: 0, avgTime: 0 },
      deflate: { usage: 0, avgRatio: 0, avgTime: 0 },
      brotli: { usage: 0, avgRatio: 0, avgTime: 0 }
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info('Payload optimization configuration updated', newConfig);
  }

  /**
   * Add custom field name mapping
   */
  addFieldNameMapping(fieldName, shortName) {
    this.fieldNameMap.set(fieldName, shortName);
    this.reverseFieldNameMap.set(shortName, fieldName);
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      compression: {
        total: 0,
        compressed: 0,
        failed: 0,
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        avgCompressionRatio: 0
      },
      optimization: {
        total: 0,
        optimized: 0,
        failed: 0,
        totalOriginalSize: 0,
        totalOptimizedSize: 0,
        avgOptimizationRatio: 0
      },
      monitoring: {
        payloadSizes: [],
        compressionRatios: [],
        largePayloads: 0,
        oversizedPayloads: 0
      }
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    logger.info('Shutting down payload optimization service');
    this.removeAllListeners();
    this.clearStats();
    logger.info('Payload optimization service shutdown complete');
  }
}

// Create singleton instance
const payloadOptimizationService = new PayloadOptimizationService();

module.exports = payloadOptimizationService;