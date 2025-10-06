/**
 * Evidence Collection Engine
 * Automated evidence collection for compliance audits and assessments
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const winston = require('winston');
const { QueryBuilder } = require('../database/QueryBuilder');

class EvidenceCollector extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      storagePath: config.storagePath || 'evidence/compliance',
      autoCollection: config.autoCollection !== false,
      collectionInterval: config.collectionInterval || 86400000, // 24 hours
      encryptionEnabled: config.encryptionEnabled !== false,
      compressionEnabled: config.compressionEnabled !== false,
      retentionDays: config.retentionDays || 2555, // 7 years
      evidenceTypes: config.evidenceTypes || [
        'system_logs',
        'access_logs',
        'security_scans',
        'configuration_snapshots',
        'policy_documents',
        'training_records',
        'audit_reports',
        'incident_reports',
        'risk_assessments',
        'control_tests'
      ],
      sources: config.sources || {},
      hashAlgorithm: config.hashAlgorithm || 'sha256',
      ...config
    };

    // Initialize database query builder
    this.queryBuilder = new QueryBuilder();

    // Evidence collection status
    this.collectionStatus = {
      lastCollection: null,
      totalCollected: 0,
      failedCollections: 0,
      activeCollections: new Map()
    };

    // Evidence processors
    this.processors = new Map();

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
          filename: 'logs/evidence-collector.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize evidence collector
   */
  async initialize() {
    try {
      // Initialize evidence storage
      await this.initializeStorage();

      // Initialize database schema
      await this.initializeEvidenceSchema();

      // Initialize evidence processors
      await this.initializeProcessors();

      // Start automated collection if enabled
      if (this.config.autoCollection) {
        this.startAutomatedCollection();
      }

      this.logger.info('Evidence collector initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize evidence collector:', error);
      throw error;
    }
  }

  /**
   * Initialize evidence storage
   */
  async initializeStorage() {
    try {
      // Create evidence storage directories
      const directories = [
        this.config.storagePath,
        path.join(this.config.storagePath, 'raw'),
        path.join(this.config.storagePath, 'processed'),
        path.join(this.config.storagePath, 'encrypted'),
        path.join(this.config.storagePath, 'temp')
      ];

      for (const directory of directories) {
        await fs.mkdir(directory, { recursive: true });
      }

      this.logger.info('Evidence storage initialized');

    } catch (error) {
      this.logger.error('Failed to initialize evidence storage:', error);
      throw error;
    }
  }

  /**
   * Initialize evidence database schema
   */
  async initializeEvidenceSchema() {
    try {
      const schema = `
        CREATE TABLE IF NOT EXISTS evidence_collection (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          evidence_id VARCHAR(100) UNIQUE NOT NULL,
          collection_id VARCHAR(100) NOT NULL,
          evidence_type VARCHAR(100) NOT NULL,
          source_system VARCHAR(255) NOT NULL,
          description TEXT,
          file_path VARCHAR(500),
          file_hash VARCHAR(128),
          file_size BIGINT,
          collection_date TIMESTAMP NOT NULL,
          period_start TIMESTAMP NOT NULL,
          period_end TIMESTAMP NOT NULL,
          status VARCHAR(50) NOT NULL,
          metadata JSONB,
          retention_until TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS evidence_collections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          collection_id VARCHAR(100) UNIQUE NOT NULL,
          collection_type VARCHAR(100) NOT NULL,
          started_at TIMESTAMP NOT NULL,
          completed_at TIMESTAMP,
          status VARCHAR(50) NOT NULL,
          total_evidence INTEGER DEFAULT 0,
          successful_evidence INTEGER DEFAULT 0,
          failed_evidence INTEGER DEFAULT 0,
          initiated_by VARCHAR(255),
          collection_parameters JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS evidence_sources (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_name VARCHAR(255) UNIQUE NOT NULL,
          source_type VARCHAR(100) NOT NULL,
          connection_details JSONB,
          collection_frequency INTEGER,
          evidence_types TEXT[],
          enabled BOOLEAN DEFAULT true,
          last_collection TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS evidence_retention (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          evidence_id VARCHAR(100) NOT NULL,
          retention_policy VARCHAR(100) NOT NULL,
          retention_period INTEGER NOT NULL,
          retention_until TIMESTAMP NOT NULL,
          auto_delete BOOLEAN DEFAULT true,
          notification_sent BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await this.queryBuilder.execute(schema);

      this.logger.info('Evidence database schema initialized');

    } catch (error) {
      this.logger.error('Failed to initialize evidence schema:', error);
      throw error;
    }
  }

  /**
   * Initialize evidence processors
   */
  async initializeProcessors() {
    try {
      // Initialize built-in processors
      this.processors.set('system_logs', new SystemLogsProcessor());
      this.processors.set('access_logs', new AccessLogsProcessor());
      this.processors.set('security_scans', new SecurityScansProcessor());
      this.processors.set('configuration_snapshots', new ConfigSnapshotsProcessor());
      this.processors.set('policy_documents', new PolicyDocumentsProcessor());
      this.processors.set('training_records', new TrainingRecordsProcessor());
      this.processors.set('audit_reports', new AuditReportsProcessor());
      this.processors.set('incident_reports', new IncidentReportsProcessor());
      this.processors.set('risk_assessments', new RiskAssessmentsProcessor());
      this.processors.set('control_tests', new ControlTestsProcessor());

      this.logger.info('Evidence processors initialized');

    } catch (error) {
      this.logger.error('Failed to initialize evidence processors:', error);
      throw error;
    }
  }

  /**
   * Start evidence collection
   */
  async startCollection(collectionConfig = {}) {
    try {
      const collectionId = this.generateCollectionId();
      const startTime = new Date();

      const collection = {
        collectionId,
        type: collectionConfig.type || 'automated',
        startTime,
        status: 'in_progress',
        evidence: [],
        errors: []
      };

      // Record collection start
      await this.recordCollectionStart(collectionId, collectionConfig);

      this.collectionStatus.activeCollections.set(collectionId, collection);

      // Determine evidence types to collect
      const evidenceTypes = collectionConfig.evidenceTypes || this.config.evidenceTypes;

      // Collect evidence for each type
      for (const evidenceType of evidenceTypes) {
        try {
          const evidence = await this.collectEvidenceType(evidenceType, collectionConfig);
          collection.evidence.push(evidence);
        } catch (error) {
          this.logger.error(`Failed to collect evidence type ${evidenceType}:`, error);
          collection.errors.push({
            type: evidenceType,
            error: error.message,
            timestamp: new Date()
          });
        }
      }

      // Update collection status
      collection.status = collection.errors.length === 0 ? 'completed' : 'completed_with_errors';
      collection.endTime = new Date();

      // Record collection completion
      await this.recordCollectionCompletion(collectionId, collection);

      this.collectionStatus.activeCollections.delete(collectionId);
      this.collectionStatus.lastCollection = collection.endTime;
      this.collectionStatus.totalCollected += collection.evidence.length;

      // Emit collection completed event
      this.emit('collectionCompleted', collection);

      this.logger.info(`Evidence collection ${collectionId} completed: ${collection.evidence.length} items collected`);

      return collection;

    } catch (error) {
      this.logger.error('Failed to start evidence collection:', error);
      throw error;
    }
  }

  /**
   * Collect evidence for specific type
   */
  async collectEvidenceType(evidenceType, collectionConfig) {
    try {
      const processor = this.processors.get(evidenceType);
      if (!processor) {
        throw new Error(`No processor found for evidence type: ${evidenceType}`);
      }

      // Use processor to collect evidence
      const evidenceData = await processor.collect(collectionConfig);

      // Process and store evidence
      const processedEvidence = [];
      for (const evidenceItem of evidenceData) {
        const stored = await this.storeEvidence(evidenceItem, evidenceType, collectionConfig);
        processedEvidence.push(stored);
      }

      return {
        type: evidenceType,
        count: processedEvidence.length,
        evidence: processedEvidence
      };

    } catch (error) {
      this.logger.error(`Failed to collect evidence type ${evidenceType}:`, error);
      throw error;
    }
  }

  /**
   * Store evidence item
   */
  async storeEvidence(evidenceItem, evidenceType, collectionConfig) {
    try {
      const evidenceId = this.generateEvidenceId();
      const timestamp = new Date();

      // Determine file path
      const fileName = `${evidenceId}_${evidenceType}.${this.getFileExtension(evidenceItem.format)}`;
      const filePath = path.join(this.config.storagePath, 'raw', fileName);

      // Save evidence to file
      if (evidenceItem.content) {
        await fs.writeFile(filePath, evidenceItem.content);
      }

      // Calculate file hash
      const fileHash = await this.calculateFileHash(filePath);

      // Encrypt if enabled
      let encryptedPath = null;
      if (this.config.encryptionEnabled && evidenceItem.confidential) {
        encryptedPath = await this.encryptEvidence(filePath);
      }

      // Compress if enabled
      let compressedPath = null;
      if (this.config.compressionEnabled) {
        compressedPath = await this.compressEvidence(filePath);
      }

      // Record evidence in database
      const evidenceRecord = {
        evidenceId,
        collectionId: collectionConfig.collectionId || 'manual',
        evidenceType,
        sourceSystem: evidenceItem.source || 'unknown',
        description: evidenceItem.description || `${evidenceType} evidence`,
        filePath: filePath,
        fileHash,
        fileSize: evidenceItem.size || 0,
        collectionDate: timestamp,
        periodStart: collectionConfig.periodStart || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        periodEnd: collectionConfig.periodEnd || timestamp,
        status: 'collected',
        metadata: {
          format: evidenceItem.format,
          confidential: evidenceItem.confidential || false,
          encryptedPath,
          compressedPath,
          ...evidenceItem.metadata
        },
        retentionUntil: new Date(Date.now() + this.config.retentionDays * 24 * 60 * 60 * 1000)
      };

      await this.saveEvidenceRecord(evidenceRecord);

      return {
        evidenceId,
        type: evidenceType,
        source: evidenceItem.source,
        filePath,
        fileHash,
        size: evidenceItem.size || 0,
        timestamp,
        status: 'stored'
      };

    } catch (error) {
      this.logger.error('Failed to store evidence:', error);
      throw error;
    }
  }

  /**
   * Save evidence record to database
   */
  async saveEvidenceRecord(evidenceRecord) {
    try {
      const query = this.queryBuilder
        .insert('evidence_collection')
        .values(evidenceRecord);

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to save evidence record:', error);
      throw error;
    }
  }

  /**
   * Record collection start
   */
  async recordCollectionStart(collectionId, config) {
    try {
      const query = this.queryBuilder
        .insert('evidence_collections')
        .values({
          collection_id: collectionId,
          collection_type: config.type || 'automated',
          started_at: new Date(),
          status: 'in_progress',
          initiated_by: config.initiatedBy || 'system',
          collection_parameters: config
        });

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to record collection start:', error);
    }
  }

  /**
   * Record collection completion
   */
  async recordCollectionCompletion(collectionId, collection) {
    try {
      const query = this.queryBuilder
        .update('evidence_collections')
        .set({
          completed_at: collection.endTime,
          status: collection.status,
          total_evidence: collection.evidence.length,
          successful_evidence: collection.evidence.reduce((sum, e) => sum + e.count, 0),
          failed_evidence: collection.errors.length
        })
        .where('collection_id', '=', collectionId);

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to record collection completion:', error);
    }
  }

  /**
   * Retrieve evidence by criteria
   */
  async retrieveEvidence(criteria = {}) {
    try {
      let query = this.queryBuilder
        .select('*')
        .from('evidence_collection')
        .where('retention_until', '>', new Date());

      // Apply filters
      if (criteria.evidenceType) {
        query = query.where('evidence_type', '=', criteria.evidenceType);
      }
      if (criteria.sourceSystem) {
        query = query.where('source_system', '=', criteria.sourceSystem);
      }
      if (criteria.periodStart) {
        query = query.where('collection_date', '>=', criteria.periodStart);
      }
      if (criteria.periodEnd) {
        query = query.where('collection_date', '<=', criteria.periodEnd);
      }
      if (criteria.status) {
        query = query.where('status', '=', criteria.status);
      }

      // Apply ordering and limits
      query = query.orderBy('collection_date', 'DESC');
      if (criteria.limit) {
        query = query.limit(criteria.limit);
      }

      const results = await this.queryBuilder.execute(query);

      // Load file content if requested
      if (criteria.includeContent) {
        for (const record of results) {
          if (record.file_path) {
            try {
              record.content = await fs.readFile(record.file_path);
            } catch (error) {
              this.logger.warn(`Failed to read evidence file ${record.file_path}:`, error);
              record.content = null;
            }
          }
        }
      }

      return results;

    } catch (error) {
      this.logger.error('Failed to retrieve evidence:', error);
      throw error;
    }
  }

  /**
   * Get evidence summary
   */
  async getEvidenceSummary() {
    try {
      const query = this.queryBuilder
        .select('evidence_type', 'COUNT(*) as count', 'SUM(file_size) as total_size')
        .from('evidence_collection')
        .where('retention_until', '>', new Date())
        .groupBy('evidence_type');

      const results = await this.queryBuilder.execute(query);

      const summary = {
        totalItems: 0,
        totalSize: 0,
        byType: {},
        bySource: {},
        recentActivity: []
      };

      for (const row of results) {
        const count = parseInt(row.count);
        const size = parseInt(row.total_size) || 0;

        summary.totalItems += count;
        summary.totalSize += size;
        summary.byType[row.evidence_type] = { count, size };
      }

      // Get source breakdown
      const sourceQuery = this.queryBuilder
        .select('source_system', 'COUNT(*) as count')
        .from('evidence_collection')
        .where('retention_until', '>', new Date())
        .groupBy('source_system');

      const sourceResults = await this.queryBuilder.execute(sourceQuery);
      for (const row of sourceResults) {
        summary.bySource[row.source_system] = parseInt(row.count);
      }

      // Get recent activity
      const recentQuery = this.queryBuilder
        .select('evidence_type', 'collection_date', 'status')
        .from('evidence_collection')
        .where('collection_date', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .orderBy('collection_date', 'DESC')
        .limit(10);

      summary.recentActivity = await this.queryBuilder.execute(recentQuery);

      return summary;

    } catch (error) {
      this.logger.error('Failed to get evidence summary:', error);
      return { totalItems: 0, totalSize: 0, byType: {}, bySource: {}, recentActivity: [] };
    }
  }

  /**
   * Start automated collection
   */
  startAutomatedCollection() {
    setInterval(async () => {
      try {
        await this.startCollection({
          type: 'automated_scheduled',
          initiatedBy: 'system',
          periodStart: new Date(Date.now() - this.config.collectionInterval),
          periodEnd: new Date()
        });
      } catch (error) {
        this.logger.error('Automated evidence collection failed:', error);
      }
    }, this.config.collectionInterval);
  }

  /**
   * Clean up expired evidence
   */
  async cleanupExpiredEvidence() {
    try {
      const query = this.queryBuilder
        .select('*')
        .from('evidence_collection')
        .where('retention_until', '<=', new Date());

      const expiredEvidence = await this.queryBuilder.execute(query);

      for (const evidence of expiredEvidence) {
        try {
          // Delete file
          if (evidence.file_path) {
            await fs.unlink(evidence.file_path);
          }

          // Delete encrypted file if exists
          if (evidence.metadata?.encryptedPath) {
            await fs.unlink(evidence.metadata.encryptedPath);
          }

          // Delete compressed file if exists
          if (evidence.metadata?.compressedPath) {
            await fs.unlink(evidence.metadata.compressedPath);
          }

          // Delete database record
          await this.queryBuilder
            .delete('evidence_collection')
            .where('evidence_id', '=', evidence.evidence_id);

        } catch (error) {
          this.logger.error(`Failed to delete evidence ${evidence.evidence_id}:`, error);
        }
      }

      this.logger.info(`Cleaned up ${expiredEvidence.length} expired evidence items`);

    } catch (error) {
      this.logger.error('Failed to cleanup expired evidence:', error);
    }
  }

  /**
   * Calculate file hash
   */
  async calculateFileHash(filePath) {
    try {
      const content = await fs.readFile(filePath);
      return crypto.createHash(this.config.hashAlgorithm).update(content).digest('hex');
    } catch (error) {
      this.logger.error(`Failed to calculate hash for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Encrypt evidence file
   */
  async encryptEvidence(filePath) {
    try {
      // Placeholder for encryption implementation
      const encryptedPath = filePath + '.encrypted';
      const content = await fs.readFile(filePath);
      const encrypted = content; // Implement actual encryption
      await fs.writeFile(encryptedPath, encrypted);
      return encryptedPath;
    } catch (error) {
      this.logger.error(`Failed to encrypt evidence ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Compress evidence file
   */
  async compressEvidence(filePath) {
    try {
      // Placeholder for compression implementation
      const compressedPath = filePath + '.compressed';
      const content = await fs.readFile(filePath);
      const compressed = content; // Implement actual compression
      await fs.writeFile(compressedPath, compressed);
      return compressedPath;
    } catch (error) {
      this.logger.error(`Failed to compress evidence ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Get file extension for format
   */
  getFileExtension(format) {
    const extensions = {
      'json': 'json',
      'csv': 'csv',
      'txt': 'txt',
      'log': 'log',
      'pdf': 'pdf',
      'xml': 'xml'
    };
    return extensions[format] || 'txt';
  }

  /**
   * Generate unique IDs
   */
  generateCollectionId() {
    return `collection-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  generateEvidenceId() {
    return `evidence-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Get collection statistics
   */
  getStatistics() {
    return {
      ...this.collectionStatus,
      storagePath: this.config.storagePath,
      autoCollection: this.config.autoCollection,
      collectionInterval: this.config.collectionInterval,
      retentionDays: this.config.retentionDays,
      evidenceTypes: this.config.evidenceTypes,
      processorsCount: this.processors.size
    };
  }
}

// Evidence Processor Base Class
class EvidenceProcessor {
  constructor() {
    this.name = this.constructor.name;
  }

  async collect(config) {
    throw new Error('collect method must be implemented by subclass');
  }
}

// System Logs Processor
class SystemLogsProcessor extends EvidenceProcessor {
  async collect(config) {
    // Placeholder implementation
    return [{
      source: 'system',
      format: 'log',
      content: 'Sample system log content',
      description: 'System logs for compliance evidence',
      confidential: false,
      size: 1024,
      metadata: { logLevel: 'info', timestamp: new Date() }
    }];
  }
}

// Access Logs Processor
class AccessLogsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'access_control',
      format: 'json',
      content: JSON.stringify({ access_events: [] }),
      description: 'Access control logs',
      confidential: true,
      size: 2048,
      metadata: { eventType: 'access', period: 'daily' }
    }];
  }
}

// Security Scans Processor
class SecurityScansProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'security_scanner',
      format: 'json',
      content: JSON.stringify({ scan_results: [] }),
      description: 'Security vulnerability scan results',
      confidential: true,
      size: 5120,
      metadata: { scanType: 'vulnerability', scanner: 'OWASP' }
    }];
  }
}

