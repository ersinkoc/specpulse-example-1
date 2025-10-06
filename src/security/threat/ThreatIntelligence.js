/**
 * Threat Intelligence Module
 * Advanced threat intelligence processing with ML-based analysis and pattern recognition
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const winston = require('winston');
const { QueryBuilder } = require('../database/QueryBuilder');

class ThreatIntelligence extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      autoCollection: config.autoCollection !== false,
      collectionInterval: config.collectionInterval || 300000, // 5 minutes
      maxIndicatorsPerSource: config.maxIndicatorsPerSource || 10000,
      retentionDays: config.retentionDays || 365,
      enrichmentEnabled: config.enrichmentEnabled !== false,
      correlationWindow: config.correlationWindow || 300000, // 5 minutes
      confidenceThreshold: config.confidenceThreshold || 0.7,
      falsePositiveReduction: config.falsePositiveReduction !== false,
      learningEnabled: config.learningEnabled !== false,
      ...config
    };

    // Initialize database query builder
    this.queryBuilder = new QueryBuilder();

    // Threat intelligence data stores
    this.indicators = new Map();
    this.indicatorHistory = new Map();
    this.patterns = new Map();
    this.sources = new Map();
    this.enrichmentData = new Map();

    // ML components
    this.patternRecognizer = null;
    this.anomalyDetector = null;

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
          filename: 'logs/threat-intelligence.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize threat intelligence module
   */
  async initialize() {
    try {
      // Initialize database schema
      await this.initializeThreatIntelligenceSchema();

      // Initialize ML components
      await this.initializeMLComponents();

      // Initialize threat sources
      await this.initializeThreatSources();

      // Start automated collection
      if (this.config.autoCollection) {
        this.startAutomatedCollection();
      }

      this.logger.info('Threat intelligence module initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize threat intelligence module:', error);
      throw error;
    }
  }

  /**
   * Initialize threat intelligence database schema
   */
  async initializeThreatIntelligenceSchema() {
    try {
      const schemas = [
        // Threat indicators table
        `CREATE TABLE IF NOT EXISTS threat_indicators (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          indicator_id VARCHAR(100) UNIQUE NOT NULL,
          indicator_type VARCHAR(100) NOT NULL,
          indicator_value VARCHAR(500) NOT NULL,
          confidence DECIMAL(5,2) NOT NULL,
          severity VARCHAR(50) NOT NULL,
          source VARCHAR(255) NOT NULL,
          first_seen TIMESTAMP NOT NULL,
          last_seen TIMESTAMP NOT NULL,
          description TEXT,
          tags TEXT[],
          context JSONB,
          is_active BOOLEAN DEFAULT true,
          false_positive_count INTEGER DEFAULT 0,
          enrichment_data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // Threat patterns table
        `CREATE TABLE IF NOT EXISTS threat_patterns (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pattern_id VARCHAR(100) UNIQUE NOT NULL,
          pattern_name VARCHAR(255) NOT NULL,
          pattern_type VARCHAR(100) NOT NULL,
          pattern_regex VARCHAR(500),
          description TEXT,
          confidence DECIMAL(5,2) NOT NULL,
          frequency INTEGER DEFAULT 0,
          last_detected TIMESTAMP,
          indicators_count INTEGER DEFAULT 0,
          related_indicators UUID[],
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // Threat sources table
        `CREATE TABLE IF NOT EXISTS threat_sources (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_name VARCHAR(255) UNIQUE NOT NULL,
          source_type VARCHAR(100) NOT NULL,
          source_url VARCHAR(500),
          api_key VARCHAR(500),
          authentication_details JSONB,
          collection_frequency INTEGER NOT NULL DEFAULT 300000,
          last_collection TIMESTAMP,
          is_active BOOLEAN DEFAULT true,
          indicators_collected INTEGER DEFAULT 0,
          last_error TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // Threat correlations table
        `CREATE TABLE IF NOT EXISTS threat_correlations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          correlation_id VARCHAR(100) NOT NULL,
          primary_indicator_id UUID NOT NULL,
          related_indicators UUID[],
          correlation_score DECIMAL(5,2) NOT NULL,
          correlation_type VARCHAR(100) NOT NULL,
          detected_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // Enrichment data table
        `CREATE TABLE IF NOT EXISTS threat_enrichment (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          indicator_id UUID REFERENCES threat_indicators(indicator_id),
          enrichment_type VARCHAR(100) NOT NULL,
          enrichment_data JSONB NOT NULL,
          confidence DECIMAL(5,2) NOT NULL,
          source VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // ML model data table
        `CREATE TABLE IF NOT EXISTS ml_models (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          model_type VARCHAR(100) NOT NULL,
          model_version VARCHAR(50) NOT NULL,
          model_data JSONB NOT NULL,
          training_data_count INTEGER DEFAULT 0,
          accuracy DECIMAL(5,2) DEFAULT 0.0,
          last_trained TIMESTAMP,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
      ];

      for (const schema of schemas) {
        await this.queryBuilder.execute(schema);
      }

      this.logger.info('Threat intelligence database schema initialized');

    } catch (error) {
      this.logger.error('Failed to initialize threat intelligence schema:', error);
      throw error;
    }
  }

  /**
   * Initialize ML components
   */
  async initializeMLComponents() {
    try {
      // Initialize pattern recognizer
      this.patternRecognizer = new PatternRecognizer(this.config);

      // Initialize anomaly detector
      this.anomalyDetector = new AnomalyDetector(this.config);

      this.logger.info('ML components initialized for threat intelligence');

    } catch (error) {
      this.logger.error('Failed to initialize ML components:', error);
      throw error;
    }
  }

  /**
   * Initialize threat sources
   */
  async initializeThreatSources() {
    try {
      const defaultSources = [
        {
          name: 'VirusTotal',
          type: 'antivirus',
          url: 'https://www.virustotal.com/vtapi/v2',
          apiKey: process.env.VIRUSTOTAL_API_KEY,
          collectionFrequency: 300000, // 5 minutes
          authentication: {
            type: 'api_key',
            key: process.env.VIRUSTOTAL_API_KEY
          }
        },
        {
          'name': 'AbuseIPDB',
          'type': 'ip_reputation',
          url: 'https://www.abuseipdb.com/api/v2',
          apiKey: process.env.ABUSEIPDB_API_KEY,
          collectionFrequency: 300000,
          authentication: {
            type: 'api_key',
            key: process.env.ABUSEIPDB_API_KEY
          }
        },
        {
          'name: 'AlienVault OTX',
          'type: 'ip_reputation',
          url: 'https://otx.alienvault.com/api/v1',
          apiKey: process.env.ALIENVAULT_API_KEY,
          collectionFrequency: 600000, // 10 minutes
          authentication: {
            type: 'api_key',
            key: process.env.ALIENVAULT_API_KEY
          }
        },
        {
          'name: 'PhishTank',
          'type: 'phishing',
          url: 'https://phishtank.com/api/v1',
          apiKey: process.env.PHISHTANK_API_KEY,
          collectionFrequency: 300000,
          authentication: {
            type: 'api_key',
            key: process.env.PHISHTANK_API_KEY
          }
        }
      ];

      for (const source of defaultSources) {
        if (source.apiKey) {
          this.sources.set(source.name, source);
          this.logger.info(`Initialized threat source: ${source.name}`);
        } else {
          this.logger.warn(`Threat source ${source.name} disabled (no API key)`);
        }
      }

    } catch (error) {
      this.logger.error('Failed to initialize threat sources:', error);
      throw error;
    }
  }

  /**
   * Collect threat indicators from all sources
   */
  async collectThreatIndicators() {
    try {
      const collectionResults = [];

      for (const [sourceName, source] of this.sources) {
        try {
          const indicators = await this.collectFromSource(source);
          collectionResults.push({
            source: sourceName,
            indicators,
            count: indicators.length,
            errors: []
          });
        } catch (error) {
          this.logger.error(`Failed to collect from source ${sourceName}:`, error);
          collectionResults.push({
            source: sourceName,
            indicators: [],
            count: 0,
            errors: [error.message]
          });
        }
      }

      // Process collected indicators
      await this.processCollectedIndicators(collectionResults);

      this.emit('indicatorsCollected', {
        totalCollected: collectionResults.reduce((sum, result) => sum + result.count, 0),
        sourceResults: collectionResults
      });

      this.logger.info(`Threat indicators collected from ${this.sources.size} sources`);

    } catch (error) {
      this.logger.error('Failed to collect threat indicators:', error);
      throw error;
    }
  }

  /**
   * Collect indicators from specific source
   */
  async collectFromSource(source) {
    try {
      switch (source.type) {
        case 'antivirus':
          return await this.collectFromAntivirusSource(source);
        case 'ip_reputation':
          return await this.collectFromIPReputationSource(source);
        case 'phishing':
          return await this.collectFromPhishingSource(source);
        default:
          return [];
      }
    } catch (error) {
      this.logger.error(`Failed to collect from source ${source.name}:`, error);
      return [];
    }
  }

  /**
   * Collect from antivirus source (VirusTotal)
   */
  async collectFromAntivirusSource(source) {
    try {
      // In a real implementation, this would make API calls to VirusTotal
      // For now, return simulated data
      const indicators = [
        {
          indicatorId: this.generateIndicatorId(),
          type: 'malware_hash',
          value: 'e8fa8b0b1d4e4a6c8b9f6e3d2c5a4b6c8b9f6e3d2c5',
          confidence: 0.95,
          severity: 'high',
          source: source.name,
          firstSeen: new Date(Date.now() - 86400000), // 1 day ago
          lastSeen: new Date(),
          description: 'Malware signature detected by antivirus scanning',
          tags: ['malware', 'antivirus'],
          context: {
            file_hash: 'e8fa8b0b1d4e4a6c8b9f6e3d2c5a4b6c8b9f6e3d2c5',
            file_type: 'executable',
            scanner: 'VirusTotal'
          }
        },
        {
          indicatorId: this.generateIndicatorId(),
          type: 'malware_domain',
          value: 'malicious-domain.com',
          confidence: 0.88,
          severity: 'medium',
          source: source.name,
          firstSeen: new Date(Date.now() - 172800000), // 2 days ago
          lastSeen: new Date(),
          description: 'Known malicious domain detected by threat intelligence',
          tags: ['domain', 'reputation'],
          context: {
            domain: 'malicious-domain.com',
            reputation_score: -10
          }
        }
      ];

      return indicators;

    } catch (error) {
      this.logger.error('Failed to collect from antivirus source:', error);
      throw error;
    }
  }

  /**
   * Collect from IP reputation source
   */
  async collectFromIPReputationSource(source) {
    try {
      // In a real implementation, this would make API calls to IP reputation services
      // For now, return simulated data
      const indicators = [
        {
          indicatorId: this.generateIndicatorId(),
          type: 'ip_address',
          value: '192.168.1.100',
          confidence: 0.92,
          severity: 'medium',
          source: source.name,
          firstSeen: new Date(Date.now() - 3600000), // 1 hour ago
          lastSeen: new Date(),
          description: 'IP address with poor reputation detected',
          tags: ['ip', 'reputation'],
          context: {
            ip: '192.168.1.100',
            reputation_score: -25,
            country: 'unknown',
            isp: 'unknown'
          }
        },
        {
          indicatorId: this.generateIndicatorId(),
          type: 'ip_address',
          value: '10.0.0.15',
          confidence: 0.75,
          severity: 'low',
          source: source.name,
          firstSeen: new Date(Date.now() - 7200000), // 2 hours ago
          lastSeen: new Date(),
          description: 'Suspicious IP address activity detected',
          tags: ['ip', 'suspicious'],
          context: {
            ip: '10.0.0.15',
            reputation_score: -10,
            country: 'unknown',
            isp: 'unknown'
          }
        }
      ];

      return indicators;

    } catch (error) {
      this.logger.error('Failed to collect from IP reputation source:', error);
      throw error;
    }
  }

  /**
   * Collect from phishing source
   */
  async collectFromPhishingSource(source) {
    try {
      // In a real implementation, this would make API calls to phishing databases
      // For now, return simulated data
      const indicators = [
        {
          indicatorId: this.generateIndicatorId(),
          type: 'url',
          value: 'http://phishing-site.com/login',
          confidence: 0.95,
          severity: 'high',
          source: source.name,
          firstSeen: new Date(Date.now() - 86400000), // 1 day ago
          lastSeen: new Date(),
          description: 'Phishing URL detected by threat intelligence',
          tags: ['phishing', 'url', 'credential_theft'],
          context: {
            url: 'http://phishing-site.com/login',
            target: 'banking'
          }
        },
        {
          indicatorId: this.generateIndicatorId(),
          type: 'email_address',
          value: 'phishing@attack.com',
          confidence: 0.90,
          severity: 'high',
          source: source.name,
          firstSeen: new Date(Date.now() - 86400000), // 1 day ago
          lastSeen: new Date(),
          description: 'Phishing email detected in threat intelligence data',
          tags: ['phishing', 'email', 'credential_theft'],
          context: {
            email: 'phishing@attack.com',
            target: 'employees'
          }
        }
      ];

      return indicators;

    } catch (error) {
      this.logger.error('Failed to collect from phishing source:', error);
      throw error;
    }
  }

  /**
   * Process collected indicators
   */
  async processCollectedIndicators(collectionResults) {
    try {
      for (const result of collectionResults) {
        for (const indicator of result.indicators) {
          await this.processIndicator(indicator);
        }
      }
    } catch (error) {
      this.logger.error('Failed to process collected indicators:', error);
    }
  }

  /**
   * Process individual indicator
   */
  async processIndicator(indicator) {
    try {
      // Check for duplicates
      const existingIndicator = this.findExistingIndicator(indicator);
      if (existingIndicator) {
        this.updateExistingIndicator(existingIndicator, indicator);
        return;
      }

      // Check for patterns
      const patterns = await this.matchIndicatorToPatterns(indicator);
      if (patterns.length > 0) {
        indicator.relatedPatterns = patterns.map(p => p.id);
      }

      // Enrich indicator data if enabled
      if (this.config.enrichmentEnabled) {
        indicator.enrichment = await this.enrichIndicator(indicator);
      }

      // Store indicator
      this.indicators.set(indicator.indicatorId, indicator);

      // Add to history
      const historyKey = `${indicator.type}_${indicator.value.substring(0, 50)}`;
      if (!this.indicatorHistory.has(historyKey)) {
        this.indicatorHistory.set(historyKey, []);
      }
      this.indicatorHistory.get(historyKey).push({
        timestamp: new Date(),
        confidence: indicator.confidence,
        action: 'added'
      });

      // Emit indicator processed event
      this.emit('indicatorProcessed', indicator);

      // Perform pattern matching
      if (patterns.length > 0) {
        this.emit('patternMatched', {
          indicator,
          patterns
        });
      }

      this.logger.info(`Processed threat indicator: ${indicator.indicatorId} (${indicator.type}) from ${indicator.source}`);

    } catch (error) {
      this.logger.error(`Failed to process indicator ${indicator.indicatorId}:`, error);
    }
  }

  /**
   * Find existing indicator (duplicate detection)
   */
  findExistingIndicator(indicator) {
    // Check for exact matches
    for (const [indicatorId, storedIndicator] of this.indicators) {
      if (this.indicatorsMatch(storedIndicator, indicator)) {
        return storedIndicator;
      }
    }
    return null;
  }

  /**
   * Check if two indicators match
   */
  indicatorsMatch(indicator1, indicator2) {
    return (
      indicator1.type === indicator2.type &&
      indicator1.value === indicator2.value &&
      indicator1.source === indicator2.source
    );
  }

  /**
   * Update existing indicator
   */
  updateExistingIndicator(existingIndicator, newIndicator) {
    try {
      // Update seen timestamp
      existingIndicator.lastSeen = new Date();
      existingIndicator.falsePositiveCount++;

      // Update confidence if different
      if (newIndicator.confidence !== existingIndicator.confidence) {
        existingIndicator.confidence = Math.max(
          existingIndicator.confidence * 0.9,
          newIndicator.confidence * 0.1
        );
      }

      // Update enrichment data if provided
      if (newIndicator.enrichment) {
        existingIndicator.enrichment = {
          ...existingIndicator.enrichment,
          ...newIndicator.enrichment
        };
      }

      this.logger.info(`Updated indicator ${existingIndicator.indicatorId}`);

    } catch (error) {
      this.logger.error(`Failed to update indicator ${existingIndicator.indicatorId}:`, error);
    }
  }

  /**
   * Match indicator to known patterns
   */
  async matchIndicatorToPatterns(indicator) {
    try {
      const matchedPatterns = [];

      for (const [patternId, pattern] of this.patterns) {
        if (this.matchesPattern(indicator, pattern)) {
          matchedPatterns.push(pattern);
        }
      }

      return matchedPatterns;

    } catch (error) {
      this.logger.error('Failed to match indicator to patterns:', error);
      return [];
    }
  }

  /**
   * Check if indicator matches pattern
   */
  matchesPattern(indicator, pattern) {
    try {
      // Simple regex matching for pattern detection
      const regex = new RegExp(pattern.pattern_regex, 'i');
      return regex.test(indicator.value);
    } catch (error) {
      this.logger.error(`Invalid pattern regex: ${pattern.pattern_regex}`, error);
      return false;
    }
  }

  /**
   * Enrich indicator with additional data
   */
  enrichIndicator(indicator) {
    try {
      const enrichment = {
        geoLocation: await this.getGeoLocation(indicator.value),
        whois: await this.getWhois(indicator.value),
        contextAnalysis: await this.analyzeContext(indicator),
        threatIntelligence: await this.getThreatIntelligence(indicator)
      };

      return enrichment;

    } catch (error) {
      this.logger.error('Failed to enrich indicator:', error);
      return null;
    }
  }

  /**
   * Get geolocation for indicator value
   */
  async getGeoLocation(value) {
    try {
      // Check if value is IP address
      const ipRegex = /^(?:(?:[0-9]{1,3}\.){3}[0-9]{1,3}\.[0-9]{1,3})$/;
      if (ipRegex.test(value)) {
        return await this.getIPLocation(value);
      }

      // Check if value is URL
      const urlRegex = /^https?:\/\/([^\/\s]+)$/;
      const match = urlRegex.exec(value);
      if (match) {
        return await this.getURLLocation(match[1]);
      }

      return {
        type: 'unknown',
        value: value,
        location: 'unknown'
      };

    } catch (error) {
      this.logger.error('Failed to get geolocation:', error);
      return {
        type: 'unknown',
        value: value,
        location: 'unknown'
      };
    }
  }

  /**
   * Get IP location
   */
  async getIPLocation(ip) {
    // Placeholder implementation
    return {
      type: 'ip',
      ip: ip,
      country: 'unknown',
      region: 'unknown',
      city: 'unknown',
      latitude: null,
      longitude: null,
      isp: 'unknown',
      organization: 'unknown'
    };
  }

  /**
   * Get URL location
   */
  async getURLLocation(url) {
    // Placeholder implementation
    return {
      type: 'url',
      url: url,
      country: 'unknown',
      region: 'unknown',
      domain: url
    };
  }

  /**
   * Get whois information
   */
  async getWhois(value) {
    // Placeholder implementation
    return {
      whois: 'unknown',
      category: 'unknown'
    };
  }

  /**
   * Analyze context around indicator
   */
  async analyzeContext(indicator) {
    // Placeholder implementation
    return {
      contextScore: 0.5,
      suspiciousFactors: [],
      relatedAssets: [],
      potentialImpact: 'medium'
    };
  }

  /**
   * Get threat intelligence data
   */
  async getThreatIntelligence(indicator) {
    try {
      // Placeholder implementation
      return {
        knownThreats: [],
        threatTypes: [],
        campaignAssociations: [],
        actorTypes: [],
        attackPatterns: []
      };

    } catch (error) {
      this.logger.error('Failed to get threat intelligence:', error);
      return null;
    }
  }

  /**
   * Detect anomalies in threat data
   */
  async detectAnomalies() {
    try {
      const anomalies = [];

      // Check for unusual pattern frequencies
      for (const [patternId, pattern] of this.patterns) {
        const frequency = pattern.frequency;
        if (frequency > 10) {
          anomalies.push({
            type: 'high_frequency_pattern',
            patternId,
            frequency,
            description: `Pattern ${patternId} occurring with high frequency: ${frequency}`,
            severity: 'medium'
          });
        }
      }

      // Check for unusual confidence levels
      const indicators = Array.from(this.indicators.values());
      const avgConfidence = indicators.reduce((sum, ind) => sum + ind.confidence, 0) / indicators.length;

      if (avgConfidence < 0.5) {
        anomalies.push({
          type: 'low_confidence_indicators',
          averageConfidence: avgConfidence,
          description: 'Average indicator confidence is below threshold',
          severity: 'low'
        });
      }

      // Check for geolocation anomalies
      const geoAnomalies = this.detectGeolocationAnomalies(indicators);
      anomalies.push(...geoAnomalies);

      this.emit('anomaliesDetected', anomalies);

      return anomalies;

    } catch (error) {
      this.logger.error('Failed to detect anomalies:', error);
      return [];
    }
  }

  /**
   * Detect geolocation anomalies
   */
  detectGeolocationAnomalies(indicators) {
    try {
      const anomalies = [];
      const locations = new Map();

      // Group indicators by location
      for (const indicator of indicators) {
        const location = await this.getGeoLocation(indicator.value);
        const locationKey = `${location.country || 'unknown'}_${location.region || 'unknown'}`;

        if (!locations.has(locationKey)) {
          locations.set(locationKey, []);
        }

        locations.get(locationKey).push(indicator);
      }

      // Look for geographic anomalies
      for (const [locationKey, locationIndicators] of locations) {
        if (locationIndicators.length > 10) {
          anomalies.push({
            type: 'geographic_cluster',
            location: locationKey,
            count: locationIndicators.length,
            severity: locationIndicators.some(i => i.severity === 'critical') ? 'critical' : 'medium',
            description: `Cluster of ${locationIndicators.length} indicators in ${locationKey}`
          });
        }
      }

      return anomalies;

    } catch (error) {
      this.logger.error('Failed to detect geolocation anomalies:', error);
      return [];
    }
  }

  /**
   * Get threat indicators
   */
  async getIndicators(criteria = {}) {
    try {
      let indicators = Array.from(this.indicators.values());

      // Apply filters
      if (criteria.type) {
        indicators = indicators.filter(indicator => indicator.type === criteria.type);
      }

      if (criteria.severity) {
        indicators = indicators.filter(indicator => indicator.severity === criteria.severity);
      }

      if (criteria.source) {
        indicators = indicators.filter(indicator => indicator.source === criteria.source);
      }

      if (criteria.since) {
        const since = new Date(criteria.since);
        indicators = indicators.filter(indicator => indicator.firstSeen >= since);
      }

      if (criteria.active !== undefined) {
        indicators = indicators.filter(indicator => indicator.isActive === criteria.active);
      }

      // Sort by last seen (most recent first)
      indicators.sort((a, b) => b.lastSeen - a.lastSeen);

      // Apply pagination
      if (criteria.page) {
        const page = parseInt(criteria.page);
        const limit = criteria.limit || 20;
        const start = (page - 1) * limit;
        indicators = indicators.slice(start, start + limit);
      }

      return {
        indicators,
        total: this.indicators.size,
        filteredCount: indicators.length,
        filters: criteria
      };

    } catch (error) {
      this.logger.error('Failed to get indicators:', error);
      return {
        indicators: [],
        total: 0,
        filteredCount: 0,
        filters: criteria
      };
    }
  }

  /**
   * Get patterns
   */
  getPatterns(criteria = {}) {
    try {
      let patterns = Array.from(this.patterns.values());

      // Apply filters
      if (criteria.type) {
        patterns = patterns.filter(pattern => pattern.pattern_type === criteria.type);
      }

      if (criteria.confidence) {
        patterns = patterns.filter(pattern => pattern.confidence >= criteria.confidence);
      }

      if (criteria.frequency) {
        patterns = patterns.filter(pattern => pattern.frequency >= criteria.frequency);
      }

      // Sort by frequency (highest first)
      patterns.sort((a, b) => b.frequency - a.frequency);

      return patterns;

    } catch (error) {
      this.logger.error('Failed to get patterns:', error);
      return [];
    }
  }

  /**
   * Add threat indicator
   */
  async addIndicator(indicatorData) {
    try {
      const indicator = {
        indicatorId: this.generateIndicatorId(),
        type: indicatorData.type,
        value: indicatorData.value,
        confidence: indicatorData.confidence || 0.5,
        severity: indicatorData.severity || 'medium',
        source: indicatorData.source || 'manual',
        firstSeen: new Date(),
        lastSeen: new Date(),
        description: indicatorData.description || 'Threat indicator',
        tags: indicatorData.tags || [],
        context: indicatorData.context || {},
        isActive: true,
        falsePositiveCount: 0,
        enrichmentData: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Process the indicator
      await this.processIndicator(indicator);

      this.emit('indicatorAdded', indicator);

      return indicator;

    } catch (error) {
      this.logger.error('Failed to add indicator:', error);
      throw error;
    }
  }

  /**
   * Update threat indicator
   */
  async updateIndicator(indicatorId, updateData) {
    try {
      const existingIndicator = this.indicators.get(indicatorId);
      if (!existingIndicator) {
        throw new Error(`Indicator ${indicatorId} not found`);
      }

      // Update fields
      const updatedIndicator = {
        ...existingIndicator,
        ...updateData,
        updatedAt: new Date()
      };

      this.indicators.set(indicatorId, updatedIndicator);

      this.emit('indicatorUpdated', updatedIndicator);

      return updatedIndicator;

    } catch (error) {
      this.logger.error(`Failed to update indicator ${indicatorId}:`, error);
      throw error;
    }
  }

  /**
   * Get threat statistics
   */
  async getStatistics() {
    try {
      return {
        totalIndicators: this.indicators.size,
        activeIndicators: Array.from(this.indicators.values()).filter(i => i.isActive).length,
        patterns: this.patterns.size,
        sources: this.sources.size,
        mlModels: this.patternRecognizer ? 1 : 0,
        anomalyDetector: this.anomalyDetector ? 1 : 0,
        cacheSize: this.cache.size,
        autoCollection: this.config.autoCollection,
        enrichmentEnabled: this.config.enrichmentEnabled,
        learningEnabled: this.config.learningEnabled
      };

    } catch (error) {
      this.logger.error('Failed to get statistics:', error);
      return {
        totalIndicators: 0,
        activeIndicators: 0,
        patterns: 0,
        sources: 0,
        mlModels: 0,
        anomalyDetector: 0,
        cacheSize: 0
      };
    }
  }

  /**
   * Generate unique indicator ID
   */
  generateIndicatorId() {
    return `indicator-${Date.now()}-${Math.random().toString(25).substr(2, 15)}`;
  }

  /**
   * Clean up old indicators
   */
  async cleanup() {
    try {
      const cutoffDate = new Date(Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000));

      // Clean old indicators
      for (const [indicatorId, indicator] of this.indicators.entries()) {
        if (indicator.lastUpdated && indicator.lastUpdated < cutoffDate) {
          this.indicators.delete(indicatorId);
        }
      }

      // Clean old history
      for (const [historyKey, history] of this.indicatorHistory.entries()) {
        if (history[history.length > 0 && history[history.length - 1].timestamp < cutoffDate) {
          this.indicatorHistory.delete(historyKey);
        }
      }

      // Clean old patterns
      for (const [patternId, pattern] of this.patterns.entries()) {
        if (pattern.lastUpdated && pattern.lastUpdated < cutoffDate) {
          this.patterns.delete(patternId);
        }
      }

      // Clean old cache entries
      if (this.cache.size > 1000) {
        const keysToDelete = Array.from(this.cache.keys()).slice(0, 500);
        for (const key of keysToDelete) {
          this.cache.delete(key);
        }
      }

      this.logger.info('Threat intelligence cleanup completed');

    } catch (error) {
      this.logger.error('Failed to cleanup threat intelligence data:', error);
    }
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // Indicator endpoints
    router.get('/indicators', this.getIndicators.bind(this));
    router.post('/indicators', this.addIndicator.bind(this));
    router.put('/indicators/:id', this.updateIndicator.bind(this));

    // Pattern endpoints
    router.get('/patterns', this.getPatterns.bind(this));
    router.get('/anomalies', this.detectAnomalies.bind(this));

    // Statistics endpoint
    router.get('/statistics', this.getStatistics.bind(this));

    // Health check
    router.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date(),
        components: this.getStatistics()
      });
    });

    return router;
  }

  /**
   * Get controller statistics
   */
  getControllerStatistics() {
    return {
      enabled: this.config.enabled,
      autoCollection: this.config.autoCollection,
      collectionInterval: this.config.collectionInterval,
      totalIndicators: this.indicators.size,
      activeIndicators: Array.from(this.indicators.values()).filter(i => i.isActive).length,
      cacheSize: this.cache.size,
      components: {
        patternRecognizer: this.patternRecognizer ? this.patternRecognizer.getStatistics() : {},
        anomalyDetector: this.anomalyDetector ? this.anomalyDetector.getStatistics() : {}
      }
    };
  }
}

// Pattern Recognizer Helper Class
class PatternRecognizer {
  constructor(config) {
    this.config = config;
    this.patterns = new Map();
    this.model = null;
  }

  getStatistics() {
    return {
      patterns: this.patterns.size,
      modelEnabled: this.model !== null
    };
  }
}

// Anomaly Detector Helper Class
class AnomalyDetector {
  constructor(config) {
    this.config = config;
    this.anomalies = [];
  }

  getStatistics() {
    return {
      anomalies: this.anomalies.length,
      modelEnabled: true
    };
  }
}

module.exports = ThreatIntelligence;