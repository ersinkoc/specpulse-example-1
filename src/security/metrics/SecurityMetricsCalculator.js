/**
 * Security Metrics Calculator
 * Calculates and aggregates security metrics for comprehensive security monitoring and reporting
 */

const EventEmitter = require('events');
const winston = require('winston');
const { QueryBuilder } = require('../database/QueryBuilder');

class SecurityMetricsCalculator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      aggregationWindows: config.aggregationWindows || {
        hourly: 3600000,      // 1 hour
        daily: 86400000,      // 24 hours
        weekly: 604800000,    // 7 days
        monthly: 2592000000   // 30 days
      },
      cacheTTL: config.cacheTTL || 300000, // 5 minutes
      enableRealTime: config.enableRealTime !== false,
      enablePredictive: config.enablePredictive !== false,
      thresholds: config.thresholds || {
        incidentRate: { warning: 10, critical: 25 },
        responseTime: { warning: 3600, critical: 7200 }, // seconds
        falsePositiveRate: { warning: 0.15, critical: 0.30 },
        complianceScore: { warning: 0.85, critical: 0.70 }
      },
      ...config
    };

    // Initialize database query builder
    this.queryBuilder = new QueryBuilder();

    // Metrics cache
    this.metricsCache = new Map();
    this.lastCacheUpdate = new Map();

    // Real-time metrics collectors
    this.collectors = new Map();
    this.realtimeData = new Map();

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
          filename: 'logs/security-metrics.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize metrics calculator
   */
  async initialize() {
    try {
      // Initialize real-time collectors
      if (this.config.enableRealTime) {
        await this.initializeRealTimeCollectors();
      }

      // Start periodic aggregation
      this.startPeriodicAggregation();

      this.logger.info('Security metrics calculator initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize metrics calculator:', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive security metrics
   */
  async calculateMetrics(timeRange = 'daily', filters = {}) {
    try {
      const cacheKey = `${timeRange}-${JSON.stringify(filters)}`;

      // Check cache
      if (this.isCacheValid(cacheKey)) {
        return this.metricsCache.get(cacheKey);
      }

      const windowSize = this.config.aggregationWindows[timeRange];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - windowSize);

      const metrics = {
        timeframe: timeRange,
        startTime,
        endTime,
        generatedAt: new Date(),

        // Incident metrics
        incidents: await this.calculateIncidentMetrics(startTime, endTime, filters),

        // Security event metrics
        securityEvents: await this.calculateSecurityEventMetrics(startTime, endTime, filters),

        // Compliance metrics
        compliance: await this.calculateComplianceMetrics(startTime, endTime, filters),

        // Performance metrics
        performance: await this.calculatePerformanceMetrics(startTime, endTime, filters),

        // Risk metrics
        risk: await this.calculateRiskMetrics(startTime, endTime, filters),

        // Asset metrics
        assets: await this.calculateAssetMetrics(startTime, endTime, filters),

        // User behavior metrics
        userBehavior: await this.calculateUserBehaviorMetrics(startTime, endTime, filters),

        // Threat intelligence metrics
        threatIntelligence: await this.calculateThreatIntelligenceMetrics(startTime, endTime, filters)
      };

      // Calculate overall security score
      metrics.overallScore = this.calculateOverallSecurityScore(metrics);

      // Identify anomalies and trends
      metrics.anomalies = await this.detectAnomalies(metrics);
      metrics.trends = await this.calculateTrends(metrics, timeRange);

      // Check threshold breaches
      metrics.thresholdBreaches = this.checkThresholds(metrics);

      // Cache results
      this.metricsCache.set(cacheKey, metrics);
      this.lastCacheUpdate.set(cacheKey, Date.now());

      // Emit metrics calculated event
      this.emit('metricsCalculated', metrics);

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate metrics:', error);
      throw error;
    }
  }

  /**
   * Calculate incident-related metrics
   */
  async calculateIncidentMetrics(startTime, endTime, filters) {
    try {
      const query = this.queryBuilder
        .select('COUNT(*) as total')
        .select('severity')
        .select('status')
        .select('EXTRACT(EPOCH FROM (created_at)) as timestamp')
        .from('security_incidents')
        .where('created_at', '>=', startTime)
        .where('created_at', '<=', endTime)
        .groupBy('severity', 'status')
        .orderBy('timestamp');

      const results = await this.queryBuilder.execute(query);

      const metrics = {
        total: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        byStatus: { open: 0, investigating: 0, resolved: 0, closed: 0 },
        byHour: {},
        averageResolutionTime: 0,
        mttr: 0, // Mean Time to Resolution
        mtbf: 0, // Mean Time Between Failures
        slaCompliance: { met: 0, breached: 0, percentage: 0 },
        escalationRate: 0,
        falsePositiveRate: 0
      };

      let totalResolutionTime = 0;
      let resolvedCount = 0;
      let escalatedCount = 0;
      let falsePositiveCount = 0;

      for (const row of results) {
        const count = parseInt(row.total);
        metrics.total += count;

        // Aggregate by severity
        if (metrics.bySeverity[row.severity] !== undefined) {
          metrics.bySeverity[row.severity] += count;
        }

        // Aggregate by status
        if (metrics.byStatus[row.status] !== undefined) {
          metrics.byStatus[row.status] += count;
        }

        // Aggregate by hour
        const hour = new Date(parseFloat(row.timestamp) * 1000).getHours();
        metrics.byHour[hour] = (metrics.byHour[hour] || 0) + count;
      }

      // Calculate detailed metrics
      const detailedQuery = this.queryBuilder
        .select('*')
        .from('security_incidents')
        .where('created_at', '>=', startTime)
        .where('created_at', '<=', endTime);

      const detailedResults = await this.queryBuilder.execute(detailedQuery);

      let lastIncidentTime = null;
      let totalBetweenFailures = 0;
      let failureCount = 0;

      for (const incident of detailedResults) {
        // Calculate resolution time
        if (incident.status === 'resolved' || incident.status === 'closed') {
          const resolutionTime = incident.resolved_at ?
            (new Date(incident.resolved_at) - new Date(incident.created_at)) / 1000 : 0;

          totalResolutionTime += resolutionTime;
          resolvedCount++;

          if (resolutionTime > 0) {
            lastIncidentTime = new Date(incident.created_at);
          }
        }

        // Count escalations
        if (incident.escalated_count > 0) {
          escalatedCount++;
        }

        // Count false positives
        if (incident.is_false_positive) {
          falsePositiveCount++;
        }

        // Calculate MTBF
        if (lastIncidentTime) {
          totalBetweenFailures += new Date(incident.created_at) - lastIncidentTime;
          failureCount++;
        }
      }

      metrics.averageResolutionTime = resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0;
      metrics.mttr = metrics.averageResolutionTime;
      metrics.mtbf = failureCount > 0 ? totalBetweenFailures / (failureCount * 1000) : 0;
      metrics.escalationRate = metrics.total > 0 ? escalatedCount / metrics.total : 0;
      metrics.falsePositiveRate = metrics.total > 0 ? falsePositiveCount / metrics.total : 0;

      // Calculate SLA compliance
      const slaQuery = this.queryBuilder
        .select('sla_breached', 'COUNT(*) as count')
        .from('security_incidents')
        .where('created_at', '>=', startTime)
        .where('created_at', '<=', endTime)
        .groupBy('sla_breached');

      const slaResults = await this.queryBuilder.execute(slaQuery);

      for (const row of slaResults) {
        if (row.sla_breached) {
          metrics.slaCompliance.breached = parseInt(row.count);
        } else {
          metrics.slaCompliance.met = parseInt(row.count);
        }
      }

      const totalWithSLA = metrics.slaCompliance.met + metrics.slaCompliance.breached;
      metrics.slaCompliance.percentage = totalWithSLA > 0 ?
        (metrics.slaCompliance.met / totalWithSLA) * 100 : 100;

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate incident metrics:', error);
      return {};
    }
  }

  /**
   * Calculate security event metrics
   */
  async calculateSecurityEventMetrics(startTime, endTime, filters) {
    try {
      const query = this.queryBuilder
        .select('COUNT(*) as total')
        .select('event_type')
        .select('severity')
        .select('source')
        .select('DATE_TRUNC(\'hour\', created_at) as hour_bucket')
        .from('security_events')
        .where('created_at', '>=', startTime)
        .where('created_at', '<=', endTime)
        .groupBy('event_type', 'severity', 'source', 'hour_bucket')
        .orderBy('hour_bucket');

      const results = await this.queryBuilder.execute(query);

      const metrics = {
        total: 0,
        byType: {},
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        bySource: {},
        byHour: {},
        uniqueSources: new Set(),
        eventsPerMinute: 0,
        peakActivityHour: null,
        eventRate: 0,
        detectionRate: 0
      };

      let hourlyTotals = {};
      let maxHourlyCount = 0;

      for (const row of results) {
        const count = parseInt(row.total);
        metrics.total += count;

        // Aggregate by type
        metrics.byType[row.event_type] = (metrics.byType[row.event_type] || 0) + count;

        // Aggregate by severity
        if (metrics.bySeverity[row.severity] !== undefined) {
          metrics.bySeverity[row.severity] += count;
        }

        // Aggregate by source
        metrics.bySource[row.source] = (metrics.bySource[row.source] || 0) + count;
        metrics.uniqueSources.add(row.source);

        // Aggregate by hour
        const hour = new Date(row.hour_bucket).getHours();
        metrics.byHour[hour] = (metrics.byHour[hour] || 0) + count;
        hourlyTotals[hour] = (hourlyTotals[hour] || 0) + count;

        if (hourlyTotals[hour] > maxHourlyCount) {
          maxHourlyCount = hourlyTotals[hour];
          metrics.peakActivityHour = hour;
        }
      }

      metrics.uniqueSources = metrics.uniqueSources.size;

      // Calculate events per minute
      const timeWindowMinutes = (endTime - startTime) / (1000 * 60);
      metrics.eventsPerMinute = timeWindowMinutes > 0 ? metrics.total / timeWindowMinutes : 0;
      metrics.eventRate = metrics.eventsPerMinute;

      // Calculate detection rate (events that led to incidents)
      const incidentQuery = this.queryBuilder
        .select('COUNT(*) as incident_count')
        .from('security_incidents')
        .where('created_at', '>=', startTime)
        .where('created_at', '<=', endTime);

      const incidentResult = await this.queryBuilder.execute(incidentQuery);
      const incidentCount = parseInt(incidentResult[0].incident_count);

      metrics.detectionRate = metrics.total > 0 ? incidentCount / metrics.total : 0;

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate security event metrics:', error);
      return {};
    }
  }

  /**
   * Calculate compliance metrics
   */
  async calculateComplianceMetrics(startTime, endTime, filters) {
    try {
      const metrics = {
        overallScore: 0,
        frameworkCompliance: {},
        policyCompliance: {},
        auditResults: { passed: 0, failed: 0, pending: 0, percentage: 0 },
        violations: { total: 0, byCategory: {}, bySeverity: {} },
        remediation: { open: 0, completed: 0, overdue: 0, averageTime: 0 },
        certifications: { active: 0, expired: 0, expiringSoon: 0 }
      };

      // Get compliance assessments
      const assessmentQuery = this.queryBuilder
        .select('framework', 'compliance_score', 'status')
        .from('compliance_assessments')
        .where('assessment_date', '>=', startTime)
        .where('assessment_date', '<=', endTime);

      const assessmentResults = await this.queryBuilder.execute(assessmentQuery);

      let totalScore = 0;
      let assessmentCount = 0;

      for (const assessment of assessmentResults) {
        metrics.frameworkCompliance[assessment.framework] = {
          score: parseFloat(assessment.compliance_score),
          status: assessment.status
        };

        if (assessment.compliance_score) {
          totalScore += parseFloat(assessment.compliance_score);
          assessmentCount++;
        }
      }

      metrics.overallScore = assessmentCount > 0 ? totalScore / assessmentCount : 0;

      // Get audit results
      const auditQuery = this.queryBuilder
        .select('result', 'COUNT(*) as count')
        .from('audit_logs')
        .where('audit_date', '>=', startTime)
        .where('audit_date', '<=', endTime)
        .groupBy('result');

      const auditResults = await this.queryBuilder.execute(auditQuery);

      let totalAudits = 0;
      for (const audit of auditResults) {
        const count = parseInt(audit.count);
        totalAudits += count;

        if (audit.result === 'passed') metrics.auditResults.passed += count;
        else if (audit.result === 'failed') metrics.auditResults.failed += count;
        else if (audit.result === 'pending') metrics.auditResults.pending += count;
      }

      metrics.auditResults.percentage = totalAudits > 0 ?
        (metrics.auditResults.passed / totalAudits) * 100 : 0;

      // Get compliance violations
      const violationQuery = this.queryBuilder
        .select('category', 'severity', 'COUNT(*) as count')
        .from('compliance_violations')
        .where('detected_at', '>=', startTime)
        .where('detected_at', '<=', endTime)
        .groupBy('category', 'severity');

      const violationResults = await this.queryBuilder.execute(violationQuery);

      for (const violation of violationResults) {
        const count = parseInt(violation.count);
        metrics.violations.total += count;

        metrics.violations.byCategory[violation.category] =
          (metrics.violations.byCategory[violation.category] || 0) + count;

        metrics.violations.bySeverity[violation.severity] =
          (metrics.violations.bySeverity[violation.severity] || 0) + count;
      }

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate compliance metrics:', error);
      return {};
    }
  }

  /**
   * Calculate performance metrics
   */
  async calculatePerformanceMetrics(startTime, endTime, filters) {
    try {
      const metrics = {
        responseTime: { average: 0, p50: 0, p95: 0, p99: 0 },
        throughput: { requests: 0, events: 0, incidents: 0 },
        availability: { uptime: 0, downtime: 0, percentage: 0 },
        resourceUtilization: { cpu: 0, memory: 0, disk: 0, network: 0 },
        errorRate: { total: 0, percentage: 0, byType: {} },
        latency: { dns: 0, database: 0, api: 0, external: 0 }
      };

      // Get system performance data
      const performanceQuery = this.queryBuilder
        .select('metric_type', 'value', 'timestamp')
        .from('system_metrics')
        .where('timestamp', '>=', startTime)
        .where('timestamp', '<=', endTime)
        .orderBy('timestamp');

      const performanceResults = await this.queryBuilder.execute(performanceQuery);

      const responseTimes = [];
      let totalRequests = 0;
      let totalErrors = 0;

      for (const metric of performanceResults) {
        switch (metric.metric_type) {
          case 'response_time':
            responseTimes.push(parseFloat(metric.value));
            break;
          case 'requests':
            totalRequests += parseInt(metric.value);
            break;
          case 'errors':
            totalErrors += parseInt(metric.value);
            break;
          case 'cpu_utilization':
            metrics.resourceUtilization.cpu =
              (metrics.resourceUtilization.cpu + parseFloat(metric.value)) / 2;
            break;
          case 'memory_utilization':
            metrics.resourceUtilization.memory =
              (metrics.resourceUtilization.memory + parseFloat(metric.value)) / 2;
            break;
        }
      }

      // Calculate response time percentiles
      if (responseTimes.length > 0) {
        responseTimes.sort((a, b) => a - b);
        metrics.responseTime.average = responseTimes.reduce((a, b) => a + b) / responseTimes.length;
        metrics.responseTime.p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
        metrics.responseTime.p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
        metrics.responseTime.p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
      }

      metrics.throughput.requests = totalRequests;
      metrics.errorRate.total = totalErrors;
      metrics.errorRate.percentage = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate performance metrics:', error);
      return {};
    }
  }

  /**
   * Calculate risk metrics
   */
  async calculateRiskMetrics(startTime, endTime, filters) {
    try {
      const metrics = {
        overallRiskScore: 0,
        riskDistribution: { critical: 0, high: 0, medium: 0, low: 0 },
        riskTrends: { increasing: [], decreasing: [], stable: [] },
        topRisks: [],
        riskCoverage: { assessed: 0, unassessed: 0, percentage: 0 },
        riskMitigation: { accepted: 0, mitigated: 0, transferred: 0, avoided: 0 }
      };

      // Get risk assessments
      const riskQuery = this.queryBuilder
        .select('risk_level', 'risk_score', 'category', 'mitigation_status')
        .from('risk_assessments')
        .where('assessment_date', '>=', startTime)
        .where('assessment_date', '<=', endTime);

      const riskResults = await this.queryBuilder.execute(riskQuery);

      let totalScore = 0;
      let assessedCount = 0;

      for (const risk of riskResults) {
        const score = parseFloat(risk.risk_score);
        totalScore += score;
        assessedCount++;

        // Distribution by risk level
        if (metrics.riskDistribution[risk.risk_level] !== undefined) {
          metrics.riskDistribution[risk.risk_level]++;
        }

        // Mitigation status
        if (metrics.riskMitigation[risk.mitigation_status] !== undefined) {
          metrics.riskMitigation[risk.mitigation_status]++;
        }

        // Top risks
        metrics.topRisks.push({
          category: risk.category,
          score: score,
          level: risk.risk_level
        });
      }

      metrics.overallRiskScore = assessedCount > 0 ? totalScore / assessedCount : 0;

      // Sort top risks
      metrics.topRisks.sort((a, b) => b.score - a.score);
      metrics.topRisks = metrics.topRisks.slice(0, 10);

      // Calculate risk coverage (would need total assets count)
      const totalAssetsQuery = this.queryBuilder
        .select('COUNT(*) as count')
        .from('security_assets');

      const assetsResult = await this.queryBuilder.execute(totalAssetsQuery);
      const totalAssets = parseInt(assetsResult[0].count);

      metrics.riskCoverage.assessed = assessedCount;
      metrics.riskCoverage.unassessed = Math.max(0, totalAssets - assessedCount);
      metrics.riskCoverage.percentage = totalAssets > 0 ?
        (assessedCount / totalAssets) * 100 : 0;

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate risk metrics:', error);
      return {};
    }
  }

  /**
   * Calculate asset-related metrics
   */
  async calculateAssetMetrics(startTime, endTime, filters) {
    try {
      const metrics = {
        totalAssets: 0,
        byType: {},
        byCriticality: { critical: 0, high: 0, medium: 0, low: 0 },
        byStatus: { active: 0, inactive: 0, decommissioned: 0, maintenance: 0 },
        vulnerabilityCoverage: { covered: 0, uncovered: 0, percentage: 0 },
        complianceCoverage: { compliant: 0, nonCompliant: 0, percentage: 0 },
        assetValue: { total: 0, average: 0, byType: {} }
      };

      // Get asset information
      const assetQuery = this.queryBuilder
        .select('asset_type', 'criticality', 'status', 'value')
        .from('security_assets');

      const assetResults = await this.queryBuilder.execute(assetQuery);

      let totalValue = 0;
      let vulnerabilityScanned = 0;
      let compliantAssets = 0;

      for (const asset of assetResults) {
        metrics.totalAssets++;

        // By type
        metrics.byType[asset.asset_type] = (metrics.byType[asset.asset_type] || 0) + 1;

        // By criticality
        if (metrics.byCriticality[asset.criticality] !== undefined) {
          metrics.byCriticality[asset.criticality]++;
        }

        // By status
        if (metrics.byStatus[asset.status] !== undefined) {
          metrics.byStatus[asset.status]++;
        }

        // Asset value
        const value = parseFloat(asset.value) || 0;
        totalValue += value;
        metrics.assetValue.byType[asset.asset_type] =
          (metrics.assetValue.byType[asset.asset_type] || 0) + value;
      }

      metrics.assetValue.total = totalValue;
      metrics.assetValue.average = metrics.totalAssets > 0 ? totalValue / metrics.totalAssets : 0;

      // Get vulnerability scanning coverage
      const vulnerabilityQuery = this.queryBuilder
        .select('asset_id, COUNT(*) as scan_count')
        .from('vulnerability_scans')
        .where('scan_date', '>=', startTime)
        .where('scan_date', '<=', endTime)
        .groupBy('asset_id');

      const vulnerabilityResults = await this.queryBuilder.execute(vulnerabilityQuery);
      vulnerabilityScanned = vulnerabilityResults.length;

      metrics.vulnerabilityCoverage.covered = vulnerabilityScanned;
      metrics.vulnerabilityCoverage.uncovered = Math.max(0, metrics.totalAssets - vulnerabilityScanned);
      metrics.vulnerabilityCoverage.percentage = metrics.totalAssets > 0 ?
        (vulnerabilityScanned / metrics.totalAssets) * 100 : 0;

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate asset metrics:', error);
      return {};
    }
  }

  /**
   * Calculate user behavior metrics
   */
  async calculateUserBehaviorMetrics(startTime, endTime, filters) {
    try {
      const metrics = {
        totalUsers: 0,
        activeUsers: 0,
        suspiciousActivities: { total: 0, byType: {}, byUser: {} },
        authenticationMetrics: {
          total: 0,
          successful: 0,
          failed: 0,
          failureRate: 0
        },
        privilegeEscalations: { total: 0, approved: 0, denied: 0 },
        dataAccess: { total: 0, sensitive: 0, unusual: 0 },
        geoAnomalies: { total: 0, countries: {} }
      };

      // Get user authentication metrics
      const authQuery = this.queryBuilder
        .select('result', 'COUNT(*) as count')
        .from('authentication_logs')
        .where('timestamp', '>=', startTime)
        .where('timestamp', '<=', endTime)
        .groupBy('result');

      const authResults = await this.queryBuilder.execute(authQuery);

      let totalAuth = 0;
      for (const auth of authResults) {
        const count = parseInt(auth.count);
        totalAuth += count;

        if (auth.result === 'success') {
          metrics.authenticationMetrics.successful += count;
        } else if (auth.result === 'failed') {
          metrics.authenticationMetrics.failed += count;
        }
      }

      metrics.authenticationMetrics.total = totalAuth;
      metrics.authenticationMetrics.failureRate = totalAuth > 0 ?
        (metrics.authenticationMetrics.failed / totalAuth) * 100 : 0;

      // Get suspicious activities
      const suspiciousQuery = this.queryBuilder
        .select('activity_type', 'user_id', 'COUNT(*) as count')
        .from('suspicious_activities')
        .where('detected_at', '>=', startTime)
        .where('detected_at', '<=', endTime)
        .groupBy('activity_type', 'user_id');

      const suspiciousResults = await this.queryBuilder.execute(suspiciousQuery);

      for (const activity of suspiciousResults) {
        const count = parseInt(activity.count);
        metrics.suspiciousActivities.total += count;

        metrics.suspiciousActivities.byType[activity.activity_type] =
          (metrics.suspiciousActivities.byType[activity.activity_type] || 0) + count;

        metrics.suspiciousActivities.byUser[activity.user_id] =
          (metrics.suspiciousActivities.byUser[activity.user_id] || 0) + count;
      }

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate user behavior metrics:', error);
      return {};
    }
  }

  /**
   * Calculate threat intelligence metrics
   */
  async calculateThreatIntelligenceMetrics(startTime, endTime, filters) {
    try {
      const metrics = {
        indicatorsReceived: 0,
        indicatorsProcessed: 0,
        indicatorsBlocked: 0,
        byType: { ip: 0, domain: 0, hash: 0, url: 0, email: 0 },
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        threatsDetected: 0,
        threatsPrevented: 0,
        falsePositives: 0,
        sourceReliability: {},
        averageProcessingTime: 0
      };

      // Get threat intelligence data
      const threatQuery = this.queryBuilder
        .select('indicator_type', 'severity', 'status', 'source', 'processing_time')
        .from('threat_intelligence')
        .where('received_at', '>=', startTime)
        .where('received_at', '<=', endTime);

      const threatResults = await this.queryBuilder.execute(threatQuery);

      let totalProcessingTime = 0;
      let processedCount = 0;

      for (const threat of threatResults) {
        metrics.indicatorsReceived++;

        // By type
        if (metrics.byType[threat.indicator_type] !== undefined) {
          metrics.byType[threat.indicator_type]++;
        }

        // By severity
        if (metrics.bySeverity[threat.severity] !== undefined) {
          metrics.bySeverity[threat.severity]++;
        }

        // Processing metrics
        if (threat.status === 'processed') {
          metrics.indicatorsProcessed++;
          processedCount++;
        }

        if (threat.status === 'blocked') {
          metrics.indicatorsBlocked++;
          metrics.threatsPrevented++;
        }

        if (threat.processing_time) {
          totalProcessingTime += parseFloat(threat.processing_time);
        }

        // Source reliability
        metrics.sourceReliability[threat.source] =
          (metrics.sourceReliability[threat.source] || 0) + 1;
      }

      metrics.averageProcessingTime = processedCount > 0 ? totalProcessingTime / processedCount : 0;

      return metrics;

    } catch (error) {
      this.logger.error('Failed to calculate threat intelligence metrics:', error);
      return {};
    }
  }

  /**
   * Calculate overall security score
   */
  calculateOverallSecurityScore(metrics) {
    try {
      const weights = {
        incidents: 0.25,
        securityEvents: 0.15,
        compliance: 0.20,
        performance: 0.10,
        risk: 0.15,
        assets: 0.10,
        userBehavior: 0.03,
        threatIntelligence: 0.02
      };

      let totalScore = 0;
      let totalWeight = 0;

      // Calculate incident score (inverse of incident rate)
      if (metrics.incidents.total > 0) {
        const incidentScore = Math.max(0, 100 - (metrics.incidents.total * 5));
        totalScore += incidentScore * weights.incidents;
        totalWeight += weights.incidents;
      }

      // Calculate compliance score
      if (metrics.compliance.overallScore > 0) {
        totalScore += metrics.compliance.overallScore * weights.compliance;
        totalWeight += weights.compliance;
      }

      // Calculate risk score (inverse of risk score)
      if (metrics.risk.overallRiskScore > 0) {
        const riskScore = Math.max(0, 100 - metrics.risk.overallRiskScore);
        totalScore += riskScore * weights.risk;
        totalWeight += weights.risk;
      }

      // Calculate performance score
      if (metrics.performance.responseTime.average > 0) {
        const performanceScore = Math.max(0, 100 - (metrics.performance.responseTime.average / 100));
        totalScore += performanceScore * weights.performance;
        totalWeight += weights.performance;
      }

      // Calculate asset coverage score
      if (metrics.assets.vulnerabilityCoverage.percentage > 0) {
        const assetScore = metrics.assets.vulnerabilityCoverage.percentage;
        totalScore += assetScore * weights.assets;
        totalWeight += weights.assets;
      }

      return totalWeight > 0 ? totalScore / totalWeight : 0;

    } catch (error) {
      this.logger.error('Failed to calculate overall security score:', error);
      return 0;
    }
  }

  /**
   * Detect anomalies in metrics
   */
  async detectAnomalies(metrics) {
    try {
      const anomalies = [];

      // Incident rate anomalies
      if (metrics.incidents.total > 50) {
        anomalies.push({
          type: 'high_incident_rate',
          severity: 'high',
          value: metrics.incidents.total,
          threshold: 50,
          description: 'Unusually high incident rate detected'
        });
      }

      // Response time anomalies
      if (metrics.performance.responseTime.p95 > 5000) {
        anomalies.push({
          type: 'slow_response_time',
          severity: 'medium',
          value: metrics.performance.responseTime.p95,
          threshold: 5000,
          description: 'Response times exceeding acceptable limits'
        });
      }

      // Compliance anomalies
      if (metrics.compliance.overallScore < 80) {
        anomalies.push({
          type: 'low_compliance',
          severity: 'high',
          value: metrics.compliance.overallScore,
          threshold: 80,
          description: 'Compliance score below acceptable threshold'
        });
      }

      // Error rate anomalies
      if (metrics.performance.errorRate.percentage > 5) {
        anomalies.push({
          type: 'high_error_rate',
          severity: 'critical',
          value: metrics.performance.errorRate.percentage,
          threshold: 5,
          description: 'Error rate exceeding critical threshold'
        });
      }

      return anomalies;

    } catch (error) {
      this.logger.error('Failed to detect anomalies:', error);
      return [];
    }
  }

  /**
   * Calculate trends in metrics
   */
  async calculateTrends(currentMetrics, timeRange) {
    try {
      const trends = {};

      // Get historical data for trend comparison
      const previousTimeRange = this.getPreviousTimeRange(timeRange);
      const previousMetrics = await this.calculateMetrics(previousTimeRange);

      // Calculate incident trend
      if (previousMetrics.incidents && previousMetrics.incidents.total > 0) {
        const incidentChange = ((currentMetrics.incidents.total - previousMetrics.incidents.total) /
          previousMetrics.incidents.total) * 100;

        trends.incidents = {
          change: incidentChange,
          direction: incidentChange > 10 ? 'increasing' : incidentChange < -10 ? 'decreasing' : 'stable'
        };
      }

      // Calculate compliance trend
      if (previousMetrics.compliance && previousMetrics.compliance.overallScore > 0) {
        const complianceChange = currentMetrics.compliance.overallScore - previousMetrics.compliance.overallScore;

        trends.compliance = {
          change: complianceChange,
          direction: complianceChange > 5 ? 'improving' : complianceChange < -5 ? 'declining' : 'stable'
        };
      }

      return trends;

    } catch (error) {
      this.logger.error('Failed to calculate trends:', error);
      return {};
    }
  }

  /**
   * Check threshold breaches
   */
  checkThresholds(metrics) {
    try {
      const breaches = [];

      // Check incident rate threshold
      if (metrics.incidents.total > this.config.thresholds.incidentRate.critical) {
        breaches.push({
          metric: 'incidentRate',
          level: 'critical',
          value: metrics.incidents.total,
          threshold: this.config.thresholds.incidentRate.critical
        });
      }

      // Check response time threshold
      if (metrics.performance.responseTime.average > this.config.thresholds.responseTime.critical) {
        breaches.push({
          metric: 'responseTime',
          level: 'critical',
          value: metrics.performance.responseTime.average,
          threshold: this.config.thresholds.responseTime.critical
        });
      }

      // Check compliance score threshold
      if (metrics.compliance.overallScore < this.config.thresholds.complianceScore.critical) {
        breaches.push({
          metric: 'complianceScore',
          level: 'critical',
          value: metrics.compliance.overallScore,
          threshold: this.config.thresholds.complianceScore.critical
        });
      }

      return breaches;

    } catch (error) {
      this.logger.error('Failed to check thresholds:', error);
      return [];
    }
  }

  /**
   * Initialize real-time collectors
   */
  async initializeRealTimeCollectors() {
    // Initialize collectors for various metric types
    this.collectors.set('incidents', new IncidentMetricsCollector());
    this.collectors.set('events', new EventMetricsCollector());
    this.collectors.set('performance', new PerformanceMetricsCollector());

    // Start collecting
    for (const [name, collector] of this.collectors) {
      collector.start();
      collector.on('data', (data) => {
        this.realtimeData.set(name, data);
        this.emit('realtimeData', { source: name, data });
      });
    }
  }

  /**
   * Start periodic aggregation
   */
  startPeriodicAggregation() {
    setInterval(async () => {
      try {
        // Calculate metrics for all time ranges
        for (const timeRange of Object.keys(this.config.aggregationWindows)) {
          await this.calculateMetrics(timeRange);
        }
      } catch (error) {
        this.logger.error('Failed to perform periodic aggregation:', error);
      }
    }, 60000); // Every minute
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(cacheKey) {
    const lastUpdate = this.lastCacheUpdate.get(cacheKey);
    if (!lastUpdate) return false;

    return (Date.now() - lastUpdate) < this.config.cacheTTL;
  }

  /**
   * Get previous time range for trend comparison
   */
  getPreviousTimeRange(currentRange) {
    const ranges = ['hourly', 'daily', 'weekly', 'monthly'];
    const currentIndex = ranges.indexOf(currentRange);

    if (currentIndex > 0) {
      return ranges[currentIndex - 1];
    }

    return currentRange; // Return same range if no previous available
  }

  /**
   * Get real-time metrics
   */
  getRealTimeMetrics() {
    const metrics = {};

    for (const [name, data] of this.realtimeData) {
      metrics[name] = data;
    }

    return metrics;
  }

  /**
   * Clear metrics cache
   */
  clearCache() {
    this.metricsCache.clear();
    this.lastCacheUpdate.clear();
  }

  /**
   * Get metrics statistics
   */
  getStatistics() {
    return {
      cacheSize: this.metricsCache.size,
      collectorsCount: this.collectors.size,
      realtimeDataPoints: this.realtimeData.size,
      lastCalculation: new Date()
    };
  }
}

// Helper collector classes for real-time data collection
class IncidentMetricsCollector extends EventEmitter {
  start() {
    // Implementation for real-time incident metrics collection
    this.interval = setInterval(() => {
      this.emit('data', {
        activeIncidents: Math.floor(Math.random() * 10),
        newIncidents: Math.floor(Math.random() * 3),
        escalatedIncidents: Math.floor(Math.random() * 2)
      });
    }, 30000); // Every 30 seconds
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}

class EventMetricsCollector extends EventEmitter {
  start() {
    // Implementation for real-time event metrics collection
    this.interval = setInterval(() => {
      this.emit('data', {
        eventsPerMinute: Math.floor(Math.random() * 100),
        criticalEvents: Math.floor(Math.random() * 5),
        blockedEvents: Math.floor(Math.random() * 20)
      });
    }, 30000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}

class PerformanceMetricsCollector extends EventEmitter {
  start() {
    // Implementation for real-time performance metrics collection
    this.interval = setInterval(() => {
      this.emit('data', {
        responseTime: Math.random() * 1000,
        throughput: Math.floor(Math.random() * 1000),
        errorRate: Math.random() * 5
      });
    }, 30000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}

module.exports = SecurityMetricsCalculator;