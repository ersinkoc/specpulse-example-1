const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const payloadOptimizationService = require('../services/payloadOptimizationService');

/**
 * Payload Optimized Notifier
 * Provides optimized WebSocket message delivery with compression and size management
 */
class PayloadOptimizedNotifier extends EventEmitter {
  constructor() {
    super();

    this.config = {
      // WebSocket-specific optimization settings
      optimization: {
        enabled: true,
        enableCompression: true,
        compressionThreshold: 1024, // 1KB
        compressionAlgorithm: 'auto',
        enableFieldMapping: false,
        enableMinification: true
      },

      // Size limits for WebSocket frames
      sizeLimits: {
        maxFrameSize: 65536, // 64KB (WebSocket frame limit)
        recommendedSize: 16384, // 16KB (recommended for performance)
        warningThreshold: 49152 // 48KB (warning before limit)
      },

      // Chunking for large messages
      chunking: {
        enabled: true,
        maxChunkSize: 32768, // 32KB
        enableReassembly: true,
        chunkTimeout: 30000 // 30 seconds
      }
    };

    // Track active chunks for reassembly
    this.activeChunks = new Map(); // messageId -> chunks
    this.stats = {
      messages: {
        sent: 0,
        compressed: 0,
        chunked: 0,
        failed: 0,
        totalOriginalSize: 0,
        totalOptimizedSize: 0,
        avgCompressionRatio: 0
      },
      chunks: {
        sent: 0,
        reassembled: 0,
        timedOut: 0,
        failed: 0
      }
    };

    // Start cleanup timer for chunks
    this.startChunkCleanup();
  }

  /**
   * Send optimized message through WebSocket
   */
  async sendOptimizedMessage(socket, message, options = {}) {
    try {
      const config = { ...this.config, ...options };

      // Process the message payload
      const optimizationResult = await payloadOptimizationService.processMessage(message, {
        compression: {
          enabled: config.optimization.enableCompression,
          threshold: config.optimization.compressionThreshold,
          algorithm: config.optimization.compressionAlgorithm
        },
        optimization: {
          enabled: config.optimization.enabled,
          removeNullFields: true,
          removeUndefinedFields: true,
          shortFieldNames: config.optimization.enableFieldMapping,
          minification: {
            enabled: config.optimization.enableMinification,
            removeWhitespace: true,
            removeComments: true
          }
        }
      });

      const optimizedMessage = {
        id: options.messageId || this.generateMessageId(),
        type: options.type || 'notification',
        data: optimizationResult.data,
        metadata: {
          timestamp: Date.now(),
          optimized: true,
          originalSize: optimizationResult.metadata.originalSize,
          compressedSize: optimizationResult.metadata.compressedSize,
          isCompressed: optimizationResult.metadata.isCompressed,
          compressionAlgorithm: optimizationResult.metadata.algorithm,
          compressionRatio: optimizationResult.metadata.compressionRatio,
          // WebSocket-specific metadata
          frameSize: this.calculateFrameSize(optimizationResult.data)
        }
      };

      // Check if message needs chunking
      if (config.chunking.enabled && this.shouldChunkMessage(optimizedMessage, config)) {
        await this.sendChunkedMessage(socket, optimizedMessage, config);
      } else {
        await this.sendSingleMessage(socket, optimizedMessage, config);
      }

      // Update statistics
      this.updateStats(optimizedMessage, config);

      return {
        messageId: optimizedMessage.id,
        success: true,
        originalSize: optimizationResult.metadata.originalSize,
        finalSize: optimizedMessage.metadata.compressedSize,
        wasCompressed: optimizationResult.metadata.isCompressed,
        wasChunked: config.chunking.enabled && this.shouldChunkMessage(optimizedMessage, config)
      };

    } catch (error) {
      logger.error('Failed to send optimized message:', error);
      this.stats.messages.failed++;
      throw error;
    }
  }

