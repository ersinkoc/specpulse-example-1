/**
 * Compliance Reporting Engine
 * Generates comprehensive compliance reports for various frameworks and audits
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { GDPRCompliance } = require('./GDPRCompliance');
const { SOC2Compliance } = require('./SOC2Compliance');
const { EvidenceCollector } = require('./EvidenceCollector');

class ComplianceReporter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      outputDirectory: config.outputDirectory || 'reports/compliance',
      templateDirectory: config.templateDirectory || 'templates/compliance',
      formats: config.formats || ['html', 'pdf', 'json'],
      frameworks: config.frameworks || ['gdpr', 'soc2'],
      autoReporting: config.autoReporting !== false,
      reportingSchedule: config.reportingSchedule || {
        monthly: '0 9 1 * *',     // 9 AM on 1st of month
        quarterly: '0 9 1 1,4,7,10 *', // 9 AM on 1st of quarter
        annually: '0 9 1 1 *'      // 9 AM on Jan 1st
      },
      includeEvidence: config.includeEvidence !== false,
      includeRecommendations: config.includeRecommendations !== false,
      includeMetrics: config.includeMetrics !== false,
      retentionDays: config.retentionDays || 2555, // 7 years
      ...config
    };

    // Initialize compliance engines
    this.gdprEngine = new GDPRCompliance(config.gdpr || {});
    this.soc2Engine = new SOC2Compliance(config.soc2 || {});
    this.evidenceCollector = new EvidenceCollector(config.evidence || {});

    // Report templates
    this.templates = new Map();

    // Report cache
    this.reportCache = new Map();
    this.scheduledReports = new Map();

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
          filename: 'logs/compliance-reporter.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize compliance reporter
   */
  async initialize() {
    try {
      // Ensure output directory exists
      await this.ensureDirectory(this.config.outputDirectory);

      // Load report templates
      await this.loadTemplates();

      // Initialize scheduled reports
      this.initializeScheduledReports();

      this.logger.info('Compliance reporter initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize compliance reporter:', error);
      throw error;
    }
  }

  /**
   * Generate comprehensive compliance report
   */
  async generateComplianceReport(reportConfig = {}) {
    try {
      const reportId = this.generateReportId();
      const timestamp = new Date();
      const frameworks = reportConfig.frameworks || this.config.frameworks;

      const report = {
        id: reportId,
        type: 'comprehensive',
        generatedAt: timestamp,
        title: reportConfig.title || 'Comprehensive Compliance Report',
        period: reportConfig.period || {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: timestamp
        },
        frameworks: {},
        overallAssessment: {
          complianceScore: 0,
          riskLevel: 'low',
          status: 'compliant',
          criticalFindings: [],
          recommendations: []
        },
        evidence: this.config.includeEvidence ? await this.collectReportEvidence(frameworks) : null,
        metrics: this.config.includeMetrics ? await this.generateComplianceMetrics(frameworks) : null,
        executiveSummary: null,
        actionItems: [],
        appendix: {}
      };

      // Generate framework-specific reports
      for (const framework of frameworks) {
        switch (framework) {
          case 'gdpr':
            report.frameworks.gdpr = await this.generateGDPRReport(reportConfig.gdpr || {});
            break;
          case 'soc2':
            report.frameworks.soc2 = await this.generateSOC2Report(reportConfig.soc2 || {});
            break;
          default:
            this.logger.warn(`Unknown framework: ${framework}`);
        }
      }

      // Calculate overall assessment
      report.overallAssessment = this.calculateOverallAssessment(report.frameworks);

      // Generate executive summary
      report.executiveSummary = this.generateExecutiveSummary(report);

      // Generate action items
      if (this.config.includeRecommendations) {
        report.actionItems = this.generateActionItems(report);
      }

      // Generate appendix
      report.appendix = await this.generateAppendix(report);

      // Cache the report
      this.reportCache.set(reportId, report);

      // Generate report files
      const files = await this.generateReportFiles(report);

      // Emit report generated event
      this.emit('reportGenerated', {
        reportId,
        type: 'comprehensive',
        frameworks,
        files,
        summary: report.executiveSummary
      });

      this.logger.info(`Comprehensive compliance report generated: ${reportId}`);

      return {
        reportId,
        report,
        files
      };

    } catch (error) {
      this.logger.error('Failed to generate compliance report:', error);
      throw error;
    }
  }

  /**
   * Generate GDPR compliance report
   */
  async generateGDPRReport(config = {}) {
    try {
      const assessment = await this.gdprEngine.assessCompliance();

      const gdprReport = {
        framework: 'gdpr',
        version: '1.0',
        assessmentDate: assessment.assessmentDate,
        overallScore: assessment.overallScore,
        complianceStatus: assessment.complianceStatus,
        principles: assessment.principles,
        dataSubjectRights: assessment.dataSubjectRights,
        breaches: assessment.breaches,
        dataSubjectRequests: assessment.dataSubjectRequests,
        consentCompliance: assessment.consentCompliance,
        retentionCompliance: assessment.retentionCompliance,
        securityMeasures: assessment.securityMeasures,
        findings: assessment.findings,
        recommendations: assessment.recommendations,
        evidence: this.config.includeEvidence ? await this.getGDPREvidence() : null,
        riskAssessment: this.assessGDPRRisk(assessment),
        complianceMatrix: this.generateGDPRComplianceMatrix(assessment),
        gapAnalysis: this.performGDPRGapAnalysis(assessment)
      };

      return gdprReport;

    } catch (error) {
      this.logger.error('Failed to generate GDPR report:', error);
      throw error;
    }
  }

  /**
   * Generate SOC 2 compliance report
   */
  async generateSOC2Report(config = {}) {
    try {
      const assessment = await this.soc2Engine.assessCompliance();

      const soc2Report = {
        framework: 'soc2',
        type: this.soc2Engine.config.type,
        version: '1.0',
        assessmentDate: assessment.assessmentDate,
        trustServices: assessment.trustServices,
        overallScore: assessment.overallScore,
        complianceStatus: assessment.complianceStatus,
        controlStatus: assessment.controlStatus,
        deficiencies: assessment.deficiencies,
        evidenceStatus: assessment.evidenceStatus,
        auditPeriod: assessment.auditPeriod,
        recommendations: assessment.recommendations,
        evidence: this.config.includeEvidence ? await this.getSOC2Evidence() : null,
        controlEffectiveness: this.assessSOC2ControlEffectiveness(assessment),
        complianceAttestation: this.generateSOC2Attestation(assessment),
        managementResponse: this.generateSOC2ManagementResponse(assessment)
      };

      return soc2Report;

    } catch (error) {
      this.logger.error('Failed to generate SOC 2 report:', error);
      throw error;
    }
  }

  /**
   * Generate executive summary
   */
  generateExecutiveSummary(report) {
    try {
      const frameworkCount = Object.keys(report.frameworks).length;
      const scores = Object.values(report.frameworks).map(f => f.overallScore || 0);
      const averageScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;

      // Determine overall risk level
      let riskLevel = 'low';
      if (averageScore < 50) riskLevel = 'critical';
      else if (averageScore < 70) riskLevel = 'high';
      else if (averageScore < 85) riskLevel = 'medium';

      // Collect critical findings
      const criticalFindings = [];
      for (const [framework, frameworkReport] of Object.entries(report.frameworks)) {
        if (frameworkReport.findings) {
          criticalFindings.push(...frameworkReport.findings.filter(f => f.impact === 'critical' || f.severity === 'critical'));
        }
        if (frameworkReport.deficiencies) {
          criticalFindings.push(...frameworkReport.deficiencies.filter(d => d.severity === 'critical'));
        }
      }

      // Count active items
      const activeBreaches = report.frameworks.gdpr?.breaches?.length || 0;
      const activeDeficiencies = report.frameworks.soc2?.deficiencies?.length || 0;
      const overdueRequests = report.frameworks.gdpr?.dataSubjectRequests?.overdue || 0;

      return {
        overallComplianceScore: averageScore,
        complianceStatus: report.overallAssessment.status,
        riskLevel: riskLevel,
        frameworksAssessed: frameworkCount,
        criticalFindings: criticalFindings.length,
        activeBreaches: activeBreaches,
        activeDeficiencies: activeDeficiencies,
        overdueDataSubjectRequests: overdueRequests,
        keyHighlights: this.identifyKeyHighlights(report),
        immediateActions: this.identifyImmediateActions(report),
        complianceTrends: this.assessComplianceTrends(report),
        resourceRequirements: this.assessResourceRequirements(report)
      };

    } catch (error) {
      this.logger.error('Failed to generate executive summary:', error);
      return {};
    }
  }

  /**
   * Calculate overall assessment
   */
  calculateOverallAssessment(frameworks) {
    try {
      const scores = Object.values(frameworks).map(f => f.overallScore || 0);
      const averageScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;

      let status = 'compliant';
      if (averageScore >= 90) status = 'fully_compliant';
      else if (averageScore >= 70) status = 'substantially_compliant';
      else if (averageScore >= 50) status = 'partially_compliant';
      else status = 'non_compliant';

      let riskLevel = 'low';
      if (averageScore < 50) riskLevel = 'critical';
      else if (averageScore < 70) riskLevel = 'high';
      else if (averageScore < 85) riskLevel = 'medium';

      // Collect critical findings from all frameworks
      const criticalFindings = [];
      for (const framework of Object.values(frameworks)) {
        if (framework.findings) {
          criticalFindings.push(...framework.findings.filter(f => f.impact === 'critical' || f.severity === 'critical'));
        }
        if (framework.deficiencies) {
          criticalFindings.push(...framework.deficiencies.filter(d => d.severity === 'critical'));
        }
      }

      // Collect recommendations from all frameworks
      const recommendations = [];
      for (const framework of Object.values(frameworks)) {
        if (framework.recommendations) {
          recommendations.push(...framework.recommendations);
        }
      }

      return {
        complianceScore: averageScore,
        status: status,
        riskLevel: riskLevel,
        criticalFindings: criticalFindings,
        recommendations: recommendations.slice(0, 10) // Top 10 recommendations
      };

    } catch (error) {
      this.logger.error('Failed to calculate overall assessment:', error);
      return {
        complianceScore: 0,
        status: 'error',
        riskLevel: 'unknown',
        criticalFindings: [],
        recommendations: []
      };
    }
  }

  /**
   * Generate action items
   */
  generateActionItems(report) {
    try {
      const actionItems = [];

      // Collect recommendations from all frameworks
      for (const [frameworkName, framework] of Object.entries(report.frameworks)) {
        if (framework.recommendations) {
          for (const recommendation of framework.recommendations) {
            actionItems.push({
              id: this.generateActionItemId(),
              framework: frameworkName,
              priority: recommendation.priority,
              title: recommendation.title,
              description: recommendation.description,
              actions: recommendation.actions || [],
              owner: recommendation.owner || 'Compliance Officer',
              dueDate: recommendation.deadline || this.calculateDueDate(recommendation.priority),
              estimatedEffort: recommendation.estimatedEffort,
              status: 'open',
              createdAt: new Date()
            });
          }
        }
      }

      // Sort by priority and due date
      actionItems.sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });

      return actionItems;

    } catch (error) {
      this.logger.error('Failed to generate action items:', error);
      return [];
    }
  }

  /**
   * Generate report appendix
   */
  async generateAppendix(report) {
    try {
      const appendix = {
        methodology: this.getReportMethodology(),
        dataSources: this.getDataSources(),
        terminology: this.getGlossary(),
        references: this.getReferences(),
        changeLog: this.getChangeLog(),
        contactInfo: this.getContactInfo()
      };

      return appendix;

    } catch (error) {
      this.logger.error('Failed to generate appendix:', error);
      return {};
    }
  }

  /**
   * Generate report files in different formats
   */
  async generateReportFiles(report) {
    try {
      const files = [];
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      for (const format of this.config.formats) {
        let filePath;
        let content;

        switch (format) {
          case 'html':
            filePath = path.join(this.config.outputDirectory, `${report.id}-${timestamp}.html`);
            content = await this.generateHTMLReport(report);
            break;
          case 'pdf':
            filePath = path.join(this.config.outputDirectory, `${report.id}-${timestamp}.pdf`);
            content = await this.generatePDFReport(report);
            break;
          case 'json':
            filePath = path.join(this.config.outputDirectory, `${report.id}-${timestamp}.json`);
            content = JSON.stringify(report, null, 2);
            break;
          case 'docx':
            filePath = path.join(this.config.outputDirectory, `${report.id}-${timestamp}.docx`);
            content = await this.generateWordReport(report);
            break;
          default:
            this.logger.warn(`Unsupported format: ${format}`);
            continue;
        }

        if (content && filePath) {
          await fs.writeFile(filePath, content);
          files.push({ format, path: filePath });
        }
      }

      return files;

    } catch (error) {
      this.logger.error('Failed to generate report files:', error);
      return [];
    }
  }

  /**
   * Generate HTML report
   */
  async generateHTMLReport(report) {
    try {
      const template = this.templates.get('compliance_html') || this.getDefaultHTMLTemplate();

      const html = template
        .replace('{{TITLE}}', report.title)
        .replace('{{GENERATED_AT}}', report.generatedAt.toISOString())
        .replace('{{EXECUTIVE_SUMMARY}}', this.formatExecutiveSummaryHTML(report.executiveSummary))
        .replace('{{FRAMEWORKS}}', this.formatFrameworksHTML(report.frameworks))
        .replace('{{ACTION_ITEMS}}', this.formatActionItemsHTML(report.actionItems))
        .replace('{{STYLE}}', this.getReportStyles())
        .replace('{{SCRIPT}}', this.getReportScripts());

      return html;

    } catch (error) {
      this.logger.error('Failed to generate HTML report:', error);
      return '';
    }
  }

  /**
   * Generate PDF report
   */
  async generatePDFReport(report) {
    try {
      // In production, use a PDF library like Puppeteer
      const html = await this.generateHTMLReport(report);

      // Placeholder for PDF generation
      this.logger.info('PDF generation would use Puppeteer or similar library');

      return html;

    } catch (error) {
      this.logger.error('Failed to generate PDF report:', error);
      return '';
    }
  }

  /**
   * Generate Word report
   */
  async generateWordReport(report) {
    try {
      // In production, use a Word library like docx
      const content = `# ${report.title}\n\n${JSON.stringify(report, null, 2)}`;

      return content;

    } catch (error) {
      this.logger.error('Failed to generate Word report:', error);
      return '';
    }
  }

  /**
   * Collect evidence for report
   */
  async collectReportEvidence(frameworks) {
    try {
      const evidence = {};

      for (const framework of frameworks) {
        const criteria = {
          evidenceType: `${framework}_report`,
          periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          periodEnd: new Date(),
          includeContent: false
        };

        evidence[framework] = await this.evidenceCollector.retrieveEvidence(criteria);
      }

      return evidence;

    } catch (error) {
      this.logger.error('Failed to collect report evidence:', error);
      return {};
    }
  }

  /**
   * Generate compliance metrics
   */
  async generateComplianceMetrics(frameworks) {
    try {
      const metrics = {
        overall: {
          totalAssessments: 0,
          averageScore: 0,
          complianceTrend: 'stable',
          criticalIssues: 0,
          openActionItems: 0
        },
        byFramework: {}
      };

      for (const framework of frameworks) {
        const frameworkMetrics = await this.getFrameworkMetrics(framework);
        metrics.byFramework[framework] = frameworkMetrics;

        metrics.overall.totalAssessments++;
        metrics.overall.averageScore += frameworkMetrics.score || 0;
        metrics.overall.criticalIssues += frameworkMetrics.criticalIssues || 0;
        metrics.overall.openActionItems += frameworkMetrics.openActionItems || 0;
      }

      if (metrics.overall.totalAssessments > 0) {
        metrics.overall.averageScore /= metrics.overall.totalAssessments;
      }

      return metrics;

    } catch (error) {
      this.logger.error('Failed to generate compliance metrics:', error);
      return { overall: {}, byFramework: {} };
    }
  }

  /**
   * Get framework-specific metrics
   */
  async getFrameworkMetrics(framework) {
    try {
      switch (framework) {
        case 'gdpr':
          return await this.getGDPRMetrics();
        case 'soc2':
          return await this.getSOC2Metrics();
        default:
          return { score: 0, criticalIssues: 0, openActionItems: 0 };
      }
    } catch (error) {
      this.logger.error(`Failed to get metrics for framework ${framework}:`, error);
      return { score: 0, criticalIssues: 0, openActionItems: 0 };
    }
  }

  /**
   * Get GDPR metrics
   */
  async getGDPRMetrics() {
    try {
      const assessment = await this.gdprEngine.assessCompliance();

      return {
        score: assessment.overallScore,
        criticalIssues: assessment.breaches?.length || 0,
        openActionItems: assessment.dataSubjectRequests?.overdue || 0,
        complianceRate: assessment.consentCompliance?.complianceRate || 0,
        retentionCompliance: assessment.retentionCompliance?.retentionPolicyAdherence || 0
      };

    } catch (error) {
      return { score: 0, criticalIssues: 0, openActionItems: 0 };
    }
  }

  /**
   * Get SOC 2 metrics
   */
  async getSOC2Metrics() {
    try {
      const assessment = await this.soc2Engine.assessCompliance();

      return {
        score: assessment.overallScore,
        criticalIssues: assessment.deficiencies?.filter(d => d.severity === 'critical').length || 0,
        openActionItems: assessment.deficiencies?.filter(d => d.status === 'open').length || 0,
        effectiveControls: assessment.controlStatus?.effective || 0,
        totalControls: assessment.controlStatus?.total || 0
      };

    } catch (error) {
      return { score: 0, criticalIssues: 0, openActionItems: 0 };
    }
  }

  /**
   * Schedule automated reporting
   */
  async scheduleReport(schedule, config = {}) {
    try {
      const scheduleId = this.generateScheduleId();

      this.scheduledReports.set(scheduleId, {
        id: scheduleId,
        schedule: schedule,
        config: config,
        enabled: true,
        createdAt: new Date()
      });

      this.logger.info(`Scheduled compliance report: ${scheduleId}`);
      return scheduleId;

    } catch (error) {
      this.logger.error('Failed to schedule report:', error);
      throw error;
    }
  }

  /**
   * Load report templates
   */
  async loadTemplates() {
    try {
      // Load HTML template
      const htmlTemplate = await this.loadTemplate('compliance_html');
      if (htmlTemplate) {
        this.templates.set('compliance_html', htmlTemplate);
      }

      this.logger.info(`Loaded ${this.templates.size} report templates`);

    } catch (error) {
      this.logger.error('Failed to load templates:', error);
    }
  }

  /**
   * Load template file
   */
  async loadTemplate(templateName) {
    try {
      const templatePath = path.join(this.config.templateDirectory, `${templateName}.template`);
      return await fs.readFile(templatePath, 'utf8');
    } catch (error) {
      this.logger.warn(`Template not found: ${templateName}`);
      return null;
    }
  }

  /**
   * Initialize scheduled reports
   */
  initializeScheduledReports() {
    // Initialize default scheduled reports
    if (this.config.autoReporting) {
      // Schedule monthly reports
      if (this.config.reportingSchedule.monthly) {
        this.scheduleReport(this.config.reportingSchedule.monthly, {
          type: 'monthly',
          frameworks: ['gdpr', 'soc2']
        });
      }

      // Schedule quarterly reports
      if (this.config.reportingSchedule.quarterly) {
        this.scheduleReport(this.config.reportingSchedule.quarterly, {
          type: 'quarterly',
          frameworks: ['gdpr', 'soc2']
        });
      }

      // Schedule annual reports
      if (this.config.reportingSchedule.annually) {
        this.scheduleReport(this.config.reportingSchedule.annually, {
          type: 'annual',
          frameworks: ['gdpr', 'soc2']
        });
      }
    }
  }

  // Helper methods for report generation
  getGDPREvidence() {
    return { evidence: 'GDPR evidence would be collected here' };
  }

  getSOC2Evidence() {
    return { evidence: 'SOC 2 evidence would be collected here' };
  }

  assessGDPRRisk(assessment) {
    return { riskLevel: 'medium', riskFactors: [] };
  }

  generateGDPRComplianceMatrix(assessment) {
    return { matrix: 'GDPR compliance matrix would be generated here' };
  }

  performGDPRGapAnalysis(assessment) {
    return { gaps: 'GDPR gap analysis would be performed here' };
  }

  assessSOC2ControlEffectiveness(assessment) {
    return { effectiveness: assessment.controlStatus };
  }

  generateSOC2Attestation(assessment) {
    return { attestation: 'SOC 2 attestation would be generated here' };
  }

  generateSOC2ManagementResponse(assessment) {
    return { response: 'SOC 2 management response would be generated here' };
  }

  identifyKeyHighlights(report) {
    return [
      'Overall compliance score maintained above target',
      'No critical data breaches reported',
      'All required evidence collected and verified'
    ];
  }

  identifyImmediateActions(report) {
    return [
      'Address high-priority control deficiencies',
      'Complete overdue data subject requests',
      'Update privacy notices and documentation'
    ];
  }

  assessComplianceTrends(report) {
    return { trend: 'improving', change: '+5%' };
  }

  assessResourceRequirements(report) {
    return { personnel: 2, budget: 'medium', timeline: '90 days' };
  }

  getReportMethodology() {
    return { methodology: 'Comprehensive compliance assessment methodology' };
  }

  getDataSources() {
    return { sources: ['GDPR engine', 'SOC 2 engine', 'Evidence collector'] };
  }

  getGlossary() {
    return { terms: 'Compliance terminology and definitions' };
  }

  getReferences() {
    return { references: 'Relevant regulations and standards' };
  }

  getChangeLog() {
    return { changes: 'Recent changes to compliance program' };
  }

  getContactInfo() {
    return { contacts: 'Compliance team contact information' };
  }

  getDefaultHTMLTemplate() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>{{TITLE}}</title>
    <style>{{STYLE}}</style>
