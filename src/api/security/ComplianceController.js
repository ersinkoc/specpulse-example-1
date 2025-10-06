/**
 * Security Compliance Controller
 * API endpoints for compliance management and reporting
 */

const express = require('express');
const winston = require('winston');
const { GDPRCompliance } = require('../../security/compliance/GDPRCompliance');
const { SOC2Compliance } = require('../../security/compliance/SOC2Compliance');
const { EvidenceCollector } = require('../../security/compliance/EvidenceCollector');
const { ComplianceReporter } = require('../../security/compliance/ComplianceReporter');

class ComplianceController {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      cachingEnabled: config.cachingEnabled !== false,
      cacheTimeout: config.cacheTimeout || 600000, // 10 minutes for compliance data
      autoAssessment: config.autoAssessment !== false,
      assessmentInterval: config.assessmentInterval || 86400000, // 24 hours
      frameworks: config.frameworks || ['gdpr', 'soc2'],
      reportGeneration: config.reportGeneration !== false,
      evidenceCollection: config.evidenceCollection !== false,
      alertThresholds: config.alertThresholds || {
        complianceScore: 70,
        criticalViolations: 1,
        overdueAssessments: 3
      },
      ...config
    };

    // Initialize compliance components
    this.gdprEngine = new GDPRCompliance(config.gdpr || {});
    this.soc2Engine = new SOC2Compliance(config.soc2 || {});
    this.evidenceCollector = new EvidenceCollector(config.evidence || {});
    this.complianceReporter = new ComplianceReporter(config.reporting || {});

    // Cache
    this.cache = new Map();

    // Assessment results
    this.assessmentResults = new Map();

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
          filename: 'logs/compliance-controller.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize compliance controller
   */
  async initialize() {
    try {
      // Start automated assessments
      if (this.config.autoAssessment) {
        this.startAutomatedAssessments();
      }

      this.logger.info('Security compliance controller initialized');
    } catch (error) {
      this.logger.error('Failed to initialize compliance controller:', error);
      throw error;
    }
  }

  /**
   * Get compliance overview
   */
  async getOverview(req, res) {
    try {
      // Check cache
      const cacheKey = 'compliance_overview';
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      const overview = {
        timestamp: new Date(),
        frameworks: {},
        overallScore: 0,
        status: 'compliant',
        criticalIssues: [],
        upcomingAssessments: [],
        recentReports: []
      };

      // Get compliance data for each framework
      for (const framework of this.config.frameworks) {
        try {
          const frameworkData = await this.getFrameworkOverview(framework);
          overview.frameworks[framework] = frameworkData;

          // Add to overall score
          overview.overallScore += frameworkData.overallScore;

          // Check for critical issues
          if (frameworkData.criticalIssues && frameworkData.criticalIssues.length > 0) {
            overview.criticalIssues.push(...frameworkData.criticalIssues);
          }

          // Check status
          if (frameworkData.status === 'non_compliant') {
            overview.status = 'non_compliant';
          } else if (frameworkData.status === 'partially_compliant') {
            overview.status = 'partially_compliant';
          }

        } catch (error) {
          this.logger.error(`Failed to get ${framework} overview:`, error);
          overview.frameworks[framework] = {
            error: error.message,
            overallScore: 0,
            status: 'error'
          };
        }
      }

      // Calculate average overall score
      overview.overallScore = overview.overallScore / this.config.frameworks.length;

      // Get upcoming assessments
      overview.upcomingAssessments = await this.getUpcomingAssessments();

      // Get recent reports
      overview.recentReports = await this.getRecentReports();

      // Cache the result
      this.setCachedData(cacheKey, overview);

      res.json(overview);

    } catch (error) {
      this.logger.error('Failed to get compliance overview:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance overview'
      });
    }
  }

  /**
   * Get framework-specific compliance data
   */
  async getFrameworkCompliance(req, res) {
    try {
      const { framework } = req.params;
      const { includeDetails = false, timeframe = 'current' } = req.query;

      // Validate framework
      if (!this.config.frameworks.includes(framework)) {
        return res.status(400).json({
          error: 'Invalid framework',
          message: `Supported frameworks: ${this.config.frameworks.join(', ')}`
        });
      }

      // Check cache
      const cacheKey = `framework_${framework}_${includeDetails}_${timeframe}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      let frameworkData;

      switch (framework) {
        case 'gdpr':
          frameworkData = await this.getGDPRComplianceData(includeDetails);
          break;
        case 'soc2':
          frameworkData = await this.getSOC2ComplianceData(includeDetails);
          break;
        default:
          return res.status(400).json({
            error: 'Unsupported framework',
            message: `Framework ${framework} is not supported`
          });
      }

      // Cache the result
      this.setCachedData(cacheKey, frameworkData);

      res.json(frameworkData);

    } catch (error) {
      this.logger.error(`Failed to get ${req.params.framework} compliance:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance data'
      });
    }
  }

  /**
   * Perform compliance assessment
   */
  async performAssessment(req, res) {
    try {
      const { framework, scope = 'full', scheduled = false } = req.body;

      // Validate framework
      if (!this.config.frameworks.includes(framework)) {
        return res.status(400).json({
          error: 'Invalid framework',
          message: `Supported frameworks: ${this.config.frameworks.join(', ')}`
        });
      }

      // Perform assessment
      const assessment = await this.performFrameworkAssessment(framework, {
        scope,
        scheduled,
        initiatedBy: req.user?.id || 'system',
        initiatedAt: new Date()
      });

      // Store assessment result
      const assessmentId = this.generateAssessmentId();
      this.assessmentResults.set(assessmentId, assessment);

      // Check for alerts
      this.checkForComplianceAlerts(assessment);

      res.status(201).json({
        assessmentId,
        framework,
        assessment
      });

    } catch (error) {
      this.logger.error('Failed to perform compliance assessment:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to perform compliance assessment'
      });
    }
  }

  /**
   * Get compliance evidence
   */
  async getEvidence(req, res) {
    try {
      const {
        framework,
        type,
        timeframe = 'current',
        page = 1,
        limit = 20
      } = req.query;

      // Validate pagination
      const parsedLimit = parseInt(limit);
      const parsedPage = parseInt(page);

      if (parsedLimit > 100) {
        return res.status(400).json({
          error: 'Invalid limit',
          message: 'Maximum limit is 100'
        });
      }

      // Get evidence
      const evidence = await this.evidenceCollector.retrieveEvidence({
        evidenceType: type,
        periodStart: this.parseTimeframe(timeframe),
        page: parsedPage,
        limit: parsedLimit,
        includeContent: false
      });

      res.json(evidence);

    } catch (error) {
      this.logger.error('Failed to get compliance evidence:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance evidence'
      });
    }
  }

  /**
   * Generate compliance report
   */
  async generateReport(req, res) {
    try {
      const {
        frameworks = this.config.frameworks,
        type = 'comprehensive',
        timeframe = 'monthly',
        includeEvidence = false,
        format = 'pdf',
        options = {}
      } = req.body;

      // Validate formats
      const validFormats = ['html', 'pdf', 'json', 'csv'];
      if (!validFormats.includes(format)) {
        return res.status(400).json({
          error: 'Invalid format',
          message: `Valid formats: ${validFormats.join(', ')}`
        });
      }

      // Generate report
      const report = await this.complianceReporter.generateComplianceReport({
        frameworks,
        type,
        timeframe,
        formats: [format],
        includeEvidence,
        ...options
      });

      // Return report data
      if (format === 'json') {
        return res.json(report);
      }

      // For other formats, return file
      const file = report.files.find(f => f.format === format);
      if (!file) {
        return res.status(500).json({
          error: 'Report generation failed',
          message: `Unable to generate ${format} format`
        });
      }

      res.setHeader('Content-Type', this.getContentType(format));
      res.setHeader('Content-Disposition', `attachment; filename="compliance_report.${format}"`);

      // In a real implementation, you would stream the file
      const fs = require('fs');
      if (fs.existsSync(file.path)) {
        const fileStream = fs.createReadStream(file.path);
        fileStream.pipe(res);
      } else {
        res.status(404).json({
          error: 'File not found',
          message: 'Generated report file not found'
        });
      }

    } catch (error) {
      this.logger.error('Failed to generate compliance report:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to generate compliance report'
      });
    }
  }

  /**
   * Get compliance metrics
   */
  async getMetrics(req, res) {
    try {
      const { framework, timeframe = '30d' } = req.query;

      let metrics = {
        timestamp: new Date(),
        timeframe,
        frameworks: {}
      };

      // Get metrics for specified framework or all frameworks
      const frameworksToCheck = framework ? [framework] : this.config.frameworks;

      for (const fw of frameworksToCheck) {
        metrics.frameworks[fw] = await this.getFrameworkMetrics(fw, timeframe);
      }

      // Calculate overall metrics
      metrics.overall = this.calculateOverallMetrics(metrics.frameworks);

      res.json(metrics);

    } catch (error) {
      this.logger.error('Failed to get compliance metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance metrics'
      });
    }
  }

  /**
   * Get compliance alerts
   */
  async getAlerts(req, res) {
    try {
      const { severity = 'all', status = 'active', page = 1, limit = 20 } = req.query;

      const alerts = await this.getComplianceAlerts({
        severity,
        status,
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 100)
      });

      res.json(alerts);

    } catch (error) {
      this.logger.error('Failed to get compliance alerts:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance alerts'
      });
    }
  }

  /**
   * Get remediation status
   */
  async getRemediationStatus(req, res) {
    try {
      const { framework, timeframe = '90d' } = req.query;

      const remediation = await this.getRemediationData(framework, timeframe);

      res.json(remediation);

    } catch (error) {
      this.logger.error('Failed to get remediation status:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve remediation status'
      });
    }
  }

  /**
   * Get compliance calendar
   */
  async getCalendar(req, res) {
    try {
      const { timeframe = '90d', includeAssessments = true, includeReports = true } = req.query;

      const calendar = {
        timeframe,
        assessments: [],
        reports: [],
        deadlines: []
      };

      if (includeAssessments === 'true') {
        calendar.assessments = await this.getUpcomingAssessments();
      }

      if (includeReports === 'true') {
        calendar.reports = await this.getScheduledReports(timeframe);
      }

      calendar.deadlines = await this.getComplianceDeadlines(timeframe);

      res.json(calendar);

    } catch (error) {
      this.logger.error('Failed to get compliance calendar:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance calendar'
      });
    }
  }

  /**
   * Get compliance dashboard data
   */
  async getDashboardData(req, res) {
    try {
      const dashboard = {
        timestamp: new Date(),
        overview: await this.getDashboardOverview(),
        metrics: await this.getDashboardMetrics(),
        alerts: await this.getDashboardAlerts(),
        trends: await this.getDashboardTrends(),
        kpis: await this.getDashboardKPIs()
      };

      res.json(dashboard);

    } catch (error) {
      this.logger.error('Failed to get dashboard data:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve dashboard data'
      });
    }
  }

  /**
   * Get compliance scorecard
   */
  async getScorecard(req, res) {
    try {
      const { framework, timeframe = 'monthly', categories = 'all' } = req.query;

      const scorecard = await this.generateComplianceScorecard(framework, timeframe, categories);

      res.json(scorecard);

    } catch (error) {
      this.logger.error('Failed to get compliance scorecard:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to generate compliance scorecard'
      });
    }
  }

  /**
   * Helper methods
   */
  async getFrameworkOverview(framework) {
    try {
      switch (framework) {
        case 'gdpr':
          return await this.getGDPRComplianceOverview();
        case 'soc2':
          return await this.getSOC2ComplianceOverview();
        default:
          throw new Error(`Unsupported framework: ${framework}`);
      }
    } catch (error) {
      this.logger.error(`Failed to get ${framework} overview:`, error);
      return {
        framework,
        error: error.message,
        overallScore: 0,
        status: 'error'
      };
    }
  }

  async getGDPRComplianceData(includeDetails) {
    try {
      const assessment = await this.gdprEngine.assessCompliance();

      const data = {
        framework: 'gdpr',
        assessmentDate: assessment.assessmentDate,
        overallScore: assessment.overallScore,
        complianceStatus: assessment.complianceStatus,
        principles: assessment.principles,
        dataSubjectRights: assessment.dataSubjectRights,
        breaches: assessment.breaches,
        consentCompliance: assessment.consentCompliance,
        retentionCompliance: assessment.retentionCompliance,
        securityMeasures: assessment.securityMeasures,
        findings: assessment.findings,
        recommendations: assessment.recommendations
      };

      if (includeDetails) {
        data.detailedAnalysis = await this.getGDPRDetailedAnalysis();
      }

      return data;

    } catch (error) {
      this.logger.error('Failed to get GDPR compliance data:', error);
      throw error;
    }
  }

  async getSOC2ComplianceData(includeDetails) {
    try {
      const assessment = await this.soc2Engine.assessCompliance();

      const data = {
        framework: 'soc2',
        type: this.soc2Engine.config.type,
        assessmentDate: assessment.assessmentDate,
        trustServices: assessment.trustServices,
        overallScore: assessment.overallScore,
        complianceStatus: assessment.complianceStatus,
        controlStatus: assessment.controlStatus,
        deficiencies: assessment.deficiencies,
        evidenceStatus: assessment.evidenceStatus,
        auditPeriod: assessment.auditPeriod,
        findings: assessment.findings,
        recommendations: assessment.recommendations
      };

      if (includeDetails) {
        data.detailedAnalysis = await this.getSOC2DetailedAnalysis();
      }

      return data;

    } catch (error) {
      this.logger.error('Failed to get SOC 2 compliance data:', error);
      throw error;
    }
  }

  async getGDPRComplianceOverview() {
    try {
      const assessment = await this.gdprEngine.assessCompliance();

      return {
        framework: 'gdpr',
        overallScore: assessment.overallScore,
        status: assessment.complianceStatus,
        criticalIssues: assessment.findings.filter(f => f.impact === 'critical'),
        principleScores: this.calculatePrincipleScores(assessment.principles),
        dataSubjectRightsScore: this.calculateDataSubjectRightsScore(assessment.dataSubjectRights),
        activeBreaches: assessment.breaches.length,
        consentComplianceRate: assessment.consentCompliance.complianceRate
      };

    } catch (error) {
      this.logger.error('Failed to get GDPR compliance overview:', error);
      throw error;
    }
  }

  async getSOC2ComplianceOverview() {
    try {
      const assessment = await this.soc2Engine.assessCompliance();

      return {
        framework: 'soc2',
        type: this.soc2Engine.config.type,
        overallScore: assessment.overallScore,
        status: assessment.complianceStatus,
        effectiveControls: assessment.controlStatus.effective,
        totalControls: assessment.controlStatus.total,
        activeDeficiencies: assessment.deficiencies.filter(d => d.status === 'open').length,
        trustServiceScores: this.calculateTrustServiceScores(assessment.trustServices),
        evidenceCoverage: assessment.evidenceStatus.coverage
      };

    } catch (error) {
      this.logger.error('Failed to get SOC 2 compliance overview:', error);
      throw error;
    }
  }

  async performFrameworkAssessment(framework, options) {
    try {
      switch (framework) {
        case 'gdpr':
          return await this.gdprEngine.assessCompliance();
        case 'soc2':
          return await this.soc2Engine.assessCompliance();
        default:
          throw new Error(`Unsupported framework: ${framework}`);
      }
    } catch (error) {
      this.logger.error(`Failed to perform ${framework} assessment:`, error);
      throw error;
    }
  }

  checkForComplianceAlerts(assessment) {
    // Check for compliance alerts based on thresholds
    if (assessment.overallScore < this.config.alertThresholds.complianceScore) {
      this.logger.warn(`Compliance score threshold exceeded: ${assessment.overallScore}`);
    }

    const criticalIssues = assessment.findings?.filter(f => f.impact === 'critical') || [];
    if (criticalIssues.length >= this.config.alertThresholds.criticalViolations) {
      this.logger.warn(`Critical issues threshold exceeded: ${criticalIssues.length}`);
    }
  }

  calculatePrincipleScores(principles) {
    const scores = {};
    for (const [key, principle] of Object.entries(principles)) {
      scores[key] = principle.score;
    }
    return scores;
  }

  calculateDataSubjectRightsScore(dataSubjectRights) {
    const scores = Object.values(dataSubjectRights).map(right => right.score);
    return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }

  calculateTrustServiceScores(trustServices) {
    const scores = {};
    for (const [key, service] of Object.entries(trustServices)) {
      scores[key] = service.score;
    }
    return scores;
  }

  async getFrameworkMetrics(framework, timeframe) {
    // Placeholder implementation
    return {
      framework,
      timeframe,
      overallScore: 85,
      categoryScores: {},
      trend: 'stable',
      lastAssessment: new Date()
    };
  }

  calculateOverallMetrics(frameworks) {
    const scores = Object.values(frameworks).map(f => f.overallScore);
    return {
      averageScore: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
      frameworkCount: scores.length
    };
  }

  async getComplianceAlerts(filters) {
    // Placeholder implementation
    return {
      alerts: [],
      total: 0,
      page: filters.page,
      totalPages: 0
    };
  }

  async getRemediationData(framework, timeframe) {
    // Placeholder implementation
    return {
      framework,
      timeframe,
      totalIssues: 0,
      openIssues: 0,
      resolvedIssues: 0,
      overdueIssues: 0,
      averageResolutionTime: 0
    };
  }

  async getUpcomingAssessments() {
    // Placeholder implementation
    return [];
  }

  async getScheduledReports(timeframe) {
    // Placeholder implementation
    return [];
  }

  async getComplianceDeadlines(timeframe) {
    // Placeholder implementation
    return [];
  }

  async getDashboardOverview() {
    // Placeholder implementation
    return {
      overallScore: 85,
      status: 'compliant',
      criticalIssues: 0,
      overdueTasks: 2
    };
  }

  async getDashboardMetrics() {
    // Placeholder implementation
    return {
      totalPolicies: 0,
      enforcedPolicies: 0,
      violationCount: 0,
      evidenceCount: 0
    };
  }

  async getDashboardAlerts() {
    // Placeholder implementation
    return [];
  }

  async getDashboardTrends() {
    // Placeholder implementation
    return {
      scoreTrend: 'improving',
      violationTrend: 'decreasing'
    };
  }

  async getDashboardKPIs() {
    // Placeholder implementation
    return {
      complianceScore: 85,
      assessmentCompletion: 95,
      remediationRate: 80,
      evidenceCoverage: 90
    };
  }

  async generateComplianceScorecard(framework, timeframe, categories) {
    // Placeholder implementation
    return {
      framework,
      timeframe,
      categories: {},
      overallScore: 85,
      status: 'compliant',
      details: {}
    };
  }

  async getGDPRDetailedAnalysis() {
    // Placeholder implementation
    return {
      detailedAnalysis: 'GDPR detailed analysis would go here'
    };
  }

  async getSOC2DetailedAnalysis() {
    // Placeholder implementation
    return {
      detailedAnalysis: 'SOC 2 detailed analysis would go here'
    };
  }

  parseTimeframe(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));

    switch (unit) {
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'w': return value * 7 * 24 * 60 * 60 * 1000;
      case 'm': return value * 30 * 24 * 60 * 60 * 1000;
      default: return 30 * 24 * 60 * 60 * 1000; // Default to 30 days
    }
  }

  getContentType(format) {
    const types = {
      'html': 'text/html',
      'pdf': 'application/pdf',
      'json': 'application/json',
      'csv': 'text/csv'
    };
    return types[format] || 'application/octet-stream';
  }

  generateAssessmentId() {
    return `assessment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  startAutomatedAssessments() {
    // Schedule automated assessments
    setInterval(async () => {
      try {
        for (const framework of this.config.frameworks) {
          const assessment = await this.performFrameworkAssessment(framework, {
            scope: 'full',
            scheduled: true,
            initiatedBy: 'automated_system',
            initiatedAt: new Date()
          });

          // Store result and check for alerts
          const assessmentId = this.generateAssessmentId();
          this.assessmentResults.set(assessmentId, assessment);
          this.checkForComplianceAlerts(assessment);
        }
      } catch (error) {
        this.logger.error('Automated assessment failed:', error);
      }
    }, this.config.assessmentInterval);
  }

  getCachedData(key) {
    if (!this.config.cachingEnabled) {
      return null;
    }

    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.config.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  setCachedData(key, data) {
    if (!this.config.cachingEnabled) {
      return;
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // Overview and framework endpoints
    router.get('/overview', this.getOverview.bind(this));
    router.get('/frameworks/:framework', this.getFrameworkCompliance.bind(this));

    // Assessment endpoints
    router.post('/assessments', this.performAssessment.bind(this));

    // Evidence endpoints
    router.get('/evidence', this.getEvidence.bind(this));

    // Reporting endpoints
    router.post('/reports/generate', this.generateReport.bind(this));

    // Metrics and analytics endpoints
    router.get('/metrics', this.getMetrics.bind(this));
    router.get('/alerts', this.getAlerts.bind(this));
    router.get('/remediation', this.getRemediationStatus.bind(this));
    router.get('/calendar', this.getCalendar.bind(this));

    // Dashboard endpoints
    router.get('/dashboard', this.getDashboardData.bind(this));
    router.get('/scorecard', this.getScorecard.bind(this));

    return router;
  }

  /**
   * Get controller statistics
   */
  getStatistics() {
    return {
      enabled: this.config.enabled,
      autoAssessment: this.config.autoAssessment,
      assessmentInterval: this.config.assessmentInterval,
      frameworks: this.config.frameworks,
      cacheSize: this.cache.size,
      assessmentResults: this.assessmentResults.size,
      components: {
        gdprEngine: this.gdprEngine.getStatistics(),
        soc2Engine: this.soc2Engine.getStatistics(),
        evidenceCollector: this.evidenceCollector.getStatistics(),
        complianceReporter: this.complianceReporter.getStatistics()
      }
    };
  }
}

module.exports = ComplianceController;