/**
 * Security Incident Model
 * Security incident management and tracking
 */

const { v4: uuidv4 } = require('uuid');

class SecurityIncident {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.title = data.title;
    this.description = data.description;
    this.severity = data.severity || 'medium';
    this.status = data.status || 'open';
    this.incidentType = data.incidentType;
    this.source = data.source;
    this.affectedAssets = data.affectedAssets || [];
    this.impactAssessment = data.impactAssessment;
    this.detectedAt = data.detectedAt || new Date();
    this.reportedBy = data.reportedBy;
    this.assignedTo = data.assignedTo;
    this.resolvedAt = data.resolvedAt || null;
    this.resolutionSummary = data.resolutionSummary;
    this.lessonsLearned = data.lessonsLearned;
    this.relatedEvents = data.relatedEvents || [];
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  /**
   * Create security incident from alert
   */
  static fromAlert(alertData) {
    return new SecurityIncident({
      title: alertData.title || `Security Incident: ${alertData.alertType}`,
      description: alertData.description,
      severity: alertData.severity,
      incidentType: alertData.alertType,
      source: alertData.source,
      detectedAt: new Date(),
      reportedBy: alertData.generatedBy || 'system',
      relatedEvents: [alertData.triggerEvent]
    });
  }

  /**
   * Convert to database format
   */
  toDbRow() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      severity: this.severity,
      status: this.status,
      incident_type: this.incidentType,
      source: this.source,
      affected_assets: JSON.stringify(this.affectedAssets),
      impact_assessment: this.impactAssessment,
      detected_at: this.detectedAt,
      reported_by: this.reportedBy,
      assigned_to: this.assignedTo,
      resolved_at: this.resolvedAt,
      resolution_summary: this.resolutionSummary,
      lessons_learned: this.lessonsLearned,
      related_events: JSON.stringify(this.relatedEvents),
      metadata: JSON.stringify(this.metadata),
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  /**
   * Create from database row
   */
  static fromDbRow(row) {
    return new SecurityIncident({
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      incidentType: row.incident_type,
      source: row.source,
      affectedAssets: row.affected_assets ? JSON.parse(row.affected_assets) : [],
      impactAssessment: row.impact_assessment,
      detectedAt: row.detected_at,
      reportedBy: row.reported_by,
      assignedTo: row.assigned_to,
      resolvedAt: row.resolved_at,
      resolutionSummary: row.resolution_summary,
      lessonsLearned: row.lessons_learned,
      relatedEvents: row.related_events ? JSON.parse(row.related_events) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  /**
   * Validate incident data
   */
  validate() {
    const errors = [];

    if (!this.title) {
      errors.push('Incident title is required');
    }

    if (!this.description) {
      errors.push('Incident description is required');
    }

    if (!this.incidentType) {
      errors.push('Incident type is required');
    }

    const validSeverities = ['info', 'low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(this.severity)) {
      errors.push('Severity must be one of: info, low, medium, high, critical');
    }

    const validStatuses = ['open', 'investigating', 'contained', 'resolved', 'closed'];
    if (!validStatuses.includes(this.status)) {
      errors.push('Status must be one of: open, investigating, contained, resolved, closed');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Assign incident to user
   */
  assignTo(userId) {
    this.assignedTo = userId;
    this.updatedAt = new Date();
  }

  /**
   * Start investigation
   */
  startInvestigation() {
    this.status = 'investigating';
    this.updatedAt = new Date();
  }

  /**
   * Contain incident
   */
  contain() {
    this.status = 'contained';
    this.updatedAt = new Date();
  }

  /**
   * Resolve incident
   */
  resolve(resolutionSummary, resolvedBy) {
    this.status = 'resolved';
    this.resolvedAt = new Date();
    this.resolutionSummary = resolutionSummary;
    this.resolvedBy = resolvedBy;
    this.updatedAt = new Date();
  }

  /**
   * Close incident
   */
  close(lessonsLearned) {
    this.status = 'closed';
    this.lessonsLearned = lessonsLearned;
    this.updatedAt = new Date();
  }

  /**
   * Add affected asset
   */
  addAffectedAsset(asset) {
    if (!this.affectedAssets.find(a => a.id === asset.id)) {
      this.affectedAssets.push(asset);
      this.updatedAt = new Date();
    }
  }

  /**
   * Add related event
   */
  addRelatedEvent(eventId) {
    if (!this.relatedEvents.includes(eventId)) {
      this.relatedEvents.push(eventId);
      this.updatedAt = new Date();
    }
  }

  /**
   * Get severity priority for sorting
   */
  getSeverityPriority() {
    const priorities = {
      info: 0,
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
    return priorities[this.severity] || 2;
  }

  /**
   * Check if incident is critical
   */
  isCritical() {
    return this.severity === 'critical';
  }

  /**
   * Check if incident is high severity
   */
  isHighSeverity() {
    return ['high', 'critical'].includes(this.severity);
  }

  /**
   * Check if incident is active
   */
  isActive() {
    return ['open', 'investigating', 'contained'].includes(this.status);
  }

  /**
   * Check if incident is resolved
   */
  isResolved() {
    return ['resolved', 'closed'].includes(this.status);
  }

  /**
   * Calculate duration in hours
   */
  getDurationInHours() {
    const endTime = this.resolvedAt ? new Date(this.resolvedAt) : new Date();
    const startTime = new Date(this.detectedAt);
    return Math.floor((endTime - startTime) / (1000 * 60 * 60));
  }

  /**
   * Calculate duration in days
   */
  getDurationInDays() {
    return Math.ceil(this.getDurationInHours() / 24);
  }

  /**
   * Check if incident is old (older than 24 hours)
   */
  isOld() {
    return this.getDurationInHours() > 24;
  }

  /**
   * Check if incident is very old (older than 7 days)
   */
  isVeryOld() {
    return this.getDurationInDays() > 7;
  }

  /**
   * Get incident priority for SLA tracking
   */
  getSLAPriority() {
    if (this.severity === 'critical') return 'P1 - Critical';
    if (this.severity === 'high') return 'P2 - High';
    if (this.severity === 'medium') return 'P3 - Medium';
    return 'P4 - Low';
  }

  /**
   * Get SLA target in hours
   */
  getSLATarget() {
    const targets = {
      critical: 1,    // 1 hour
      high: 4,       // 4 hours
      medium: 24,    // 24 hours
      low: 72        // 72 hours
    };
    return targets[this.severity] || 24;
  }

  /**
   * Check if SLA is breached
   */
  isSLABreached() {
    if (this.isResolved()) {
      return this.getDurationInHours() > this.getSLATarget();
    }
    return this.getDurationInHours() > this.getSLATarget();
  }

  /**
   * Get SLA status
   */
  getSLAStatus() {
    if (this.isResolved()) {
      return this.isSLABreached() ? 'breached' : 'met';
    }
    if (this.isSLABreached()) {
      return 'breached';
    }
    const remainingHours = this.getSLATarget() - this.getDurationInHours();
    return remainingHours < 4 ? 'at_risk' : 'on_track';
  }

  /**
   * Get incident status progression
   */
  getStatusProgression() {
    const progression = [];

    if (this.detectedAt) {
      progression.push({
        status: 'detected',
        timestamp: this.detectedAt.toISOString(),
        description: 'Incident detected'
      });
    }

    if (this.status === 'investigating' || this.status === 'contained' || this.status === 'resolved' || this.status === 'closed') {
      progression.push({
        status: 'investigating',
        timestamp: this.updatedAt.toISOString(),
        description: 'Investigation started'
      });
    }

    if (this.status === 'contained' || this.status === 'resolved' || this.status === 'closed') {
      progression.push({
        status: 'contained',
        timestamp: this.updatedAt.toISOString(),
        description: 'Incident contained'
      });
    }

    if (this.status === 'resolved' || this.status === 'closed') {
      progression.push({
        status: 'resolved',
        timestamp: this.resolvedAt.toISOString(),
        description: 'Incident resolved'
      });
    }

    if (this.status === 'closed') {
      progression.push({
        status: 'closed',
        timestamp: this.updatedAt.toISOString(),
        description: 'Incident closed'
      });
    }

    return progression;
  }

  /**
   * Convert to JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      severity: this.severity,
      status: this.status,
      incidentType: this.incidentType,
      source: this.source,
      affectedAssets: this.affectedAssets,
      impactAssessment: this.impactAssessment,
      detectedAt: this.detectedAt.toISOString(),
      reportedBy: this.reportedBy,
      assignedTo: this.assignedTo,
      resolvedAt: this.resolvedAt ? this.resolvedAt.toISOString() : null,
      resolutionSummary: this.resolutionSummary,
      lessonsLearned: this.lessonsLearned,
      relatedEvents: this.relatedEvents,
      metadata: this.metadata,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      durationInHours: this.getDurationInHours(),
      durationInDays: this.getDurationInDays(),
      slaPriority: this.getSLAPriority(),
      slaTarget: this.getSLATarget(),
      slaStatus: this.getSLAStatus(),
      statusProgression: this.getStatusProgression()
    };
  }

  /**
   * Create summary representation
   */
  toSummary() {
    return {
      id: this.id,
      title: this.title,
      severity: this.severity,
      status: this.status,
      incidentType: this.incidentType,
      detectedAt: this.detectedAt.toISOString(),
      assignedTo: this.assignedTo,
      durationInHours: this.getDurationInHours(),
      slaStatus: this.getSLAStatus(),
      isActive: this.isActive()
    };
  }
}

module.exports = SecurityIncident;