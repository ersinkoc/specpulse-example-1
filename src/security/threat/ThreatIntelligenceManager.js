/**
 * Threat Intelligence Manager
 * Central management system for threat intelligence processing and analysis
 */

const EventEmitter = require('events');
const winston = require('winston');
const { ThreatIntelligence } = require('./ThreatIntelligence');
const { PatternRecognizer } = require('./PatternRecognizer');

class ThreatIntelligenceManager extends EventEmitter {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      aggregationWindow: config.aggregationWindow || 3600000, // 1 hour
      alertThresholds: config.alertThresholds || {
        critical: 1,
        high: 5,
        medium: 15,
        low: 30
      },
      correlationWindow: config.correlationWindow || 300000, // 5 minutes
      autoRemediation: config.autoRemediation !== false,
      enrichmentEnabled: config.enrichment !== false,
      ...config
    };

    // Initialize components
    this.threatIntelligence = new ThreatIntelligence(config.threatIntelligence || {});
    this.patternRecognizer = new PatternRecognizer(config.patternRecognizer);
    this.incidentManager = {
      createIncidentManager: () => require('../../security/incident/IncidentManager')(),
      getIncidents: () => this.incidentManager.getIncidents()
    };

    // Threat data stores
    this.threatIndicators = new Map();
    this.patternHistory = new Map();
    this.enrichmentData = new Map();
    this.alerts = [];
    this.correlations = new Map();

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
          filename: 'logs/threat-intelligence-manager.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize threat intelligence
   */
  async initialize() {
    try {
      // Start automated threat intelligence collection
      if (this.config.autoCollection) {
        this.startAutomatedCollection();
      }

      // Start pattern analysis
      if (this.config.learningEnabled) {
        this.startPatternAnalysis();
      }

      this.logger.info('Threat intelligence manager initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize threat intelligence manager:', error);
      throw error;
    }
  }

  /**
   * Start automated threat collection
   */
  startAutomatedCollection() {
    setInterval(async () => {
      try {
        await this.collectThreatIndicators();
      } catch (error) {
          this.logger.error('Automated collection failed:', error);
        }
      }
    }, this.config.collectionInterval);
  }

  /**
   * Start pattern analysis
   */
  startPatternAnalysis() {
    setInterval(async () => {
      try {
        const patterns = await this.getUpdatedPatterns();
        const anomalies = await this.detectAnomalies();

        // Emit analysis events
        if (anomalies.length > 0) {
          this.emit('anomalies_detected', anomalies);
        }

        // Update pattern statistics
        this.updatePatternStatistics();

      } catch (error) {
        this.logger.error('Pattern analysis failed:', error);
      }
    }, this.config.updatePatternFrequency);
  }

  /**
   * Collect indicators from all sources
   */
  async collectThreatIndicators() {
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
        this.logger.error(`Failed to collect from ${sourceName}:`, error);
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

    // Emit collection completed event
    this.emit('threatCollectionCompleted', {
      totalCollected: collectionResults.reduce((sum, result) => sum + result.count, 0),
      sourceResults: collectionResults,
      timestamp: new Date()
    });

    this.logger.info(`Threat intelligence collection completed: ${collectionResults.reduce((sum, result) => sum + result.count, 0)} indicators collected`);
  }

  /**
   * Process collected indicators from collection results
   */
  processCollectedIndicators(collectionResults) {
    try {
      for (const result of collectionResults) {
        for (const indicator of result.indicators) {
          this.processIndicator(indicator);
        }

        // Update statistics
        this.updateStatistics();
      }
    } catch (error) {
      this.logger.error('Failed to process collected indicators:', error);
    }
  }

  /**
   * Get indicators by criteria
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

      // Apply sorting
      indicators.sort((a, b) => b.firstSeen - a.firstSeen);

      // Apply pagination
      if (criteria.limit) {
        const limit = parseInt(criteria.limit);
        indicators = indicators.slice(0, limit);
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
   * Get patterns by type
   */
  getPatternsByType(type) {
    return Array.from(this.patterns.values()).filter(pattern => pattern.patternType === type));
  }

  /**
   * Get patterns by severity
   */
  getPatternsBySeverity(severity) {
    return Array.from(this.patterns.values()).filter(pattern => pattern.severity === severity));
  }

  /**
   * Get all patterns
   */
  getAllPatterns() {
    return Array.from(this.patterns.values());
  }

  /**
   * Update pattern statistics
   */
  updatePatternStatistics() {
    const statistics = {
      totalPatterns: this.patterns.size,
      byType: this.getPatternsByType(),
      bySeverity: this.getPatternsBySeverity(),
      updated_at: new Date()
    };

    this.logger.debug('Pattern statistics updated');
  }

  /**
   * Get recent patterns
   */
  getRecentPatterns(count = 10) {
    const allPatterns = Array.from(this.patterns.values());
    return allPatterns
      .sort((a, b) => b.firstSeen - a.firstSeen)
      .slice(0, count);
  }

  /**
   * Export patterns for analysis
   */
  exportPatterns() {
    const patterns = this.getAllPatterns();

    return {
      patterns,
      metadata: {
        total: patterns.length,
        byType: this.getPatternsByType(),
        bySeverity: this.getPatternsBySeverity(),
        recent: this.getRecentPatterns(),
        statistics: this.getPatternStatistics()
      }
    };
  }

  /**
   * Get pattern details
   */
  getPatternDetails(patternId) {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      return null;
    }

    return {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      type: pattern.patternType,
      patterns: pattern.patterns || [],
      confidence: pattern.confidence,
      severity: pattern.severity,
      frequency: pattern.frequency,
      firstSeen: pattern.firstSeen,
      lastSeen: pattern.lastSeen,
      tags: pattern.tags,
      context: pattern.context,
      createdAt: pattern.createdAt,
      updatedAt: pattern.updatedAt
    };
  }

  /**
   * Get active threats
   */
  async getActiveThreats() {
    const activeThreats = Array.from(this.indicators.values()).filter(i => i.isActive);

    return {
      threats: activeThreats,
      total: activeThreats.length,
      byType: this.getPatternsByType(),
      bySeverity: this.getPatternsBySeverity(),
      criticalThreats: activeThreats.filter(t => t.severity === 'critical').length,
      recentThreats: activeThreats.filter(t => t.lastSeen > Date.now() - 3600000) // 1 hour ago
    };
  }

  /**
   * Get recent activity
   */
  async getRecentActivity() {
    const now = new Date();
    const recentActivity = {
      systemEvents: this.behaviorTracking.systemEvents,
      apiCalls: this.behaviorTracking.apiCalls,
      logEntries: this.behaviorTracking.logEntries,
      networkConnections: Array.from(this.behaviorTracking.networkConnections.entries()),
      fileAccess: this.behaviorTracking.fileAccess
    };

    return recentActivity;
  }

  /**
   * Get dashboard widgets
   */
  async getDashboardWidgets() {
    return {
      timestamp: new Date(),
      overview: {
        totalIncidents: await this.getActiveThreats(),
        activeBreaches: 0,
        criticalFindings: 0,
        overallScore: 0
      },
      realTimeMetrics: await this.metricsCalculator.getRealTimeMetrics(),
      topThreats: this.getTopThreats(),
      systemStatus: 'operational'
    };
  }

  /**
   * Get top threats
   */
  getTopThreats(count = 5) {
    const activeThreats = await this.getActiveThreats();
    return activeThreats
      .sort((a, b) => b.firstSeen - a.firstSeen)
      .slice(0, Math.min(count, activeThreats.length));
  }

  /**
   * Generate threat intelligence report
   */
  async generateThreatIntelligenceReport() {
    try {
      const now = new Date();
      const report = {
        generatedAt: now,
        reportId: `threat_intelligence_${now.toISOString()}`,
        overview: await this.getOverview(),
        indicators: this.getIndicators(),
        patterns: this.getPatterns(),
        anomalies: await this.detectAnomalies(),
        realTimeMetrics: await this.metricsCalculator.getRealTimeMetrics(),
        statistics: this.getStatistics(),
        dashboard: await this.getDashboardData(),
        recommendations: this.generateRecommendations()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate threat intelligence report:', error);
      throw error;
    }
  }

  /**
   * Generate recommendations based on current data
   */
  generateRecommendations() {
    try {
      const threats = await this.getActiveThreats();

      const recommendations = [];

      // Critical threats require immediate action
      const criticalThreats = threats.filter(t => t.severity === 'critical');
      if (criticalThreats.length > 0) {
        recommendations.push({
        priority: 'critical',
        title: 'Critical Threats Require Immediate Action',
        description: `${criticalThreats.length} critical threats detected`,
        actions: ['Investigate immediately', 'Incident response', 'Escalate if needed'],
        deadline: 'immediate'
      });
      }

      // High threats
      const highThreats = threats.filter(t => t.severity === 'high');
      if (highThreats.length > 0) {
        recommendations.push({
          priority: 'high',
          title: 'High Priority Threats Require Attention',
          description: `${highThreats.length} high priority threats detected`,
          actions: ['Investigation', 'Increase monitoring', 'Consider escalation'],
          deadline: '24 hours'
        });
      }

      // Medium threats
      const mediumThreats = threats.filter(t => t.severity === 'medium');
      if (mediumThreats.length > 0) {
        recommendations.push({
          priority: 'medium',
          title: 'Medium Priority Threats',
          description: `${mediumThreats.length} medium priority threats detected`,
          actions: ['Monitor closely', 'Update detection rules', 'Consider investigation']
        });
      }

      // Low threats
      const lowThreats = threats.filter(t => t.severity === 'low');
      if (lowThreats.length > 0) {
        recommendations.push({
          priority: 'low',
          title: 'Low Priority Threats',
          description: `${lowThreats.length} low priority threats detected`,
          actions: ['Monitor situation', 'Consider fine-tuning']
        });
      }

      // General recommendations if no specific threats
      if (recommendations.length === 0) {
        recommendations.push({
          priority: 'info',
          title: 'Security System Status Check',
          description: 'No specific threats detected, all systems operational',
          actions: ['Continue monitoring', 'Perform security assessment']
        });
      }

      return recommendations;

    } catch (error) {
      this.logger.error('Failed to generate recommendations:', error);
      return [];
    }
  }

  /**
   * Get detailed dashboard data
   */
  async getDetailedDashboardData() {
    try {
      const timestamp = new Date();

      return {
        timestamp,
        overview: await this.getOverview(),
        metrics: await this.metricsCalculator.calculateMetrics('daily'),
        realTimeMetrics: await this.metricsCalculator.getRealTimeMetrics(),
        incidents: await this.incidentManager.getIncidents({ limit: 10 }),
        policies: await this.policyManager.getPolicies({ effective: true }),
        violations: await this.policyEnforcer.getPolicyViolations({ since: new Date.now() - 3600000 }), // 1 hour
        dashboardData: await this.getDashboardData()
      };

    } catch (error) {
      this.logger.error('Failed to get detailed dashboard data:', error);
      throw error;
    }
  }

  /**
   * Get overview data
   */
  async getOverview() {
    try {
      const now = new Date();
      const recentIncidents = await this.incidentManager.getIncidents({ limit: 5 });
      const recentViolations = await this.policyEnforcer.getPolicyViolations({ since: new Date.now() - 3600000 }); // 1 hour

      return {
        timestamp,
        overview: {
          overallScore: 0,
          criticalIncidents: recentIncidents.filter(i => i.severity === 'critical').length,
          totalIncidents: recentIncidents.length,
          activeBreaches: 0,
          riskLevel: 'low',
          systemStatus: 'operational'
        },
        incidents: recentIncidents,
        violations: recentViolations,
        realTimeMetrics: this.metricsCalculator.getRealTimeMetrics(),
        securityScore: this.calculateSecurityScore()
      };

    } catch (error) {
      this.logger.error('Failed to get overview:', error);
      throw error;
    }
  }

  /**
   * Calculate overall security score
   */
  calculateSecurityScore() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('daily');

      // Weight different categories
      const weights = {
        incidents: 0.25,   // 25%
        securityEvents: 0.20, // 20%
        compliance: 0.20,   // 20%
        performance: 0.15, // 15%
        risk: 0.20 // 20%
        assets: 0.15 // 15%
        users: 0.05   // 5%
      };

      const weightedScore = Object.entries(weights).reduce((sum, [key, weight]) => sum);

      return Math.round(weightedScore);

    } catch (error) {
      this.logger.error('Failed to calculate security score:', error);
      return 0;
    }
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // Real-time updates
    router.get('/realtime', (req, res) => {
      const realTimeData = await this.getRealTimeData();
      res.json(realTimeData);
    });

    return router;
  }

  /**
   * Get real-time data
   */
  async getRealTimeData() {
    try {
      const realtimeData = {
        indicators: this.getRealTimeIndicators(),
        anomalies: this.detectAnomalies(),
        systemStatus: 'operational',
        lastUpdate: new Date(),
        topThreats: this.getTopThreats()
      };

      return realtimeData;

    } catch (error) {
      this.logger.error('Failed to get real-time data:', error);
      return {};
    }
  }

  /**
   * Get real-time indicators
   */
  getRealTimeIndicators() {
    try {
      const activeIndicators = Array.from(this.indicators.values()).filter(i => i.isActive);
      return activeIndicators.slice(0, 10); // Top 10

    } catch (error) {
      this.logger.error('Failed to get real-time indicators:', error);
      return [];
    }
  }

  /**
   * Get top threats
   */
  getTopThreats() {
    try {
      const activeIndicators = this.getRealTimeIndicators();
      return activeIndicators
        .sort((a, b) => b.severityOrder[b.severityOrder.indexOf(a.severity) - b.severityOrder[a.severity - b.severity]) > 0)
        .slice(0, 10);
    } catch (error) {
      this.logger.error('Failed to get top threats:', error);
      return [];
    }
  }

  /**
   * Export threat intelligence report
   */
  async generateThreatIntelligenceReport() {
    try {
      const report = await this.generateThreatIntelligenceReport();

      return report;

    } catch (error) {
      this.logger.error('Failed to generate threat intelligence report:', error);
      throw error;
    }
  }

  /**
   * Generate threat intelligence report
   */
  async generateThreatIntelligenceReport() {
    try {
      const report = {
        reportId: `ti_report_${Date.toISOString()}`,
        generatedAt: new Date(),
        reportType: 'threat_intelligence',
        overview: await this.getOverview(),
        metrics: await this.metricsCalculator.calculateMetrics('daily'),
        realTimeMetrics: await this.metricsCalculator.getRealTimeMetrics(),
        indicators: await this.getIndicators(),
        patterns: await this.getPatterns(),
        anomalies: await this.detectAnomalies(),
        evidence: await this.getEvidenceData(),
        recommendations: await this.generateRecommendations(),
        dashboardData: await this.getDashboardData()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate threat intelligence report:', error);
      throw error;
    }
  }

  /**
   * Get evidence data
   */
  async getEvidenceData() {
    try {
      // Collect evidence from evidence collector
      const evidenceData = await this.evidenceCollector.retrieveEvidence({
        periodStart: new Date(Date.now() - 7 * 24 * 60 * 1000), // 7 days
        periodEnd: new Date()
      });

      // Group evidence by type
      const groupedEvidence = {};
      for (const evidence of evidenceData) {
        if (!groupedEvidence[evidence.type]) {
          groupedEvidence[evidence.type] = [];
        }
        groupedEvidence[evidence.type].push(evidence);
      }

      return groupedEvidence;

    } catch (error) {
      this.logger.error('Failed to get evidence data:', error);
      return {};
    }
  }

  /**
   * Get recent activity
   */
  async getRecentActivity() {
    try {
      return {
        timestamp: new Date(),
        systemEvents: this.behaviorTracking.systemEvents,
        apiCalls: this.behaviorTracking.apiCalls,
        logEntries: this.behaviorTracking.logEntries.slice(-10), // Last 10 entries
        networkConnections: Array.from(this.behaviorTracking.networkConnections.entries()),
        fileAccess: this.behaviorTracking.fileAccess.slice(-10), // Last 10 file accesses
        loginAttempts: this.behaviorTracking.loginAttempts.filter(attempt => attempt.failed).slice(-10) // Last 10 failed attempts
      };

    } catch (error) {
      this.logger.error('Failed to get recent activity:', error);
      return {};
    }
  }

  /**
   * Get system status
   */
  async getSystemStatus() {
    try {
      const stats = this.getStatistics();

      const status = stats.enabled ? 'operational' : 'degraded';
      const health = stats.dashboard ? 'healthy' : 'unhealthy';

      return {
        status,
        health,
        components: stats.components,
        uptime: stats.enabled,
        cacheSize: stats.cacheSize,
        autoCollection: stats.autoCollection,
        learningEnabled: stats.learningEnabled,
        realtimeUpdates: stats.realTimeUpdates,
        systemLoad: stats.systemLoad || 0
      };

    } catch (error) {
      this.logger.error('Failed to get system status:', error);
      return {
        status: 'error',
        components: {}
      };
    }
  }

  /**
   * Start real-time updates for subscribers
   */
  startRealTimeUpdates() {
    setInterval(async () => {
      try {
        const realTimeData = await this.getRealTimeData();
        // Notify subscribers
        this.notifySubscribers('realtime_update', realTimeData);

      } catch (error) {
        this.logger.error('Real-time updates failed:', error);
      }
    }, this.config.updatePatternFrequency);
  }

  /**
   * Notify subscribers of events
   */
  notifySubscribers(event, data) {
    const activeSubscribers = Array.from(this.subscribers.entries()).filter(s => s.id));

    for (const subscriber of activeSubscribers) {
      // In a real implementation, this would send WebSocket messages
      this.logger.info(`Notifying subscriber ${subscriber.id} of ${event.type}:`, data);
    }
  }

  /**
   * Get recent patterns
   */
  async getRecentPatterns(count = 10) {
    try {
      const allPatterns = this.getAllPatterns();
      const recentPatterns = allPatterns
        .sort((a, b) => b.firstSeen - a.firstSeen)
        .slice(0, Math.min(count, allPatterns.length));

      return recentPatterns;
    } catch (error) {
      this.logger.error('Failed to get recent patterns:', error);
      return [];
    }
  }

  /**
   * Clear old data
   */
  async cleanup() {
    try {
      // Clean old indicators
      const cutoffDate = new Date(Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000)); // 90 days

      for (const [indicatorId, indicator] of this.indicators.entries()) {
        if (indicator.lastUpdated && indicator.lastUpdated < cutoffDate) {
          this.indicators.delete(indicatorId);
        }
      }

      // Clean old history
      for (const [historyKey, history] of this.patternHistory.entries()) {
        if (history.length > 100) {
          history.splice(0, history.length - 100);
        }
        this.patternHistory.delete(historyKey);
      }

      // Clean old cache entries
      if (this.cache.size > 1000) {
        const keysToDelete = Array.from(this.cache.keys()).slice(0, 500));
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
   * Get dashboard data from components
   */
  getDashboardData() {
    try {
      return {
        dashboard: await this.getDashboardData(),
        metrics: await this.metricsCalculator.calculateMetrics('daily'),
        incidents: await this.incidentManager.getIncidents({ limit: 10 }),
        policies: await this.policyManager.getPolicies({ effective: true }),
        violations: await this.policyEnforcer.getPolicyViolations({ since: new Date.now() - 3600000 }), // 1 hour
        reportData: await this.complianceReporter.generateReport({
          type: 'executive',
          timeframe: 'monthly'
        })
      };

    } catch (error) {
      this.logger.error('Failed to get dashboard data:', error);
      throw error;
    }
  }
}

module.exports = ThreatIntelligence;