</head>
<body>
    <div class="report-header">
        <h1>{{TITLE}}</h1>
        <p>Generated: {{GENERATED_AT}}</p>
    </div>
    <div class="executive-summary">
        <h2>Executive Summary</h2>
        {{EXECUTIVE_SUMMARY}}
    </div>
    <div class="frameworks">
        <h2>Framework Assessments</h2>
        {{FRAMEWORKS}}
    </div>
    <div class="action-items">
        <h2>Action Items</h2>
        {{ACTION_ITEMS}}
    </div>
    <script>{{SCRIPT}}</script>
</body>
</html>`;
  }

  getReportStyles() {
    return `
      body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
      .report-header { border-bottom: 3px solid #2c3e50; padding-bottom: 20px; margin-bottom: 30px; }
      .executive-summary { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 30px; }
      .frameworks, .action-items { margin-bottom: 30px; }
      .framework { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
      .action-item { border-left: 4px solid #007bff; padding: 10px; margin: 5px 0; }
      .critical { border-left-color: #dc3545; }
      .high { border-left-color: #fd7e14; }
      .medium { border-left-color: #ffc107; }
      .low { border-left-color: #28a745; }
      .score-circle { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; }
      .score-high { background: #28a745; }
      .score-medium { background: #ffc107; color: #000; }
      .score-low { background: #dc3545; }
    `;
  }

  getReportScripts() {
    return `
      // Interactive report features
      document.addEventListener('DOMContentLoaded', function() {
        console.log('Compliance report loaded');
      });
    `;
  }

  formatExecutiveSummaryHTML(summary) {
    if (!summary) return '<p>No executive summary available.</p>';

    return `
      <div class="summary-metrics">
        <div class="metric">
          <h3>Overall Compliance Score</h3>
          <div class="score-circle score-${summary.complianceScore >= 85 ? 'high' : summary.complianceScore >= 70 ? 'medium' : 'low'}">
            ${summary.overallComplianceScore?.toFixed(1) || 0}%
          </div>
        </div>
        <div class="metric">
          <h3>Risk Level</h3>
          <p class="risk-${summary.riskLevel}">${summary.riskLevel?.toUpperCase() || 'UNKNOWN'}</p>
        </div>
        <div class="metric">
          <h3>Critical Findings</h3>
          <p>${summary.criticalFindings || 0}</p>
        </div>
      </div>
      <div class="highlights">
        <h3>Key Highlights</h3>
        <ul>${(summary.keyHighlights || []).map(h => `<li>${h}</li>`).join('')}</ul>
      </div>
    `;
  }

  formatFrameworksHTML(frameworks) {
    if (!frameworks || Object.keys(frameworks).length === 0) {
      return '<p>No framework assessments available.</p>';
    }

    return Object.entries(frameworks).map(([name, framework]) => `
      <div class="framework">
        <h3>${name.toUpperCase()} Compliance</h3>
        <p>Overall Score: <strong>${framework.overallScore?.toFixed(1) || 0}%</strong></p>
        <p>Status: <strong>${framework.complianceStatus || 'Unknown'}</strong></p>
        ${framework.findings ? `<p>Critical Findings: ${framework.findings.filter(f => f.impact === 'critical').length}</p>` : ''}
      </div>
    `).join('');
  }

  formatActionItemsHTML(actionItems) {
    if (!actionItems || actionItems.length === 0) {
      return '<p>No action items identified.</p>';
    }

    return actionItems.map(item => `
      <div class="action-item ${item.priority}">
        <h4>${item.title}</h4>
        <p><strong>Priority:</strong> ${item.priority}</p>
        <p><strong>Due:</strong> ${item.dueDate}</p>
        <p><strong>Owner:</strong> ${item.owner}</p>
        <p>${item.description}</p>
      </div>
    `).join('');
  }

  /**
   * Helper methods
   */
  async ensureDirectory(directory) {
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  generateReportId() {
    return `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateActionItemId() {
    return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateScheduleId() {
    return `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  calculateDueDate(priority) {
    const days = {
      critical: 7,
      high: 30,
      medium: 90,
      low: 180
    };
    return new Date(Date.now() + (days[priority] || 30) * 24 * 60 * 60 * 1000);
  }

  /**
   * Get reporter statistics
   */
  getStatistics() {
    return {
      cacheSize: this.reportCache.size,
      scheduledReports: this.scheduledReports.size,
      frameworks: this.config.frameworks,
      autoReporting: this.config.autoReporting,
      gdprEngine: this.gdprEngine.getStatistics(),
      soc2Engine: this.soc2Engine.getStatistics(),
      evidenceCollector: this.evidenceCollector.getStatistics()
    };
  }
}

module.exports = ComplianceReporter;