  /**
   * Send single message without chunking
   */
  async sendSingleMessage(socket, message, config) {
    try {
      const frameSize = message.metadata.frameSize;

      // Check frame size limits
      if (frameSize > config.sizeLimits.maxFrameSize) {
        throw new Error(`Message frame size ${frameSize} exceeds WebSocket limit ${config.sizeLimits.maxFrameSize}`);
      }

      // Warning for large frames
      if (frameSize > config.sizeLimits.warningThreshold) {
        logger.warn(`Large WebSocket frame detected: ${frameSize} bytes`);
        this.emit('frame:large', { messageId: message.id, size: frameSize });
      }

      // Send the message
      const serializedMessage = JSON.stringify(message);
      socket.send(serializedMessage);

      logger.debug(`Optimized message sent`, {
        messageId: message.id,
        frameSize,
        wasCompressed: message.metadata.isCompressed
      });

      this.emit('message:sent', { messageId: message.id, message });

    } catch (error) {
      logger.error('Failed to send single message:', error);
      throw error;
    }
  }

  /**
   * Send chunked message for large payloads
   */
  async sendChunkedMessage(socket, message, config) {
    try {
      const messageId = message.id;
      const chunkSize = config.chunking.maxChunkSize;

      // Serialize message data for chunking
      const messageData = JSON.stringify(message.data);
      const totalChunks = Math.ceil(messageData.length / chunkSize);

      // Create chunked message structure
      const chunkedMessage = {
        id: messageId,
        type: 'chunked',
        metadata: {
          ...message.metadata,
          chunked: true,
          totalChunks,
          chunkSize,
          originalDataSize: messageData.length
        }
      };

      // Send chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, messageData.length);
        const chunkData = messageData.substring(start, end);

        const chunk = {
          messageId,
          chunkIndex: i,
          totalChunks,
          data: chunkData,
          checksum: this.calculateChecksum(chunkData),
          timestamp: Date.now()
        };

        const chunkMessage = {
          ...chunkedMessage,
          chunk,
          isLastChunk: i === totalChunks - 1
        };

        socket.send(JSON.stringify(chunkMessage));
        this.stats.chunks.sent++;

        // Small delay between chunks to prevent overwhelming the client
        if (i < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }

      logger.debug(`Chunked message sent`, {
        messageId,
        totalChunks,
        totalSize: messageData.length
      });

      this.stats.messages.chunked++;
      this.emit('message:chunked', { messageId, totalChunks, totalSize: messageData.length });

    } catch (error) {
      logger.error('Failed to send chunked message:', error);
      throw error;
    }
  }

  /**
   * Handle incoming chunked message
   */
  async handleChunkedMessage(chunkMessage, callback) {
    try {
      const { messageId, chunk, totalChunks, metadata } = chunkMessage;

      // Initialize chunk storage for this message
      if (!this.activeChunks.has(messageId)) {
        this.activeChunks.set(messageId, {
          chunks: new Array(totalChunks),
          received: 0,
          totalChunks,
          metadata,
          createdAt: Date.now()
        });
      }

      const messageChunks = this.activeChunks.get(messageId);

      // Store the chunk
      messageChunks.chunks[chunk.chunkIndex] = chunk;
      messageChunks.received++;

      // Verify chunk checksum
      if (this.calculateChecksum(chunk.data) !== chunk.checksum) {
        throw new Error(`Chunk checksum mismatch for message ${messageId}, chunk ${chunk.chunkIndex}`);
      }

      // Check if all chunks are received
      if (messageChunks.received === totalChunks) {
        await this.reassembleMessage(messageId, callback);
      }

    } catch (error) {
      logger.error('Failed to handle chunked message:', error);
      this.stats.chunks.failed++;
      this.activeChunks.delete(chunkMessage.messageId);
      throw error;
    }
  }

  /**
   * Reassemble chunks into complete message
   */
  async reassembleMessage(messageId, callback) {
    try {
      const messageChunks = this.activeChunks.get(messageId);
      if (!messageChunks) {
        throw new Error(`No chunks found for message ${messageId}`);
      }

      // Combine all chunk data
      const combinedData = messageChunks.chunks
        .map(chunk => chunk.data)
        .join('');

      // Parse the reassembled data
      let reassembledData;
      try {
        reassembledData = JSON.parse(combinedData);
      } catch (parseError) {
        throw new Error(`Failed to parse reassembled message data: ${parseError.message}`);
      }

      // Create the complete message
      const completeMessage = {
        id: messageId,
        type: 'reassembled',
        data: reassembledData,
        metadata: {
          ...messageChunks.metadata,
          reassembled: true,
          reassembledAt: Date.now(),
          originalDataSize: combinedData.length
        }
      };

      // Clean up chunks
      this.activeChunks.delete(messageId);
      this.stats.chunks.reassembled++;

      // Emit the reassembled message
      this.emit('message:reassembled', { messageId, message: completeMessage });

      // Call the callback if provided
      if (callback) {
        callback(null, completeMessage);
      }

      logger.debug(`Message reassembled successfully`, {
        messageId,
        totalSize: combinedData.length,
        chunkCount: messageChunks.totalChunks
      });

      return completeMessage;

    } catch (error) {
      logger.error('Failed to reassemble message:', error);
      this.stats.chunks.failed++;
      this.activeChunks.delete(messageId);
      throw error;
    }
  }

