/**
 * Security Incident Manager
 * Comprehensive incident management with workflow automation and SLA tracking
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const winston = require('winston');
const SecurityIncident = require('../../../models/security/SecurityIncident');
const { secureDatabase } = require('../../../config/database-security');

class IncidentManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      autoAssign: config.autoAssign !== false,
      escalationEnabled: config.escalationEnabled !== false,
      notificationChannels: config.notificationChannels || ['email', 'webhook'],
      slaTargets: config.slaTargets || {
        critical: { response: 3600, resolution: 14400 }, // 1h response, 4h resolution
        high: { response: 14400, resolution: 43200 }, // 4h response, 12h resolution
        medium: { response: 43200, resolution: 172800 }, // 12h response, 48h resolution
        low: { response: 172800, resolution: 604800 } // 48h response, 7 days resolution
      },
      workflow: config.workflow || {
        autoCreate: true,
        autoAssign: true,
        autoEscalate: true,
        requireApproval: true
      },
      ...config
    };

    // Active incidents
    this.incidents = new Map();
    this.workflows = new Map();

    // Assignment rules
    this.assignmentRules = [];

    // Statistics
    this.statistics = {
      totalIncidents: 0,
      byStatus: { open: 0, investigating: 0, contained: 0, resolved: 0, closed: 0 },
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byType: new Map(),
      averageResolutionTime: 0,
      slaCompliance: 0
    };

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
          filename: 'logs/incident-manager.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize incident manager
   */
  async initialize() {
    try {
      // Initialize database connection
      await secureDatabase.initialize();

      // Setup default assignment rules
      this.setupDefaultAssignmentRules();

      // Start periodic checks
      this.startPeriodicChecks();

      this.logger.info('Incident manager initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize incident manager:', error);
      throw error;
    }
  }

  /**
   * Setup default assignment rules
   */
  setupDefaultAssignmentRules() {
    this.assignmentRules = [
      {
        condition: (incident) => incident.severity === 'critical',
        assignTo: 'security-lead',
        priority: 1,
        autoEscalate: true
      },
      {
        condition: (incident) => incident.incidentType === 'data_breach',
        assignTo: 'data-protection-officer',
        priority: 1,
        autoEscalate: true
      },
      {
        condition: (incident) => incident.incidentType === 'malware',
        assignTo: 'security-analyst',
        priority: 2
      },
      {
        condition: (incident) => incident.incidentType === 'phishing',
        assignTo: 'security-analyst',
        priority: 2
      },
      {
        condition: (incident) => incident.severity === 'high',
        assignTo: 'security-senior',
        priority: 3
      }
    ];
  }

  /**
   * Create new security incident
   */
  async createIncident(incidentData) {
    try {
      // Create incident object
      const incident = SecurityIncident.fromAlert(incidentData);

      // Validate incident
      const validation = incident.validate();
      if (!validation.isValid) {
        throw new Error(`Invalid incident data: ${validation.errors.join(', ')}`);
      }

      // Auto-assign if enabled
      if (this.config.autoAssign) {
        this.autoAssignIncident(incident);
      }

      // Create workflow for incident
      const workflow = this.createWorkflow(incident);
      this.workflows.set(incident.id, workflow);

      // Save to database
      await this.saveIncident(incident);

      // Add to active incidents
      this.incidents.set(incident.id, incident);

      // Update statistics
      this.updateStatistics(incident);

      // Emit event
      this.emit('incidentCreated', incident);

      // Send notifications
      await this.sendIncidentNotification(incident, 'created');

      this.logger.info('Security incident created:', {
        id: incident.id,
        severity: incident.severity,
        type: incident.incidentType,
        assignedTo: incident.assignedTo
      });

      return incident.id;

    } catch (error) {
      this.logger.error('Failed to create incident:', error);
      throw error;
    }
  }

  /**
   * Auto-assign incident based on rules
   */
  autoAssignIncident(incident) {
    const applicableRules = this.assignmentRules
      .filter(rule => rule.condition(incident))
      .sort((a, b) => a.priority - b.priority);

    if (applicableRules.length > 0) {
      const rule = applicableRules[0];
      incident.assignedTo = rule.assignTo;
      incident.assignedAt = new Date();
      incident.assignmentRule = rule;

      this.logger.debug(`Auto-assigned incident ${incident.id} to ${rule.assignTo}`);
    }
  }

  /**
   * Create workflow for incident
   */
  createWorkflow(incident) {
    const slaTarget = this.config.slaTargets[incident.severity];

    const workflow = {
      incidentId: incident.id,
      currentStep: 'created',
      steps: [
        {
          name: 'created',
          status: 'completed',
          completedAt: new Date(),
          notes: 'Incident created'
        },
        {
          name: 'investigation',
          status: 'pending',
          targetTime: new Date(Date.now() + (slaTarget?.response * 1000 || 3600000)),
          notes: 'Begin investigation'
        },
        {
          name: 'containment',
          status: 'pending',
          targetTime: new Date(Date.now() + (slaTarget?.response * 2000 || 7200000)),
          notes: 'Contain the incident'
        },
        {
          name: 'resolution',
          status: 'pending',
          targetTime: new Date(Date.now() + (slaTarget?.resolution * 1000 || 14400000)),
          notes: 'Resolve the incident'
        },
        {
          name: 'closure',
          status: 'pending',
          notes: 'Close incident and document lessons learned'
        }
      ],
      slaTarget,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return workflow;
  }

  /**
   * Update incident status
   */
  async updateIncidentStatus(incidentId, status, updates = {}) {
    try {
      const incident = this.incidents.get(incidentId);
      if (!incident) {
        throw new Error(`Incident ${incidentId} not found`);
      }

      const previousStatus = incident.status;
      incident.status = status;
      incident.updatedAt = new Date();

      // Apply updates
      Object.assign(incident, updates);

      // Update workflow
      await this.updateWorkflow(incidentId, status);

      // Save to database
      await this.saveIncident(incident);

      // Update statistics
      this.updateStatistics(incident);

      // Emit event
      this.emit('incidentUpdated', {
        incidentId,
        previousStatus,
        newStatus: status,
        updates
      });

      // Send notifications for status changes
      if (previousStatus !== status) {
        await this.sendIncidentNotification(incident, 'status_changed', {
          previousStatus,
          newStatus: status
        });
      }

      this.logger.info(`Incident ${incidentId} status updated to ${status}`);

      return true;

    } catch (error) {
      this.logger.error('Failed to update incident status:', error);
      throw error;
    }
  }

  /**
   * Update workflow step
   */
  async updateWorkflow(incidentId, status) {
    const workflow = this.workflows.get(incidentId);
    if (!workflow) {
      return;
    }

    const stepMapping = {
      'investigating': 'investigation',
      'contained': 'containment',
      'resolved': 'resolution',
      'closed': 'closure'
    };

    const stepName = stepMapping[status];
    if (stepName) {
      const step = workflow.steps.find(s => s.name === stepName);
      if (step && step.status === 'pending') {
        step.status = 'completed';
        step.completedAt = new Date();
        workflow.currentStep = stepName;
        workflow.updatedAt = new Date();

        // Check for SLA breaches
        if (step.targetTime && new Date() > step.targetTime) {
          this.handleSLABreach(incidentId, stepName, step.targetTime);
        }
      }
    }
  }

  /**
   * Handle SLA breach
   */
  async handleSLABreach(incidentId, stepName, targetTime) {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      return;
    }

    const breach = {
      incidentId,
      stepName,
      targetTime,
      actualTime: new Date(),
      breachDuration: new Date() - targetTime,
      severity: this.getSLABreachSeverity(incident.severity, stepName)
    };

    this.emit('slaBreach', breach);

    // Send escalation notification
    await this.sendIncidentNotification(incident, 'sla_breach', breach);

    this.logger.warn(`SLA breach for incident ${incidentId}`, breach);
  }

  /**
   * Get SLA breach severity
   */
  getSLABreachSeverity(incidentSeverity, stepName) {
    const severityMap = {
      critical: {
        investigation: 'critical',
        containment: 'critical',
        resolution: 'critical'
      },
      high: {
        investigation: 'high',
        containment: 'critical',
        resolution: 'high'
      },
      medium: {
        investigation: 'medium',
        containment: 'high',
        resolution: 'medium'
      },
      low: {
        investigation: 'low',
        containment: 'medium',
        resolution: 'low'
      }
    };

    return severityMap[incidentSeverity]?.[stepName] || 'medium';
  }

  /**
   * Add note to incident
   */
  async addIncidentNote(incidentId, note, author) {
    try {
      const incident = this.incidents.get(incidentId);
      if (!incident) {
        throw new Error(`Incident ${incidentId} not found`);
      }

      if (!incident.notes) {
        incident.notes = [];
      }

      const noteObj = {
        id: crypto.randomUUID(),
        content: note,
        author: author,
        timestamp: new Date(),
        visibleToCustomer: false
      };

      incident.notes.push(noteObj);
      incident.updatedAt = new Date();

      // Save to database
      await this.saveIncident(incident);

      // Update in memory
      this.incidents.set(incidentId, incident);

      // Emit event
      this.emit('noteAdded', {
        incidentId,
        note: noteObj
      });

      this.logger.info(`Note added to incident ${incidentId}`);

      return noteObj.id;

    } catch (error) {
      this.logger.error('Failed to add note to incident:', error);
      throw error;
    }
  }

  /**
   * Get incident by ID
   */
  getIncident(incidentId) {
    return this.incidents.get(incidentId);
  }

  /**
   * Get incidents by criteria
   */
  getIncidents(criteria = {}) {
    let incidents = Array.from(this.incidents.values());

    // Filter by status
    if (criteria.status) {
      incidents = incidents.filter(i => i.status === criteria.status);
    }

    // Filter by severity
    if (criteria.severity) {
      incidents = incidents.filter(i => i.severity === criteria.severity);
    }

    // Filter by type
    if (criteria.type) {
      incidents = incidents.filter(i => i.incidentType === criteria.type);
    }

    // Filter by assigned user
    if (criteria.assignedTo) {
      incidents = incidents.filter(i => i.assignedTo === criteria.assignedTo);
    }

    // Filter by date range
    if (criteria.since) {
      const since = new Date(criteria.since);
      incidents = incidents.filter(i => i.detectedAt >= since);
    }

    if (criteria.until) {
      const until = new Date(criteria.until);
      incidents = incidents.filter(i => i.detectedAt <= until);
    }

    // Sort by detected date (newest first)
    incidents.sort((a, b) => b.detectedAt - a.detectedAt);

    // Apply limit
    if (criteria.limit) {
      incidents = incidents.slice(0, criteria.limit);
    }

    return incidents;
  }

  /**
   * Get incident statistics
   */
  getStatistics() {
    // Calculate average resolution time
    const resolvedIncidents = Array.from(this.incidents.values())
      .filter(i => i.status === 'resolved' || i.status === 'closed');

    let avgResolutionTime = 0;
    if (resolvedIncidents.length > 0) {
      const totalTime = resolvedIncidents.reduce((sum, i) => {
        return sum + (i.resolvedAt ? i.resolvedAt - i.detectedAt : 0);
      }, 0);
      avgResolutionTime = totalTime / resolvedIncidents.length;
    }

    // Calculate SLA compliance
    const slaCompliant = resolvedIncidents.filter(i => {
      const workflow = this.workflows.get(i.id);
      if (!workflow || !workflow.slaTarget) {
        return true;
      }

      const resolutionStep = workflow.steps.find(s => s.name === 'resolution');
      if (!resolutionStep || !resolutionStep.completedAt) {
        return true;
      }

      return resolutionStep.completedAt <= resolutionStep.targetTime;
    }).length;

    const slaCompliance = resolvedIncidents.length > 0 ?
      (slaCompliant / resolvedIncidents.length) * 100 : 100;

    return {
      ...this.statistics,
      averageResolutionTime: Math.round(avgResolutionTime / 1000 / 60), // minutes
      slaCompliance: Math.round(slaCompliance * 100) / 100, // percentage
      activeIncidents: this.incidents.size,
      activeWorkflows: this.workflows.size
    };
  }

  /**
   * Save incident to database
   */
  async saveIncident(incident) {
    try {
      const dbRow = incident.toDbRow();

      const query = `
        INSERT INTO security_incidents (
          id, title, description, severity, status, incident_type, source,
          affected_assets, impact_assessment, detected_at, reported_by,
          assigned_to, resolved_at, resolution_summary, lessons_learned,
          related_events, metadata, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          severity = EXCLUDED.severity,
          status = EXCLUDED.status,
          incident_type = EXCLUDED.incident_type,
          source = EXCLUDED.source,
          affected_assets = EXCLUDED.affected_assets,
          impact_assessment = EXCLUDED.impact_assessment,
          detected_at = EXCLUDED.detected_at,
          reported_by = EXCLUDED.reported_by,
          assigned_to = EXCLUDED.assigned_to,
          resolved_at = EXCLUDED.resolved_at,
          resolution_summary = EXCLUDED.resolution_summary,
          lessons_learned = EXCLUDED.lessons_learned,
          related_events = EXCLUDED.related_events,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `;

      await secureDatabase.query(query, [
        dbRow.id, dbRow.title, dbRow.description, dbRow.severity, dbRow.status,
        dbRow.incident_type, dbRow.source, dbRow.affected_assets, dbRow.impact_assessment,
        dbRow.detected_at, dbRow.reported_by, dbRow.assigned_to, dbRow.resolved_at,
        dbRow.resolution_summary, dbRow.lessons_learned, dbRow.related_events, dbRow.metadata,
        dbRow.created_at, dbRow.updatedAt
      ]);

    } catch (error) {
      this.logger.error('Failed to save incident to database:', error);
    }
  }

  /**
   * Send incident notification
   */
  async sendIncidentNotification(incident, eventType, data = {}) {
    try {
      const notification = {
        id: crypto.randomUUID(),
        type: 'incident',
        eventType,
        incidentId: incident.id,
        severity: incident.severity,
        title: incident.title,
        description: incident.description,
        assignedTo: incident.assignedTo,
        status: incident.status,
        timestamp: new Date(),
        data
      };

      // This would integrate with the notification system
      this.emit('notification', notification);

    } catch (error) {
      this.logger.error('Failed to send incident notification:', error);
    }
  }

  /**
   * Update statistics
   */
  updateStatistics(incident) {
    this.statistics.totalIncidents++;

    // Update status counts
    this.statistics.byStatus[incident.status] =
      (this.statistics.byStatus[incident.status] || 0) + 1;

    // Update severity counts
    this.statistics.bySeverity[incident.severity] =
      (this.statistics.bySeverity[incident.severity] || 0) + 1;

    // Update type counts
    const typeCount = this.statistics.byType.get(incident.incidentType) || 0;
    this.statistics.byType.set(incident.incidentType, typeCount + 1);
  }

  /**
   * Start periodic checks
   */
  startPeriodicChecks() {
    // Check for SLA breaches every minute
    setInterval(() => {
      this.checkSLABreaches();
    }, 60000);

    // Update statistics every 5 minutes
    setInterval(() => {
      this.calculateSLACompliance();
    }, 300000);
  }

  /**
   * Check for SLA breaches
   */
  checkSLABreaches() {
    const now = Date.now();

    for (const [incidentId, workflow] of this.workflows.entries()) {
      const currentStep = workflow.steps.find(s => s.status === 'pending');
      if (currentStep && currentStep.targetTime && now > currentStep.targetTime.getTime()) {
        this.handleSLABreach(incidentId, currentStep.name, currentStep.targetTime);
      }
    }
  }

  /**
   * Calculate SLA compliance
   */
  calculateSLACompliance() {
    const resolvedIncidents = Array.from(this.incidents.values())
      .filter(i => i.status === 'resolved' || i.status === 'closed');

    const slaCompliant = resolvedIncidents.filter(i => {
      const workflow = this.workflows.get(i.id);
      if (!workflow || !workflow.slaTarget) {
        return true;
      }

      const resolutionStep = workflow.steps.find(s => s.name === 'resolution');
      if (!resolutionStep || !resolutionStep.completedAt) {
        return true;
      }

      return resolutionStep.completedAt <= resolutionStep.targetTime;
    }).length;

    this.statistics.slaCompliance = resolvedIncidents.length > 0 ?
      (slaCompliant / resolvedIncidents.length) * 100 : 100;
  }

  /**
   * Get workflow for incident
   */
  getWorkflow(incidentId) {
    return this.workflows.get(incidentId);
  }

  /**
   * Escalate incident
   */
  async escalateIncident(incidentId, reason, escalatedTo) {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const escalation = {
      incidentId,
      reason,
      escalatedTo,
      escalatedAt: new Date(),
      escalatedBy: 'system',
      previousAssignee: incident.assignedTo
    };

    incident.assignedTo = escalatedTo;
    incident.escalatedAt = new Date();
    incident.updatedAt = new Date();

    if (!incident.escalations) {
      incident.escalations = [];
    }
    incident.escalations.push(escalation);

    await this.saveIncident(incident);

    this.emit('incidentEscalated', { incident, escalation });

    this.logger.info(`Incident ${incidentId} escalated to ${escalatedTo}`, escalation);

    return escalation;
  }

  /**
   * Close incident with lessons learned
   */
  async closeIncident(incidentId, lessonsLearned, resolvedBy) {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    incident.status = 'closed';
    incident.resolvedAt = new Date();
    incident.resolvedBy = resolvedBy;
    incident.lessonsLearned = lessonsLearned;
    incident.updatedAt = new Date();

    // Update workflow
    await this.updateWorkflow(incidentId, 'closed');

    await this.saveIncident(incident);

    this.emit('incidentClosed', incident);

    this.logger.info(`Incident ${incidentId} closed`);

    return incident;
  }

  /**
   * Clean up old incidents
   */
  async cleanup() {
    const retentionPeriod = 365 * 24 * 60 * 60 * 1000; // 1 year
    const cutoffDate = new Date(Date.now() - retentionPeriod);

    const incidentsToRemove = [];
    for (const [incidentId, incident] of this.incidents.entries()) {
      if (incident.detectedAt < cutoffDate && (incident.status === 'resolved' || incident.status === 'closed')) {
        incidentsToRemove.push(incidentId);
      }
    }

    for (const incidentId of incidentsToRemove) {
      this.incidents.delete(incidentId);
      this.workflows.delete(incidentId);
    }

    if (incidentsToRemove.length > 0) {
      this.logger.info(`Cleaned up ${incidentsToRemove.length} old incidents`);
    }
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      totalIncidents: 0,
      byStatus: { open: 0, investigating: 0, contained: 0, resolved: 0, closed: 0 },
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byType: new Map(),
      averageResolutionTime: 0,
      slaCompliance: 0
    };
  }
}

module.exports = IncidentManager;