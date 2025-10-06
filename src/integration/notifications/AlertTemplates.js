/**
 * Alert Templates - Predefined templates for security alert notifications
 * Provides structured templates for different types of security events and alerts
 */

class AlertTemplates {
  constructor() {
    this.templates = new Map();
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default alert templates
   */
  initializeDefaultTemplates() {
    // Security breach templates
    this.templates.set('security_breach_detected', {
      title: 'Security Breach Detected',
      message: 'A potential security breach has been detected and requires immediate attention.',
      severity: 'critical',
      type: 'security_breach',
      actions: ['investigate', 'contain', 'notify_team'],
      metadata: {
        category: 'incident',
        urgency: 'immediate',
        responseRequired: true
      }
    });

    this.templates.set('brute_force_attack', {
      title: 'Brute Force Attack Detected',
      message: 'Multiple failed login attempts detected from {ipAddress} indicating a brute force attack.',
      severity: 'high',
      type: 'brute_force',
      actions: ['investigate', 'block_ip', 'notify_user'],
      metadata: {
        category: 'attack',
        urgency: 'high',
        responseRequired: true
      }
    });

    this.templates.set('credential_stuffing', {
      'title': 'Credential Stuffing Attack Detected',
      'message': 'Credential stuffing attack detected using {failedCount} different usernames from {ipAddress}.',
      'severity': 'high',
      'type': 'credential_stuffing',
      actions: ['investigate', 'block_ip', 'monitor_accounts'],
      metadata: {
        category: 'attack',
        urgency: 'high',
        responseRequired: true
      }
    });

    this.templates.set('malware_detected', {
      title: 'Malware Detection Alert',
      message: 'Malicious software or activity detected: {threatType}. Immediate action required.',
      severity: 'critical',
      type: 'malware',
      actions: ['quarantine', 'scan_system', 'notify_team'],
      metadata: {
        category: 'malware',
        urgency: 'critical',
        responseRequired: true
      }
    });

    this.templates.set('vulnerability_found', {
      title: 'Security Vulnerability Detected',
      message: 'A {severity} security vulnerability has been identified in {component}: {vulnerability}.',
      severity: 'medium',
      type: 'vulnerability',
      actions: ['assess_risk', 'patch', 'document'],
      metadata: {
        category: 'vulnerability',
        urgency: 'medium',
        responseRequired: false
      }
    });

    // User activity templates
    this.templates.set('suspicious_login', {
      title: 'Suspicious Login Activity',
      message: 'Suspicious login activity detected for user {username} from {ipAddress}.',
      severity: 'medium',
      type: 'suspicious_activity',
      actions: ['verify_user', 'monitor_activity', 'notify_user'],
      metadata: {
        category: 'user_activity',
        urgency: 'medium',
        responseRequired: true
      }
    });

    this.templates.set('unusual_access_pattern', {
      title: 'Unusual Access Pattern Detected',
      message: 'Unusual access pattern detected for user {username}. Access from {location} at {time} is outside normal behavior.',
      severity: 'medium',
      type: 'behavioral_anomaly',
      actions: ['verify_user', 'monitor_activity', 'contact_user'],
      metadata: {
        category: 'behavioral_anomaly',
        urgency: 'medium',
        responseRequired: true
      }
    });

    this.templates.set('privilege_escalation', {
      title: 'Privilege Escalation Attempt',
      message: 'Privilege escalation attempt detected for user {username}. User attempted to access {resource} without proper authorization.',
      severity: 'high',
      type: 'privilege_escalation',
      actions: ['investigate', 'block_access', 'notify_admin'],
      metadata: {
        category: 'authorization',
        urgency: 'high',
        responseRequired: true
      }
    });

    // Account security templates
    this.templates.set('account_locked', {
      title: 'Account Locked',
      message: 'Account for user {username} has been locked due to {reason}.',
      severity: 'high',
      type: 'account_security',
      actions: ['investigate', 'unlock_procedure', 'notify_user'],
      metadata: {
        category: 'account_security',
        urgency: 'high',
        responseRequired: true
      }
    });

    this.templates.set('password_reset', {
      title: 'Password Reset Request',
      message: 'Password reset request received for user {username} from {ipAddress}.',
      severity: 'medium',
      type: 'account_security',
      actions: ['verify_request', 'reset_password', 'notify_user'],
      metadata: {
        category: 'account_security',
        urgency: 'medium',
        responseRequired: true
      }
    });

    this.templates.set('account_takeover', {
      title: 'Account Takeover Suspicion',
      message: 'Suspicious activity detected indicating possible account takeover for user {username}. Multiple security indicators triggered.',
      severity: 'critical',
      type: 'account_takeover',
      actions: ['immediate_lock', 'investigate', 'contact_user'],
      metadata: {
        category: 'account_takeover',
        urgency: 'critical',
        context: 'incident'
      }
    });

    // System security templates
    this.templates.set('system_anomaly_detected', {
      title: 'System Anomaly Detected',
      message: 'Unusual system behavior detected: {anomalyType}. System performance may be impacted.',
      severity: 'medium',
      type: 'system_anomaly',
      actions: ['investigate', 'monitor_system', 'notify_admin'],
      metadata: {
        category: 'system_anomaly',
        urgency: 'medium',
        responseRequired: true
      }
    });

    this.templates.set('database_access_anomaly', {
      title: 'Database Access Anomaly',
      message: 'Unusual database access pattern detected: {accessType}. {queryCount} queries executed in {timeWindow}.',
      severity: 'medium',
      type: 'data_access',
      actions: ['investigate', 'monitor_queries', 'notify_db_admin'],
      metadata: {
        category: 'data_access',
        urgency: 'medium',
        responseRequired: true
      }
    });

    this.templates.set('api_abuse_detected', {
      title: 'API Abuse Detected',
      message: 'API abuse detected from {ipAddress}. {requestCount} requests in {timeWindow} indicates potential abuse.',
      severity: 'high',
      type: 'api_abuse',
      actions: ['rate_limit', 'block_ip', 'investigate'],
      metadata: {
        category: 'api_abuse',
        urgency: 'high',
        responseRequired: true
      }
    });

    // Compliance templates
    this.templates.set('compliance_violation', {
      title: 'Compliance Violation Detected',
      message: 'Compliance violation detected: {violationType}. This may impact regulatory requirements.',
      severity: 'high',
      type: 'compliance',
      actions: ['document_incident', 'notify_compliance_officer', 'remediate'],
      metadata: {
        category: 'compliance',
        urgency: 'high',
        responseRequired: true
      }
    });

    this.templates.set('data_access_violation', {
      title: 'Data Access Violation',
      message: 'Unauthorized data access detected: {accessType}. User {username} accessed {dataResource} without proper authorization.',
      severity: 'high',
      type: 'data_access',
      actions: ['revoke_access', 'investigate', 'notify_admin'],
      metadata: {
        category: 'data_access',
        urgency: 'high',
        responseRequired: true
      }
    });

    // Incident management templates
    this.templates.set('incident_created', {
      title: 'Security Incident Created',
      message: 'Security incident #{incidentId} has been created: {title}. Assigned to: {assignee}.',
      severity: 'medium',
      type: 'incident_management',
      actions: ['investigate', 'update_status', 'notify_team'],
      metadata: {
        category: 'incident_management',
        urgency: 'medium',
        responseRequired: true
      }
    });

    this.templates.set('incident_escalated', {
      title: 'Security Incident Escalated',
      message: 'Security incident #{incidentId} has been escalated to {newLevel}: {escalationReason}.',
      severity: 'high',
      type: 'incident_management',
      actions: ['review_escalation', 'update_team', 'notify_management'],
      metadata: {
        category: 'incident_management',
        urgency: 'high',
        responseRequired: true
      }
    });

    this.templates.set('incident_resolved', {
      title: 'Security Incident Resolved',
      message: 'Security incident #{incidentId} has been resolved: {resolution}. Total duration: {duration}.',
      severity: 'low',
      type: 'incident_management',
      actions: ['document_resolution', 'close_incident', 'notify_team'],
      metadata: {
        category: 'incident_management',
        urgency: 'low',
        responseRequired: false
      }
    });

    // Informational templates
    this.templates.set('security_scan_completed', {
      title: 'Security Scan Completed',
      message: 'Security scan completed successfully. {scansCompleted} scans performed, {issuesFound} issues found, {issuesFixed} issues fixed.',
      severity: 'info',
      type: 'scan_result',
      actions: ['review_results', 'address_issues', 'schedule_next_scan'],
      metadata: {
        category: 'scan_result',
        urgency: 'low',
        responseRequired: false
      }
    });

    this.templates.set('security_system_update', {
      title: 'Security System Update',
      message: 'Security system has been updated to version {version}. {changesCount} security improvements and enhancements implemented.',
      severity: 'info',
      type: 'system_update',
      actions: ['review_changes', 'test_functionality', 'document_update'],
      metadata: {
        category: 'system_update',
        urgency: 'low',
        responseRequired: false
      }
    });

    logger.debug('Default alert templates initialized', {
      templatesCount: this.templates.size
    });
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId) {
    return this.templates.get(templateId);
  }

  /**
   * Get template with variable substitution
   */
  getPopulatedTemplate(templateId, variables = {}) {
    const template = this.templates.get(templateId);
    if (!template) {
      return null;
    }

    return this.populateTemplate(template, variables);
  }

  /**
   * Populate template with variables
   */
  populateTemplate(template, variables) {
    const populated = { ...template };

    // Replace variables in title
    if (template.title) {
      populated.title = this.replaceVariables(template.title, variables);
    }

    // Replace variables in message
    if (template.message) {
      populated.message = this.replaceVariables(template.message, variables);
    }

    // Add variable metadata
    if (template.metadata) {
      populated.metadata = { ...template.metadata };
      Object.assign(populated.metadata, variables);
    }

    return populated;
  }

  /**
   * Replace variables in text
   */
  replaceVariables(text, variables) {
    let result = text;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}]/g, '\\$&'), 'g'), value);
    }

    return result;
  }

  /**
   * Add custom template
   */
  addTemplate(templateId, template) {
    this.templates.set(templateId, template);
    logger.debug('Custom alert template added', { templateId });
  }

  /**
   * Remove template
   */
  removeTemplate(templateId) {
    const removed = this.templates.delete(templateId);
    if (removed) {
      logger.debug('Alert template removed', { templateId });
    }
    return removed;
  }

  /**
   * Get all templates
   */
  getAllTemplates() {
    return Array.from(this.templates.entries()).map(([id, template]) => ({
      id,
      ...template
    }));
  }

  /**
   * Get templates by severity
   */
  getTemplatesBySeverity(severity) {
    return Array.from(this.templates.values())
      .filter(template => template.severity === severity);
  }

  /**
   * Get templates by type
   */
  getTemplatesByType(type) {
    return Array.from(this.templates.values())
      .filter(template => template.type === type);
  }

  /**
   * Get template categories
   */
  getTemplateCategories() {
    const categories = new Set();

    for (const template of this.templates.values()) {
      if (template.metadata && template.metadata.category) {
        categories.add(template.metadata.category);
      }
    }

    return Array.from(categories);
  }

  /**
   * Validate template structure
   */
  validateTemplate(template) {
    const requiredFields = ['title', 'message', 'severity', 'type'];
    const missingFields = requiredFields.filter(field => !template[field]);

    if (missingFields.length > 0) {
      throw new Error(`Template missing required fields: ${missingFields.join(', ')}`);
    }

    if (!['critical', 'high', 'medium', 'low', 'info'].includes(template.severity)) {
      throw new Error(`Invalid severity level: ${template.severity}`);
    }

    return true;
  }

  /**
   * Get template statistics
   */
  getStatistics() {
    const categories = this.getTemplateCategories();
    const types = new Set();

    for (const template of this.templates.values()) {
      types.add(template.type);
    }

    return {
      totalTemplates: this.templates.size,
      categories: categories.length,
      types: types.length,
      severityDistribution: {
        critical: this.getTemplatesBySeverity('critical').length,
        high: this.getTemplatesBySeverity('high').length,
        medium: this.getTemplatesBySeverity('medium').length,
        low: this.getTemplatesBySeverity('low').length,
        info: this.getTemplatesBySeverity('info').length
      }
    };
  }

  /**
   * Export templates for backup
   */
  exportTemplates() {
    const templates = {};
    for (const [id, template] of this.templates.entries()) {
      templates[id] = { ...template };
    }
    return templates;
  }

  /**
   * Import templates from backup
   */
  importTemplates(templates) {
    try {
      for (const [id, template] of Object.entries(templates)) {
        this.validateTemplate(template);
        this.templates.set(id, template);
      }

      logger.info('Alert templates imported', {
        importedCount: Object.keys(templates).length
      });

    } catch (error) {
      logger.error('Error importing alert templates', { error: error.message });
      throw error;
    }
  }
}

module.exports = AlertTemplates;