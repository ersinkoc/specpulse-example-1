/**
 * Security Incident Escalation Engine
 * Automated escalation with configurable rules and notification routing
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const winston = require('winston');

class EscalationEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      checkInterval: config.checkInterval || 60000, // 1 minute
      escalationRules: config.escalationRules || [],
      notificationChannels: config.notificationChannels || ['email', 'sms', 'webhook', 'slack'],
      maxEscalationLevel: config.maxEscalationLevel || 5,
      escalationDelays: config.escalationDelays || {
        level1: 1800000, // 30 minutes
        level2: 3600000, // 1 hour
        level3: 7200000, // 2 hours
        level4: 14400000, // 4 hours
        level5: 28800000  // 8 hours
      },
      cooldownPeriod: config.cooldownPeriod || 1800000, // 30 minutes
      ...config
    };

    // Active escalations
    this.escalations = new Map();
    this.escalationHistory = new Map();

    // Statistics
    this.statistics = {
      totalEscalations: 0,
      escalatedIncidents: new Set(),
      byLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      byReason: new Map(),
      successfulEscalations: 0,
      failedEscalations: 0
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
          filename: 'logs/escalation-engine.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize escalation engine
   */
  initialize() {
    try {
      // Setup default escalation rules
      this.setupDefaultEscalationRules();

      // Start periodic escalation checks
      this.startPeriodicChecks();

      this.logger.info('Escalation engine initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize escalation engine:', error);
      throw error;
    }
  }

  /**
   * Setup default escalation rules
   */
  setupDefaultEscalationRules() {
    // Critical severity rules
    this.config.escalationRules.push({
      id: 'critical_immediate',
      severity: 'critical',
      trigger: {
        conditions: [
          { field: 'severity', operator: 'equals', value: 'critical' },
          { field: 'status', operator: 'not_equals', value: 'resolved' }
        ],
        timeThreshold: 0, // Immediate
        maxEscalationLevel: 5
      },
      actions: [
        { type: 'notify', channels: ['sms', 'email', 'webhook'], level: 1 },
        { type: 'assign', target: 'security-lead', level: 1 }
      ]
    });

    // High severity rules
    this.config.escalationRules.push({
      id: 'high_no_response',
      severity: 'high',
      trigger: {
        conditions: [
          { field: 'severity', operator: 'equals', value: 'high' },
          { field: 'status', operator: 'not_equals', value: 'resolved' }
        ],
        timeThreshold: 3600000, // 1 hour
        maxEscalationLevel: 4
      },
      actions: [
        { type: 'notify', channels: ['email', 'webhook'], level: 1 },
        { type: 'assign', target: 'security-senior', level: 2 }
      ]
    });

    // Medium severity rules
    this.config.escalationRules.push({
      id: 'medium_no_resolution',
      severity: 'medium',
      trigger: {
        conditions: [
          { field: 'severity', operator: 'equals', value: 'medium' },
          { field: 'status', operator: 'not_equals', value: 'resolved' }
        ],
        timeThreshold: 14400000, // 4 hours
        maxEscalationLevel: 3
      },
      actions: [
        { type: 'notify', channels: ['email'], level: 1 },
        { type: 'assign', target: 'security-team', level: 2 }
      ]
    });

    // Status-based rules
    this.config.escalationRules.push({
      id: 'stale_investigation',
      severity: 'high',
      trigger: {
        conditions: [
          { field: 'status', operator: 'equals', value: 'investigating' },
          { field: 'updatedAt', operator: 'older_than', value: 7200000 } // 2 hours
        ],
        timeThreshold: 0,
        maxEscalationLevel: 3
      },
      actions: [
        { type: 'notify', channels: ['email', 'webhook'], level: 1 },
        { type: 'assign', target: 'security-lead', level: 2 }
      ]
    });

    // SLA breach rules
    this.config.escalationRules.push({
      id: 'sla_breach',
      severity: 'high',
      trigger: {
        conditions: [
          { field: 'slaStatus', operator: 'equals', value: 'breached' }
        ],
        timeThreshold: 0,
        maxEscalationLevel: 5
      },
      actions: [
        { type: 'notify', channels: ['sms', 'email', 'webhook', 'slack'], level: 1 },
        { type: 'assign', target: 'security-lead', level: 2 }
      ]
    });

    // Affected asset rules
    this.config.escalationRules.push({
      id: 'high_value_assets',
      severity: 'high',
      trigger: {
        conditions: [
          { field: 'affectedAssets', operator: 'contains', value: 'production' }
        ],
        timeThreshold: 1800000, // 30 minutes
        maxEscalationLevel: 4
      },
      actions: [
        { type: 'notify', channels: ['email', 'webhook'], level: 1 },
        { type: 'assign', target: 'security-lead', level: 2 }
      ]
    });

    this.logger.info(`Setup ${this.config.escalationRules.length} escalation rules`);
  }

  /**
   * Check incident for escalation
   */
  async checkIncident(incident) {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const escalation = await this.evaluateEscalationRules(incident);
      if (escalation) {
        return await this.executeEscalation(incident, escalation);
      }
      return null;

    } catch (error) {
      this.logger.error('Failed to check incident for escalation:', error);
      return null;
    }
  }

  /**
   * Evaluate escalation rules
   */
  async evaluateEscalationRules(incident) {
    const applicableRules = [];

    for (const rule of this.config.escalationRules) {
      if (this.isRuleApplicable(rule, incident)) {
        applicableRules.push(rule);
      }
    }

    if (applicableRules.length === 0) {
      return null;
    }

    // Get the highest priority rule (highest escalation level)
    const selectedRule = applicableRules.reduce((prev, current) =>
      current.maxEscalationLevel > prev.maxEscalationLevel ? current : prev
    );

    // Determine escalation level
    const currentLevel = this.getCurrentEscalationLevel(incident.id);
    const nextLevel = Math.min(currentLevel + 1, selectedRule.maxEscalationLevel);

    return {
      incidentId: incident.id,
      rule: selectedRule,
      currentLevel,
      nextLevel,
      reason: this.generateEscalationReason(selectedRule, incident),
      urgency: this.calculateUrgency(selectedRule, incident),
      actions: selectedRule.actions
    };
  }

  /**
   * Check if rule is applicable to incident
   */
  isRuleApplicable(rule, incident) {
    try {
      // Check severity match
      if (rule.severity && incident.severity !== rule.severity) {
        return false;
      }

      // Check time threshold
      if (rule.trigger.timeThreshold > 0) {
        const timeDiff = Date.now() - new Date(incident.detectedAt || incident.createdAt).getTime();
        if (timeDiff < rule.trigger.timeThreshold) {
          return false;
        }
      }

      // Check conditions
      for (const condition of rule.trigger.conditions) {
        if (!this.evaluateCondition(condition, incident)) {
          return false;
        }
      }

      // Check cooldown period
      if (this.isInCooldownPeriod(incident.id, rule.id)) {
        return false;
      }

      return true;

    } catch (error) {
      this.logger.error(`Error evaluating rule ${rule.id}:`, error);
      return false;
    }
  }

  /**
   * Evaluate condition
   */
  evaluateCondition(condition, incident) {
    const value = this.getNestedValue(incident, condition.field);

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;

      case 'not_equals':
        return value !== condition.value;

      case 'contains':
        return Array.isArray(value) ?
          value.includes(condition.value) :
          String(value).toLowerCase().includes(String(condition.value).toLowerCase());

      case 'older_than':
        return value && (new Date() - new Date(value)) > condition.value;

      case 'newer_than':
        return value && (new Date() - new Date(value)) < condition.value;

      case 'exists':
        return value !== null && value !== undefined;

      case 'not_exists':
        return value === null || value === undefined;

      default:
        this.logger.warn(`Unknown condition operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * Get current escalation level for incident
   */
  getCurrentEscalationLevel(incidentId) {
    const escalation = this.escalations.get(incidentId);
    return escalation ? escalation.currentLevel : 0;
  }

  /**
   * Check if incident is in cooldown period
   */
  isInCooldownPeriod(incidentId, ruleId) {
    const historyKey = `${incidentId}-${ruleId}`;
    const lastEscalation = this.escalationHistory.get(historyKey);

    if (!lastEscalation) {
      return false;
    }

    return (Date.now() - lastEscalation) < this.config.cooldownPeriod;
  }

  /**
   * Generate escalation reason
   */
  generateEscalationReason(rule, incident) {
    const reasons = [];

    // Severity-based reason
    if (rule.severity) {
      reasons.push(`${rule.severity.toUpperCase()} severity`);
    }

    // Condition-based reasons
    for (const condition of rule.trigger.conditions) {
      if (condition.field === 'status') {
        reasons.push(`Status: ${condition.value}`);
      } else if (condition.field === 'slaStatus') {
        reasons.push('SLA breach detected');
      } else if (condition.field === 'affectedAssets') {
        reasons.push('High-value assets affected');
      }
    }

    // Time-based reason
    if (rule.trigger.timeThreshold > 0) {
      const timeDiff = Date.now() - new Date(incident.detectedAt || incident.createdAt).getTime();
      const timeStr = this.formatDuration(timeDiff);
      reasons.push(`Time elapsed: ${timeStr}`);
    }

    return reasons.join('; ');
  }

  /**
   * Calculate urgency score
   */
  calculateUrgency(rule, incident) {
    let urgency = rule.severity === 'critical' ? 10 :
                 rule.severity === 'high' ? 7 :
                 rule.severity === 'medium' ? 4 : 1;

    // Add urgency for SLA breaches
    if (this.isSLABreached(incident)) {
      urgency += 5;
    }

    // Add urgency for affected assets
    if (incident.affectedAssets && incident.affectedAssets.length > 0) {
      urgency += Math.min(incident.affectedAssets.length, 3);
    }

    return Math.min(urgency, 15);
  }

  /**
   * Check if SLA is breached
   */
  isSLABreached(incident) {
    // This would typically check actual SLA metrics
    // For now, return false as placeholder
    return false;
  }

  /**
   * Format duration in human readable format
   */
  formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Execute escalation
   */
  async executeEscalation(incident, escalation) {
    try {
      // Create escalation record
      const escalationRecord = {
        id: crypto.randomUUID(),
        incidentId: incident.id,
        ruleId: escalation.rule.id,
        currentLevel: escalation.currentLevel,
        nextLevel: escalation.nextLevel,
        reason: escalation.reason,
        urgency: escalation.urgency,
        actions: escalation.actions,
        createdAt: new Date(),
        status: 'executing'
      };

      // Store escalation
      this.escalations.set(incident.id, escalationRecord);
      this.escalationHistory.set(`${incident.id}-${escalation.rule.id}`, Date.now());

      // Update statistics
      this.statistics.totalEscalations++;
      this.statistics.escalatedIncidents.add(incident.id);
      this.statistics.byLevel[escalation.nextLevel]++;

      const reasonKey = escalation.reason.split(':')[0].toLowerCase().trim();
      const reasonCount = this.statistics.byReason.get(reasonKey) || 0;
      this.statistics.byReason.set(reasonKey, reasonCount + 1);

      // Execute actions
      const actionResults = [];
      for (const action of escalation.actions) {
        try {
          const result = await this.executeAction(incident, action, escalationRecord);
          actionResults.push({ action, result });
        } catch (error) {
          this.logger.error(`Failed to execute action ${action.type}:`, error);
          actionResults.push({ action, error: error.message });
        }
      }

      // Update escalation record
      escalationRecord.actionsExecuted = actionResults;
      escalationRecord.status = actionResults.some(r => r.error) ? 'failed' : 'completed';
      escalationRecord.completedAt = new Date();

      // Update statistics
      if (escalationRecord.status === 'completed') {
        this.statistics.successfulEscalations++;
      } else {
        this.statistics.failedEscalations++;
      }

      // Emit event
      this.emit('escalation', {
        incident,
        escalation: escalationRecord,
        actions: actionResults
      });

      this.logger.info('Escalation executed:', {
        incidentId: incident.id,
        severity: incident.severity,
        escalationLevel: escalation.nextLevel,
        reason: escalation.reason,
        actionsCount: escalation.actions.length,
        status: escalationRecord.status
      });

      return escalationRecord;

    } catch (error) {
      this.logger.error('Failed to execute escalation:', error);
      throw error;
    }
  }

  /**
   * Execute escalation action
   */
  async executeAction(incident, action, escalationRecord) {
    switch (action.type) {
      case 'notify':
        return await this.executeNotification(incident, action, escalationRecord);

      case 'assign':
        return await this.executeAssignment(incident, action, escalationRecord);

      case 'approve':
        return await this.executeApproval(incident, action, escalationRecord);

      case 'create_task':
        return await this.createTask(incident, action, escalationRecord);

      case 'block_access':
        return await this.blockAccess(incident, action, escalationRecord);

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Execute notification action
   */
  async executeNotification(incident, action, escalationRecord) {
    const notification = {
      id: crypto.randomUUID(),
      type: 'escalation',
      incidentId: incident.id,
      escalationId: escalationRecord.id,
      escalationLevel: escalationRecord.nextLevel,
      severity: incident.severity,
      title: `Security Incident Escalation: ${incident.title}`,
      message: escalationRecord.reason,
      urgency: escalationRecord.urgency,
      channels: action.channels,
      timestamp: new Date(),
      metadata: {
        incident,
        escalation: escalationRecord
      }
    };

    // This would integrate with the notification system
    this.emit('notification', notification);

    return {
      type: 'notification',
      channels: action.channels,
      notificationId: notification.id,
      status: 'sent'
    };
  }

  /**
   * Execute assignment action
   */
  async executeAssignment(incident, action, escalationRecord) {
    const assignment = {
      incidentId: incident.id,
      assignedTo: action.target,
      assignedBy: 'escalation-engine',
      assignedAt: new Date(),
      escalationLevel: escalationRecord.nextLevel,
      reason: escalationRecord.reason,
      urgency: escalationRecord.urgency
    };

    // Update incident assignment
    incident.assignedTo = action.target;
    incident.assignedAt = new Date();
    incident.updatedAt = new Date();

    // Store assignment in metadata
    if (!incident.metadata) {
      incident.metadata = {};
    }
    incident.metadata.escalationAssignment = assignment;

    this.emit('assignment', {
      incidentId: incident.id,
      assignedTo: action.target,
      escalationLevel: escalationRecord.nextLevel
    });

    return {
      type: 'assignment',
      assignedTo: action.target,
      status: 'completed'
    };
  }

  /**
   * Execute approval action
   */
  async executeApproval(incident, action, escalationRecord) {
    // This would integrate with an approval workflow system
    const approval = {
      incidentId: incident.id,
      escalationId: escalationRecord.id,
      requiredApproval: action.approvalRequired || 'manager',
      requestedAt: new Date(),
      urgency: escalationRecord.urgency,
      status: 'pending'
    };

    this.emit('approval_required', approval);

    return {
      type: 'approval',
      status: 'pending'
    };
  }

  /**
   * Create task for incident
   */
  async createTask(incident, action, escalationRecord) {
    const task = {
      incidentId: incident.id,
      title: `Incident Response: ${incident.title}`,
      description: escalationRecord.reason,
      assignedTo: action.target || 'security-team',
      priority: this.getTaskPriority(escalationRecord.urgency),
      status: 'open',
      createdAt: new Date(),
      dueDate: this.calculateTaskDueDate(escalationRecord)
    };

    this.emit('task_created', task);

    return {
      type: 'task',
      taskId: task.id || crypto.randomUUID(),
      status: 'created'
    };
  }

  /**
   * Block access based on incident
   */
  async blockAccess(incident, action, escalationRecord) {
    // This would integrate with access control systems
    const block = {
      incidentId: incident.id,
      blockType: action.blockType || 'partial',
      affectedResources: incident.affectedAssets || [],
      reason: escalationRecord.reason,
      severity: incident.severity,
      duration: action.duration || 3600000, // 1 hour default
      createdAt: new Date(),
      status: 'active'
    };

    this.emit('access_blocked', block);

    return {
      type: 'access_block',
      status: 'active'
    };
  }

  /**
   * Get task priority from urgency score
   */
  getTaskPriority(urgency) {
    if (urgency >= 12) return 'critical';
    if (urgency >= 8) return 'high';
    if (urgency >= 4) return 'medium';
    return 'low';
  }

  /**
   * Calculate task due date
   */
  calculateTaskDueDate(escalationRecord) {
    const slaTarget = this.config.escalationDelays[`level${escalationRecord.nextLevel}`] || 3600000;
    return new Date(Date.now() + slaTarget);
  }

  /**
   * Start periodic escalation checks
   */
  startPeriodicChecks() {
    setInterval(() => {
      this.checkAllIncidents();
    }, this.config.checkInterval);
  }

  /**
   * Check all active incidents for escalation
   */
  async checkAllIncidents() {
    // This would typically get all active incidents from the database
    // For now, return placeholder
    const activeIncidents = Array.from(this.incidents.values())
      .filter(i => ['open', 'investigating', 'contained'].includes(i.status));

    for (const incident of activeIncidents) {
      await this.checkIncident(incident);
    }
  }

  /**
   * Get escalation statistics
   */
  getStatistics() {
    return {
      ...this.statistics,
      activeEscalations: this.escalations.size,
      escalationHistorySize: this.escalationHistory.size,
      rulesConfigured: this.config.escalationRules.length,
      channelsConfigured: this.config.notificationChannels.length
    };
  }

  /**
   * Get active escalations
   */
  getActiveEscalations() {
    return Array.from(this.escalations.entries()).map(([id, escalation]) => ({
      incidentId: id,
      ...escalation
    }));
  }

  /**
   * Update escalation status
   */
  updateEscalationStatus(incidentId, status, updates = {}) {
    const escalation = this.escalations.get(incidentId);
    if (escalation) {
      escalation.status = status;
      Object.assign(escalation, updates);
      escalation.updatedAt = new Date();
    }
  }

  /**
   * Cancel escalation
   */
  cancelEscalation(incidentId, reason) {
    const escalation = this.escalations.get(incidentId);
    if (escalation) {
      escalation.status = 'cancelled';
      escalation.cancelledAt = new Date();
      escalation.cancelReason = reason;

      this.emit('escalation_cancelled', {
        incidentId,
        escalation,
        reason
      });
    }
  }

  /**
   * Reset escalation engine
   */
  reset() {
    this.escalations.clear();
    this.escalationHistory.clear();
    this.resetStatistics();
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      totalEscalations: 0,
      escalatedIncidents: new Set(),
      byLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      byReason: new Map(),
      successfulEscalations: 0,
      failedEscalations: 0
    };
  }
}

module.exports = EscalationEngine;