// Configuration Snapshots Processor
class ConfigSnapshotsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'configuration',
      format: 'json',
      content: JSON.stringify({ configuration: {} }),
      description: 'System configuration snapshot',
      confidential: true,
      size: 3072,
      metadata: { configType: 'security', environment: 'production' }
    }];
  }
}

// Policy Documents Processor
class PolicyDocumentsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'policy_management',
      format: 'pdf',
      content: 'Policy document content',
      description: 'Security policy documents',
      confidential: false,
      size: 10240,
      metadata: { policyType: 'security', version: '1.0' }
    }];
  }
}

// Training Records Processor
class TrainingRecordsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'training_system',
      format: 'csv',
      content: 'Training records data',
      description: 'Security training completion records',
      confidential: true,
      size: 2048,
      metadata: { trainingType: 'security', period: 'monthly' }
    }];
  }
}

// Audit Reports Processor
class AuditReportsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'audit_system',
      format: 'pdf',
      content: 'Audit report content',
      description: 'Internal audit reports',
      confidential: true,
      size: 15360,
      metadata: { auditType: 'compliance', scope: 'full' }
    }];
  }
}

// Incident Reports Processor
class IncidentReportsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'incident_management',
      format: 'json',
      content: JSON.stringify({ incidents: [] }),
      description: 'Security incident reports',
      confidential: true,
      size: 4096,
      metadata: { incidentType: 'security', severity: 'all' }
    }];
  }
}

// Risk Assessments Processor
class RiskAssessmentsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'risk_management',
      format: 'xlsx',
      content: 'Risk assessment data',
      description: 'Risk assessment reports',
      confidential: true,
      size: 8192,
      metadata: { assessmentType: 'security', methodology: 'FAIR' }
    }];
  }
}

// Control Tests Processor
class ControlTestsProcessor extends EvidenceProcessor {
  async collect(config) {
    return [{
      source: 'control_testing',
      format: 'json',
      content: JSON.stringify({ control_tests: [] }),
      description: 'Security control test results',
      confidential: true,
      size: 6144,
      metadata: { controlFramework: 'SOC2', testType: 'automated' }
    }];
  }
}

module.exports = EvidenceCollector;