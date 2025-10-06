/**
 * Security Incidents Controller
 * API endpoints for security incident management and response
 */

const express = require('express');
const winston = require('winston');
const { IncidentManager } = require('../../security/incident/IncidentManager');
const { SeverityClassifier } = require('../../security/incident/SeverityClassifier');
const { EscalationEngine } = require('../../security/incident/EscalationEngine');

class IncidentsController {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      cachingEnabled: config.cachingEnabled !== false,
      cacheTimeout: config.cacheTimeout || 60000, // 1 minute for incident data
      autoAssignment: config.autoAssignment !== false,
      autoEscalation: config.autoEscalation !== false,
      realTimeUpdates: config.realTimeUpdates !== false,
      notificationChannels: config.notificationChannels || ['email', 'sms', 'webhook'],
      pagination: {
        defaultLimit: config.defaultLimit || 20,
        maxLimit: config.maxLimit || 100
      },
      severityLevels: config.severityLevels || ['critical', 'high', 'medium', 'low'],
      incidentTypes: config.incidentTypes || [
        'malware_detection',
        'unauthorized_access',
        'data_breach',
        'denial_of_service',
        'phishing',
        'policy_violation',
        'system_compromise',
        'data_loss',
        'security_misconfiguration',
        'suspicious_activity'
      ],
      ...config
    };

    // Initialize components
    this.incidentManager = new IncidentManager();
    this.severityClassifier = new SeverityClassifier();
    this.escalationEngine = new EscalationEngine();

    // Cache
    this.cache = new Map();

    // Real-time subscribers
    this.subscribers = new Map();

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
          filename: 'logs/incidents-controller.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize incidents controller
   */
  async initialize() {
    try {
      // Start real-time updates if enabled
      if (this.config.realTimeUpdates) {
        this.startRealTimeUpdates();
      }

      this.logger.info('Security incidents controller initialized');
    } catch (error) {
      this.logger.error('Failed to initialize incidents controller:', error);
      throw error;
    }
  }

  /**
   * Get incidents list
   */
  async getIncidents(req, res) {
    try {
      const {
        status,
        severity,
        type,
        assignee,
        page = 1,
        limit = 20,
        timeframe = '30d',
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Validate pagination
      const parsedLimit = parseInt(limit);
      const parsedPage = parseInt(page);

      if (parsedLimit > this.config.pagination.maxLimit) {
        return res.status(400).json({
          error: 'Invalid limit',
          message: `Maximum limit is ${this.config.pagination.maxLimit}`
        });
      }

      // Get incidents
      const incidents = await this.incidentManager.getIncidents({
        status,
        severity,
        type,
        assignee,
        page: parsedPage,
        limit: parsedLimit,
        timeframe,
        sortBy,
        sortOrder
      });

      res.json(incidents);

    } catch (error) {
      this.logger.error('Failed to get incidents:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incidents'
      });
    }
  }

  /**
   * Get incident by ID
   */
  async getIncident(req, res) {
    try {
      const { id } = req.params;

      const incident = await this.incidentManager.getIncident(id);
      if (!incident) {
        return res.status(404).json({
          error: 'Not found',
          message: `Incident ${id} not found`
        });
      }

      res.json(incident);

    } catch (error) {
      this.logger.error(`Failed to get incident ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incident'
      });
    }
  }

  /**
   * Create new incident
   */
  async createIncident(req, res) {
    try {
      const incidentData = req.body;

      // Validate required fields
      if (!incidentData.title || !incidentData.description || !incidentData.type) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Title, description, and type are required'
        });
      }

      // Validate incident type
      if (!this.config.incidentTypes.includes(incidentData.type)) {
        return res.status(400).json({
          error: 'Validation error',
          message: `Invalid type. Valid types: ${this.config.incidentTypes.join(', ')}`
        });
      }

      // Auto-classify severity if not provided
      if (!incidentData.severity && this.config.autoAssignment) {
        const classification = await this.severityClassifier.classifySeverity(incidentData);
        incidentData.severity = classification.severity;
        incidentData.confidence = classification.confidence;
      }

      // Create incident
      const incident = await this.incidentManager.createIncident({
        ...incidentData,
        reportedBy: req.user?.id || 'system',
        source: incidentData.source || 'api',
        priority: this.calculatePriority(incidentData.severity, incidentData.type)
      });

      // Auto-escalate if critical and auto-escalation is enabled
      if (incident.severity === 'critical' && this.config.autoEscalation) {
        await this.incidentManager.escalateIncident(incident.id, {
          reason: 'Auto-escalation for critical incident',
          escalatedBy: 'system'
        });
      }

      // Notify subscribers
      this.notifySubscribers('incident_created', incident);

      res.status(201).json(incident);

    } catch (error) {
      this.logger.error('Failed to create incident:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create incident'
      });
    }
  }

  /**
   * Update incident
   */
  async updateIncident(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Get existing incident
      const existingIncident = await this.incidentManager.getIncident(id);
      if (!existingIncident) {
        return res.status(404).json({
          error: 'Not found',
          message: `Incident ${id} not found`
        });
      }

      // Check if incident can be updated
      if (existingIncident.status === 'closed') {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Cannot update closed incident'
        });
      }

      // Update incident
      const updatedIncident = await this.incidentManager.updateIncident(id, {
        ...updateData,
        updatedBy: req.user?.id || 'system',
        updatedAt: new Date()
      });

      // Check if severity changed and re-escalate if needed
      if (updateData.severity && updateData.severity !== existingIncident.severity) {
        if (updateData.severity === 'critical' && this.config.autoEscalation) {
          await this.incidentManager.escalateIncident(id, {
            reason: 'Severity escalated to critical',
            escalatedBy: 'system'
          });
        }
      }

      // Notify subscribers
      this.notifySubscribers('incident_updated', updatedIncident);

      res.json(updatedIncident);

    } catch (error) {
      this.logger.error(`Failed to update incident ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update incident'
      });
    }
  }

  /**
   * Update incident status
   */
  async updateIncidentStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, note, resolution } = req.body;

      // Validate status
      const validStatuses = ['open', 'investigating', 'contained', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Validation error',
          message: `Invalid status. Valid statuses: ${validStatuses.join(', ')}`
        });
      }

      // Update status
      const updateData = {
        status,
        updatedBy: req.user?.id || 'system'
      };

      if (note) {
        updateData.note = note;
      }

      if (resolution) {
        updateData.resolution = resolution;
      }

      const updatedIncident = await this.incidentManager.updateIncidentStatus(id, updateData);

      // If closing incident, add final note
      if (status === 'closed') {
        await this.incidentManager.addIncidentNote(id, {
          type: 'status_change',
          content: `Incident closed by ${updateData.updatedBy}`,
          addedBy: updateData.updatedBy,
          isInternal: false
        });
      }

      // Notify subscribers
      this.notifySubscribers('incident_status_updated', {
        incidentId: id,
        status,
        updatedBy: updateData.updatedBy
      });

      res.json(updatedIncident);

    } catch (error) {
      this.logger.error(`Failed to update incident status ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update incident status'
      });
    }
  }

  /**
   * Add incident note
   */
  async addIncidentNote(req, res) {
    try {
      const { id } = req.params;
      const { content, type = 'general', isInternal = false } = req.body;

      if (!content) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Note content is required'
        });
      }

      const note = await this.incidentManager.addIncidentNote(id, {
        content,
        type,
        isInternal,
        addedBy: req.user?.id || 'system'
      });

      res.status(201).json(note);

    } catch (error) {
      this.logger.error(`Failed to add note to incident ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to add incident note'
      });
    }
  }

  /**
   * Assign incident
   */
  async assignIncident(req, res) {
    try {
      const { id } = req.params;
      const { assignee, priority, note } = req.body;

      if (!assignee) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Assignee is required'
        });
      }

      const assignment = await this.incidentManager.assignIncident(id, {
        assignee,
        priority: priority || 'medium',
        assignedBy: req.user?.id || 'system',
        assignedAt: new Date(),
        note
      });

      // Notify subscribers
      this.notifySubscribers('incident_assigned', {
        incidentId: id,
        assignee,
        assignedBy: assignment.assignedBy
      });

      res.json(assignment);

    } catch (error) {
      this.logger.error(`Failed to assign incident ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to assign incident'
      });
    }
  }

  /**
   * Escalate incident
   */
  async escalateIncident(req, res) {
    try {
      const { id } = req.params;
      const { reason, escalationLevel = 1, notifyStakeholders = true } = req.body;

      if (!reason) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Escalation reason is required'
        });
      }

      const escalation = await this.incidentManager.escalateIncident(id, {
        reason,
        escalationLevel,
        escalatedBy: req.user?.id || 'system',
        escalatedAt: new Date(),
        notifyStakeholders
      });

      // Notify subscribers
      this.notifySubscribers('incident_escalated', {
        incidentId: id,
        escalationLevel,
        escalatedBy: escalation.escalatedBy
      });

      res.json(escalation);

    } catch (error) {
      this.logger.error(`Failed to escalate incident ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to escalate incident'
      });
    }
  }

  /**
   * Close incident
   */
  async closeIncident(req, res) {
    try {
      const { id } = req.params;
      const { resolution, resolutionCode, lessonsLearned, postMortemRequired = false } = req.body;

      if (!resolution) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Resolution details are required'
        });
      }

      const closure = await this.incidentManager.closeIncident(id, {
        resolution,
        resolutionCode,
        lessonsLearned,
        postMortemRequired,
        closedBy: req.user?.id || 'system',
        closedAt: new Date()
      });

      // Update status to closed
      await this.incidentManager.updateIncidentStatus(id, {
        status: 'closed',
        updatedBy: closure.closedBy
      });

      // Notify subscribers
      this.notifySubscribers('incident_closed', {
        incidentId: id,
        resolution,
        closedBy: closure.closedBy
      });

      res.json(closure);

    } catch (error) {
      this.logger.error(`Failed to close incident ${req.params.id}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to close incident'
      });
    }
  }

  /**
   * Get incident statistics
   */
  async getIncidentStatistics(req, res) {
    try {
      const { timeframe = '30d' } = req.query;

      const statistics = await this.incidentManager.getStatistics();

      // Add time-specific statistics
      const timeSpecificStats = await this.getTimeSpecificStatistics(timeframe);

      res.json({
        ...statistics,
        timeSpecific: timeSpecificStats
      });

    } catch (error) {
      this.logger.error('Failed to get incident statistics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incident statistics'
      });
    }
  }

  /**
   * Get incident trends
   */
  async getIncidentTrends(req, res) {
    try {
      const { timeframe = '30d', groupBy = 'day' } = req.query;

      const trends = await this.incidentManager.getIncidentTrends({
        timeframe,
        groupBy,
        metrics: ['count', 'severity', 'type', 'resolutionTime']
      });

      res.json(trends);

    } catch (error) {
      this.logger.error('Failed to get incident trends:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incident trends'
      });
    }
  }

  /**
   * Get incident SLA metrics
   */
  async getSLAMetrics(req, res) {
    try {
      const { timeframe = '30d' } = req.query;

      const slaMetrics = await this.incidentManager.getSLAMetrics(timeframe);

      res.json(slaMetrics);

    } catch (error) {
      this.logger.error('Failed to get SLA metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve SLA metrics'
      });
    }
  }

  /**
   * Get incident response metrics
   */
  async getResponseMetrics(req, res) {
    try {
      const { timeframe = '30d' } = req.query;

      const responseMetrics = await this.incidentManager.getResponseMetrics(timeframe);

      res.json(responseMetrics);

    } catch (error) {
      this.logger.error('Failed to get response metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve response metrics'
      });
    }
  }

  /**
   * Search incidents
   */
  async searchIncidents(req, res) {
    try {
      const {
        query,
        fields = ['title', 'description', 'type'],
        filters = {},
        page = 1,
        limit = 20
      } = req.query;

      if (!query) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Search query is required'
        });
      }

      const searchResults = await this.incidentManager.searchIncidents({
        query,
        fields: Array.isArray(fields) ? fields : [fields],
        filters,
        page: parseInt(page),
        limit: Math.min(parseInt(limit), this.config.pagination.maxLimit)
      });

      res.json(searchResults);

    } catch (error) {
      this.logger.error('Failed to search incidents:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to search incidents'
      });
    }
  }

  /**
   * Get incident templates
   */
  async getIncidentTemplates(req, res) {
    try {
      const { type } = req.query;

      const templates = await this.incidentManager.getIncidentTemplates(type);

      res.json(templates);

    } catch (error) {
      this.logger.error('Failed to get incident templates:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incident templates'
      });
    }
  }

  /**
   * Create incident from template
   */
  async createFromTemplate(req, res) {
    try {
      const { templateId } = req.params;
      const { overrides = {} } = req.body;

      const incident = await this.incidentManager.createFromTemplate(templateId, {
        ...overrides,
        createdBy: req.user?.id || 'system'
      });

      // Notify subscribers
      this.notifySubscribers('incident_created_from_template', incident);

      res.status(201).json(incident);

    } catch (error) {
      this.logger.error(`Failed to create incident from template ${req.params.templateId}:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create incident from template'
      });
    }
  }

  /**
   * Subscribe to incident updates
   */
  async subscribeToUpdates(req, res) {
    try {
      const { filters = {} } = req.body;
      const subscriptionId = this.generateSubscriptionId();

      // Store subscription
      this.subscribers.set(subscriptionId, {
        id: subscriptionId,
        filters,
        createdAt: new Date(),
        lastUpdate: new Date()
      });

      res.json({
        subscriptionId,
        message: 'Successfully subscribed to incident updates',
        filters
      });

    } catch (error) {
      this.logger.error('Failed to subscribe to incident updates:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to subscribe to updates'
      });
    }
  }

  /**
   * Unsubscribe from updates
   */
  async unsubscribeFromUpdates(req, res) {
    try {
      const { subscriptionId } = req.params;

      if (this.subscribers.has(subscriptionId)) {
        this.subscribers.delete(subscriptionId);
        res.json({
          message: 'Successfully unsubscribed',
          subscriptionId
        });
      } else {
        res.status(404).json({
          error: 'Subscription not found',
          message: 'Invalid subscription ID'
        });
      }

    } catch (error) {
      this.logger.error('Failed to unsubscribe from updates:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to unsubscribe'
      });
    }
  }

  /**
   * Helper methods
   */
  calculatePriority(severity, type) {
    const severityPriority = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4
    };

    const typePriority = {
      malware_detection: 1,
      data_breach: 1,
      system_compromise: 2,
      denial_of_service: 2,
      unauthorized_access: 3,
      data_loss: 2,
      phishing: 4,
      policy_violation: 5,
      security_misconfiguration: 4,
      suspicious_activity: 5
    };

    const severityScore = severityPriority[severity] || 3;
    const typeScore = typePriority[type] || 3;

    // Lower score = higher priority
    return (severityScore + typeScore) / 2;
  }

  async getTimeSpecificStatistics(timeframe) {
    // Placeholder implementation
    return {
      last24Hours: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      last7Days: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      last30Days: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };
  }

  notifySubscribers(event, data) {
    this.subscribers.forEach((subscription, subscriptionId) => {
      // Check if subscription filters match the event
      if (this.matchesSubscriptionFilter(subscription.filters, data)) {
        // In a real implementation, this would send WebSocket messages
        this.logger.info(`Notifying subscriber ${subscriptionId} of ${event}`, data);
      }
    });
  }

  matchesSubscriptionFilter(filters, data) {
    // Simplified filter matching
    if (!filters || Object.keys(filters).length === 0) {
      return true;
    }

    // Check severity filter
    if (filters.severity && filters.severity !== data.severity) {
      return false;
    }

    // Check type filter
    if (filters.type && filters.type !== data.type) {
      return false;
    }

    return true;
  }

  startRealTimeUpdates() {
    // Placeholder for real-time updates
    this.logger.info('Real-time incident updates enabled');
  }

  generateSubscriptionId() {
    return `inc_sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // Incident CRUD endpoints
    router.get('/', this.getIncidents.bind(this));
    router.get('/:id', this.getIncident.bind(this));
    router.post('/', this.createIncident.bind(this));
    router.put('/:id', this.updateIncident.bind(this));
    router.patch('/:id/status', this.updateIncidentStatus.bind(this));
    router.post('/:id/notes', this.addIncidentNote.bind(this));
    router.post('/:id/assign', this.assignIncident.bind(this));
    router.post('/:id/escalate', this.escalateIncident.bind(this));
    router.post('/:id/close', this.closeIncident.bind(this));

    // Incident analysis endpoints
    router.get('/statistics', this.getIncidentStatistics.bind(this));
    router.get('/trends', this.getIncidentTrends.bind(this));
    router.get('/sla', this.getSLAMetrics.bind(this));
    router.get('/response', this.getResponseMetrics.bind(this));

    // Search and templates
    router.get('/search', this.searchIncidents.bind(this));
    router.get('/templates', this.getIncidentTemplates.bind(this));
    router.post('/templates/:templateId', this.createFromTemplate.bind(this));

    // Real-time subscriptions
    router.post('/subscribe', this.subscribeToUpdates.bind(this));
    router.delete('/subscribe/:subscriptionId', this.unsubscribeFromUpdates.bind(this));

    return router;
  }

  /**
   * Get controller statistics
   */
  getStatistics() {
    return {
      enabled: this.config.enabled,
      autoAssignment: this.config.autoAssignment,
      autoEscalation: this.config.autoEscalation,
      realTimeUpdates: this.config.realTimeUpdates,
      subscribers: this.subscribers.size,
      components: {
        incidentManager: this.incidentManager.getStatistics(),
        severityClassifier: this.severityClassifier.getStatistics(),
        escalationEngine: this.escalationEngine.getStatistics()
      }
    };
  }
}

module.exports = IncidentsController;