  /**
   * Determine if message should be chunked
   */
  shouldChunkMessage(message, config) {
    const frameSize = message.metadata.frameSize;
    return frameSize > config.sizeLimits.recommendedSize;
  }

  /**
   * Calculate WebSocket frame size
   */
  calculateFrameSize(data) {
    try {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      return Buffer.byteLength(serialized, 'utf8');
    } catch (error) {
      logger.error('Failed to calculate frame size:', error);
      return 0;
    }
  }

  /**
   * Calculate simple checksum for chunk validation
   */
  calculateChecksum(data) {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update optimization statistics
   */
  updateStats(message, config) {
    this.stats.messages.sent++;

    if (message.metadata.isCompressed) {
      this.stats.messages.compressed++;
      this.stats.messages.totalOriginalSize += message.metadata.originalSize;
      this.stats.messages.totalOptimizedSize += message.metadata.compressedSize;

      // Calculate average compression ratio
      if (this.stats.messages.compressed > 0) {
        this.stats.messages.avgCompressionRatio =
          1 - (this.stats.messages.totalOptimizedSize / this.stats.messages.totalOriginalSize);
      }
    }
  }

  /**
   * Start cleanup timer for orphaned chunks
   */
  startChunkCleanup() {
    setInterval(() => {
      this.cleanupExpiredChunks();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Clean up expired chunks
   */
  cleanupExpiredChunks() {
    const now = Date.now();
    const timeout = this.config.chunking.chunkTimeout;
    const expiredMessages = [];

    for (const [messageId, messageChunks] of this.activeChunks) {
      if (now - messageChunks.createdAt > timeout) {
        expiredMessages.push(messageId);
      }
    }

    for (const messageId of expiredMessages) {
      this.activeChunks.delete(messageId);
      this.stats.chunks.timedOut++;
      logger.debug(`Chunked message timed out: ${messageId}`);
    }

    if (expiredMessages.length > 0) {
      logger.debug(`Cleaned up ${expiredMessages.length} expired chunked messages`);
    }
  }

  /**
   * Get optimization statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeChunks: this.activeChunks.size,
      config: this.config,
      timestamp: Date.now()
    };
  }

  /**
   * Get compression performance metrics
   */
  getCompressionMetrics() {
    return {
      messagesProcessed: this.stats.messages.sent,
      messagesCompressed: this.stats.messages.compressed,
      compressionRate: this.stats.messages.sent > 0 ?
        this.stats.messages.compressed / this.stats.messages.sent : 0,
      averageCompressionRatio: this.stats.messages.avgCompressionRatio,
      totalBytesSaved: this.stats.messages.totalOriginalSize - this.stats.messages.totalOptimizedSize,
      messagesChunked: this.stats.messages.chunked,
      chunksProcessed: this.stats.chunks.sent,
      chunkReassemblyRate: this.stats.chunks.sent > 0 ?
        this.stats.chunks.reassembled / this.stats.chunks.sent : 0
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info('Payload optimized notifier configuration updated', newConfig);
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      messages: {
        sent: 0,
        compressed: 0,
        chunked: 0,
        failed: 0,
        totalOriginalSize: 0,
        totalOptimizedSize: 0,
        avgCompressionRatio: 0
      },
      chunks: {
        sent: 0,
        reassembled: 0,
        timedOut: 0,
        failed: 0
      }
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    logger.info('Shutting down payload optimized notifier');
    this.removeAllListeners();
    this.activeChunks.clear();
    this.clearStats();
    logger.info('Payload optimized notifier shutdown complete');
  }
}

// Create singleton instance
const payloadOptimizedNotifier = new PayloadOptimizedNotifier();

module.exports = payloadOptimizedNotifier;