/**
 * Security Policy Management System
 * Comprehensive policy definition, versioning, and lifecycle management
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const winston = require('winston');
const { QueryBuilder } = require('../database/QueryBuilder');

class PolicyManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      storagePath: config.storagePath || 'policies',
      approvalRequired: config.approvalRequired !== false,
      versionControl: config.versionControl !== false,
      autoReview: config.autoReview !== false,
      reviewPeriod: config.reviewPeriod || 365, // days
      templateLibrary: config.templateLibrary !== false,
      policyCategories: config.policyCategories || [
        'access_control',
        'data_protection',
        'incident_response',
        'risk_management',
        'security_architecture',
        'compliance',
        'physical_security',
        'employee_security',
        'vendor_security',
        'business_continuity'
      ],
      severityLevels: config.severityLevels || ['critical', 'high', 'medium', 'low'],
      approvalWorkflow: config.approvalWorkflow || ['security_officer', 'compliance_manager', 'director'],
      ...config
    };

    // Initialize database query builder
    this.queryBuilder = new QueryBuilder();

    // Policy templates library
    this.templates = new Map();

    // Active policies cache
    this.activePolicies = new Map();
    this.policyVersions = new Map();

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
          filename: 'logs/policy-manager.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize policy manager
   */
  async initialize() {
    try {
      // Initialize database schema
      await this.initializePolicySchema();

      // Initialize policy templates
      await this.initializePolicyTemplates();

      // Load active policies
      await this.loadActivePolicies();

      // Start automated policy reviews
      if (this.config.autoReview) {
        this.startAutomatedReviews();
      }

      this.logger.info('Security policy manager initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize policy manager:', error);
      throw error;
    }
  }

  /**
   * Initialize policy database schema
   */
  async initializePolicySchema() {
    try {
      const schemas = [
        // Policies table
        `CREATE TABLE IF NOT EXISTS security_policies (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          policy_id VARCHAR(100) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          category VARCHAR(100) NOT NULL,
          description TEXT NOT NULL,
          content TEXT NOT NULL,
          severity VARCHAR(50) NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          status VARCHAR(50) NOT NULL,
          owner VARCHAR(255) NOT NULL,
          approvers VARCHAR(255)[],
          effective_date TIMESTAMP,
          expiry_date TIMESTAMP,
          review_date TIMESTAMP,
          tags TEXT[],
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // Policy versions table
        `CREATE TABLE IF NOT EXISTS policy_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          policy_id VARCHAR(100) NOT NULL,
          version INTEGER NOT NULL,
          content TEXT NOT NULL,
          change_description TEXT,
          created_by VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (policy_id) REFERENCES security_policies(policy_id)
        )`,

        // Policy approvals table
        `CREATE TABLE IF NOT EXISTS policy_approvals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          policy_id VARCHAR(100) NOT NULL,
          version INTEGER NOT NULL,
          approver VARCHAR(255) NOT NULL,
          approver_role VARCHAR(100) NOT NULL,
          status VARCHAR(50) NOT NULL,
          comments TEXT,
          approved_at TIMESTAMP,
          FOREIGN KEY (policy_id) REFERENCES security_policies(policy_id)
        )`,

        // Policy reviews table
        `CREATE TABLE IF NOT EXISTS policy_reviews (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          policy_id VARCHAR(100) NOT NULL,
          review_date TIMESTAMP NOT NULL,
          reviewer VARCHAR(255) NOT NULL,
          review_type VARCHAR(50) NOT NULL,
          findings TEXT[],
          recommendations TEXT[],
          status VARCHAR(50) NOT NULL,
          next_review_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (policy_id) REFERENCES security_policies(policy_id)
        )`,

        // Policy violations table
        `CREATE TABLE IF NOT EXISTS policy_violations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          policy_id VARCHAR(100) NOT NULL,
          violation_date TIMESTAMP NOT NULL,
          violated_by VARCHAR(255) NOT NULL,
          violation_type VARCHAR(100) NOT NULL,
          description TEXT NOT NULL,
          severity VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          remediation_required BOOLEAN DEFAULT true,
          remediation_plan TEXT,
          remediation_due_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (policy_id) REFERENCES security_policies(policy_id)
        )`,

        // Policy acknowledgments table
        `CREATE TABLE IF NOT EXISTS policy_acknowledgments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          policy_id VARCHAR(100) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          acknowledgment_date TIMESTAMP NOT NULL,
          acknowledgment_type VARCHAR(50) NOT NULL,
          ip_address INET,
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (policy_id) REFERENCES security_policies(policy_id)
        )`
      ];

      for (const schema of schemas) {
        await this.queryBuilder.execute(schema);
      }

      this.logger.info('Policy database schema initialized');

    } catch (error) {
      this.logger.error('Failed to initialize policy schema:', error);
      throw error;
    }
  }

  /**
   * Initialize policy templates
   */
  async initializePolicyTemplates() {
    try {
      const templates = [
        {
          id: 'access_control_template',
          name: 'Access Control Policy Template',
          category: 'access_control',
          description: 'Template for defining access control policies',
          severity: 'high',
          content: this.getAccessControlTemplate(),
          tags: ['template', 'access_control', 'security']
        },
        {
          id: 'data_protection_template',
          name: 'Data Protection Policy Template',
          category: 'data_protection',
          description: 'Template for defining data protection policies',
          severity: 'critical',
          content: this.getDataProtectionTemplate(),
          tags: ['template', 'data_protection', 'privacy']
        },
        {
          id: 'incident_response_template',
          name: 'Incident Response Policy Template',
          category: 'incident_response',
          description: 'Template for defining incident response procedures',
          severity: 'critical',
          content: this.getIncidentResponseTemplate(),
          tags: ['template', 'incident_response', 'emergency']
        }
      ];

      for (const template of templates) {
        this.templates.set(template.id, template);
      }

      this.logger.info('Policy templates initialized');

    } catch (error) {
      this.logger.error('Failed to initialize policy templates:', error);
      throw error;
    }
  }

  /**
   * Create new security policy
   */
  async createPolicy(policyData) {
    try {
      const policyId = this.generatePolicyId();
      const timestamp = new Date();

      const policy = {
        policyId,
        name: policyData.name,
        category: policyData.category,
        description: policyData.description,
        content: policyData.content,
        severity: policyData.severity || 'medium',
        version: 1,
        status: 'draft',
        owner: policyData.owner,
        approvers: policyData.approvers || this.config.approvalWorkflow,
        tags: policyData.tags || [],
        metadata: policyData.metadata || {},
        effectiveDate: policyData.effectiveDate,
        expiryDate: policyData.expiryDate,
        reviewDate: policyData.reviewDate || new Date(Date.now() + this.config.reviewPeriod * 24 * 60 * 60 * 1000)
      };

      // Validate policy data
      await this.validatePolicy(policy);

      // Save policy to database
      await this.savePolicy(policy);

      // Save initial version
      await this.savePolicyVersion(policyId, 1, policy.content, policy.owner, 'Initial version');

      // Update cache
      this.activePolicies.set(policyId, policy);

      // Start approval workflow if required
      if (this.config.approvalRequired) {
        await this.initiateApprovalWorkflow(policy);
      }

      // Emit policy created event
      this.emit('policyCreated', policy);

      this.logger.info(`Security policy created: ${policyId}`);

      return policy;

    } catch (error) {
      this.logger.error('Failed to create policy:', error);
      throw error;
    }
  }

  /**
   * Update existing policy
   */
  async updatePolicy(policyId, updateData) {
    try {
      const existingPolicy = await this.getPolicy(policyId);
      if (!existingPolicy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      // Check if policy is in a state that allows updates
      if (existingPolicy.status === 'approved' && this.config.approvalRequired) {
        throw new Error('Cannot update approved policy without approval workflow');
      }

      const newVersion = existingPolicy.version + 1;
      const updatedPolicy = {
        ...existingPolicy,
        ...updateData,
        version: newVersion,
        updatedAt: new Date()
      };

      // Validate updated policy
      await this.validatePolicy(updatedPolicy);

      // Save updated policy
      await this.savePolicy(updatedPolicy);

      // Save new version
      const changeDescription = updateData.changeDescription || `Updated to version ${newVersion}`;
      await this.savePolicyVersion(policyId, newVersion, updatedPolicy.content, updateData.updatedBy, changeDescription);

      // Update cache
      this.activePolicies.set(policyId, updatedPolicy);

      // Reset status to draft if approval required
      if (this.config.approvalRequired) {
        updatedPolicy.status = 'draft';
        await this.updatePolicyStatus(policyId, 'draft');
        await this.initiateApprovalWorkflow(updatedPolicy);
      }

      // Emit policy updated event
      this.emit('policyUpdated', {
        policyId,
        oldVersion: existingPolicy.version,
        newVersion: newVersion,
        updatedBy: updateData.updatedBy
      });

      this.logger.info(`Security policy updated: ${policyId} to version ${newVersion}`);

      return updatedPolicy;

    } catch (error) {
      this.logger.error(`Failed to update policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * Approve policy
   */
  async approvePolicy(policyId, approvalData) {
    try {
      const policy = await this.getPolicy(policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      // Record approval
      await this.recordApproval(policyId, policy.version, approvalData);

      // Check if all required approvals are received
      const approvals = await this.getPolicyApprovals(policyId, policy.version);
      const requiredApprovers = policy.approvers.length;
      const receivedApprovals = approvals.filter(a => a.status === 'approved').length;

      if (receivedApprovals >= requiredApprovers) {
        // All approvals received, activate policy
        await this.updatePolicyStatus(policyId, 'approved');
        policy.status = 'approved';
        policy.approvedAt = new Date();

        // Set effective date if not provided
        if (!policy.effectiveDate) {
          policy.effectiveDate = new Date();
          await this.updatePolicyEffectiveDate(policyId, policy.effectiveDate);
        }

        // Emit policy approved event
        this.emit('policyApproved', {
          policyId,
          version: policy.version,
          approvals: approvals
        });

        this.logger.info(`Policy approved: ${policyId}`);
      }

      return {
        policyId,
        currentApprovals: receivedApprovals,
        requiredApprovals,
        fullyApproved: receivedApprovals >= requiredApprovers
      };

    } catch (error) {
      this.logger.error(`Failed to approve policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * Enforce policy
   */
  async enforcePolicy(policyId, enforcementData) {
    try {
      const policy = await this.getPolicy(policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      if (policy.status !== 'approved') {
        throw new Error(`Cannot enforce unapproved policy: ${policyId}`);
      }

      // Create enforcement record
      const enforcement = {
        policyId,
        enforcedBy: enforcementData.enforcedBy,
        enforcementDate: new Date(),
        enforcementType: enforcementData.enforcementType || 'manual',
        scope: enforcementData.scope || 'all',
        notes: enforcementData.notes
      };

      // Store enforcement record
      await this.savePolicyEnforcement(enforcement);

      // Update policy status to enforced
      await this.updatePolicyStatus(policyId, 'enforced');

      // Emit policy enforced event
      this.emit('policyEnforced', {
        policyId,
        enforcement
      });

      this.logger.info(`Policy enforced: ${policyId}`);

      return enforcement;

    } catch (error) {
      this.logger.error(`Failed to enforce policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * Record policy violation
   */
  async recordViolation(violationData) {
    try {
      const policy = await this.getPolicy(violationData.policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${violationData.policyId}`);
      }

      const violation = {
        id: crypto.randomUUID(),
        policyId: violationData.policyId,
        violationDate: new Date(),
        violatedBy: violationData.violatedBy,
        violationType: violationData.violationType,
        description: violationData.description,
        severity: violationData.severity || 'medium',
        status: 'open',
        remediationRequired: violationData.remediationRequired !== false,
        remediationPlan: violationData.remediationPlan,
        remediationDueDate: violationData.remediationDueDate
      };

      // Save violation to database
      await this.savePolicyViolation(violation);

      // Emit violation recorded event
      this.emit('violationRecorded', violation);

      this.logger.warn(`Policy violation recorded: ${violation.policyId} by ${violation.violatedBy}`);

      return violation;

    } catch (error) {
      this.logger.error('Failed to record policy violation:', error);
      throw error;
    }
  }

  /**
   * Review policy
   */
  async reviewPolicy(policyId, reviewData) {
    try {
      const policy = await this.getPolicy(policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      const review = {
        policyId,
        reviewDate: new Date(),
        reviewer: reviewData.reviewer,
        reviewType: reviewData.reviewType || 'scheduled',
        findings: reviewData.findings || [],
        recommendations: reviewData.recommendations || [],
        status: reviewData.status || 'completed',
        nextReviewDate: reviewData.nextReviewDate || new Date(Date.now() + this.config.reviewPeriod * 24 * 60 * 60 * 1000)
      };

      // Save review to database
      await this.savePolicyReview(review);

      // Update policy review date
      await this.updatePolicyReviewDate(policyId, review.nextReviewDate);

      // Emit review completed event
      this.emit('policyReviewed', review);

      this.logger.info(`Policy review completed: ${policyId}`);

      return review;

    } catch (error) {
      this.logger.error(`Failed to review policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * Get policy by ID
   */
  async getPolicy(policyId) {
    try {
      // Check cache first
      if (this.activePolicies.has(policyId)) {
        return this.activePolicies.get(policyId);
      }

      // Query database
      const query = this.queryBuilder
        .select('*')
        .from('security_policies')
        .where('policy_id', '=', policyId);

      const results = await this.queryBuilder.execute(query);
      if (results.length === 0) {
        return null;
      }

      const policy = results[0];

      // Get policy versions
      const versionsQuery = this.queryBuilder
        .select('*')
        .from('policy_versions')
        .where('policy_id', '=', policyId)
        .orderBy('version', 'DESC');

      const versions = await this.queryBuilder.execute(versionsQuery);
      this.policyVersions.set(policyId, versions);

      // Cache policy
      this.activePolicies.set(policyId, policy);

      return policy;

    } catch (error) {
      this.logger.error(`Failed to get policy ${policyId}:`, error);
      return null;
    }
  }

  /**
   * Get policies by criteria
   */
  async getPolicies(criteria = {}) {
    try {
      let query = this.queryBuilder
        .select('*')
        .from('security_policies');

      // Apply filters
      if (criteria.category) {
        query = query.where('category', '=', criteria.category);
      }
      if (criteria.status) {
        query = query.where('status', '=', criteria.status);
      }
      if (criteria.severity) {
        query = query.where('severity', '=', criteria.severity);
      }
      if (criteria.owner) {
        query = query.where('owner', '=', criteria.owner);
      }
      if (criteria.effective) {
        query = query.where('effective_date', '<=', new Date())
                     .where('expiry_date', '>=', new Date());
      }

      // Apply ordering
      query = query.orderBy('updated_at', 'DESC');

      if (criteria.limit) {
        query = query.limit(criteria.limit);
      }

      const results = await this.queryBuilder.execute(query);
      return results;

    } catch (error) {
      this.logger.error('Failed to get policies:', error);
      return [];
    }
  }

  /**
   * Get policy violations
   */
  async getPolicyViolations(criteria = {}) {
    try {
      let query = this.queryBuilder
        .select('pv.*', 'sp.name as policy_name', 'sp.category as policy_category')
        .from('policy_violations pv')
        .join('security_policies sp', 'pv.policy_id', '=', 'sp.policy_id');

      // Apply filters
      if (criteria.policyId) {
        query = query.where('pv.policy_id', '=', criteria.policyId);
      }
      if (criteria.violatedBy) {
        query = query.where('pv.violated_by', '=', criteria.violatedBy);
      }
      if (criteria.severity) {
        query = query.where('pv.severity', '=', criteria.severity);
      }
      if (criteria.status) {
        query = query.where('pv.status', '=', criteria.status);
      }
      if (criteria.since) {
        query = query.where('pv.violation_date', '>=', criteria.since);
      }

      // Apply ordering
      query = query.orderBy('pv.violation_date', 'DESC');

      if (criteria.limit) {
        query = query.limit(criteria.limit);
      }

      const results = await this.queryBuilder.execute(query);
      return results;

    } catch (error) {
      this.logger.error('Failed to get policy violations:', error);
      return [];
    }
  }

  /**
   * Get policy statistics
   */
  async getPolicyStatistics() {
    try {
      const stats = {
        total: 0,
        byStatus: {},
        byCategory: {},
        bySeverity: {},
        violations: {
          total: 0,
          open: 0,
          resolved: 0
        },
        compliance: {
          enforced: 0,
          approved: 0,
          draft: 0
        }
      };

      // Get policy counts by status
      const statusQuery = this.queryBuilder
        .select('status', 'COUNT(*) as count')
        .from('security_policies')
        .groupBy('status');

      const statusResults = await this.queryBuilder.execute(statusQuery);
      for (const row of statusResults) {
        stats.total += parseInt(row.count);
        stats.byStatus[row.status] = parseInt(row.count);
      }

      // Get policy counts by category
      const categoryQuery = this.queryBuilder
        .select('category', 'COUNT(*) as count')
        .from('security_policies')
        .groupBy('category');

      const categoryResults = await this.queryBuilder.execute(categoryQuery);
      for (const row of categoryResults) {
        stats.byCategory[row.category] = parseInt(row.count);
      }

      // Get policy counts by severity
      const severityQuery = this.queryBuilder
        .select('severity', 'COUNT(*) as count')
        .from('security_policies')
        .groupBy('severity');

      const severityResults = await this.queryBuilder.execute(severityQuery);
      for (const row of severityResults) {
        stats.bySeverity[row.severity] = parseInt(row.count);
      }

      // Get violation statistics
      const violationQuery = this.queryBuilder
        .select('status', 'COUNT(*) as count')
        .from('policy_violations')
        .groupBy('status');

      const violationResults = await this.queryBuilder.execute(violationQuery);
      for (const row of violationResults) {
        stats.violations.total += parseInt(row.count);
        if (row.status === 'open') {
          stats.violations.open = parseInt(row.count);
        } else if (row.status === 'resolved') {
          stats.violations.resolved = parseInt(row.count);
        }
      }

      // Calculate compliance metrics
      stats.compliance.approved = stats.byStatus.approved || 0;
      stats.compliance.enforced = stats.byStatus.enforced || 0;
      stats.compliance.draft = stats.byStatus.draft || 0;

      return stats;

    } catch (error) {
      this.logger.error('Failed to get policy statistics:', error);
      return {
        total: 0,
        byStatus: {},
        byCategory: {},
        bySeverity: {},
        violations: { total: 0, open: 0, resolved: 0 },
        compliance: { enforced: 0, approved: 0, draft: 0 }
      };
    }
  }

  /**
   * Validate policy data
   */
  async validatePolicy(policy) {
    try {
      const errors = [];

      // Required fields validation
      if (!policy.name || policy.name.trim() === '') {
        errors.push('Policy name is required');
      }
      if (!policy.category || !this.config.policyCategories.includes(policy.category)) {
        errors.push('Valid policy category is required');
      }
      if (!policy.content || policy.content.trim() === '') {
        errors.push('Policy content is required');
      }
      if (!policy.severity || !this.config.severityLevels.includes(policy.severity)) {
        errors.push('Valid severity level is required');
      }
      if (!policy.owner || policy.owner.trim() === '') {
        errors.push('Policy owner is required');
      }

      // Content validation
      if (policy.content.length < 100) {
        errors.push('Policy content must be at least 100 characters');
      }

      // Date validation
      if (policy.effectiveDate && policy.expiryDate && policy.effectiveDate >= policy.expiryDate) {
        errors.push('Effective date must be before expiry date');
      }

      // Custom validation based on category
      await this.validatePolicyCategory(policy, errors);

      if (errors.length > 0) {
        throw new Error(`Policy validation failed: ${errors.join(', ')}`);
      }

      return true;

    } catch (error) {
      this.logger.error('Policy validation failed:', error);
      throw error;
    }
  }

  /**
   * Validate policy category-specific requirements
   */
  async validatePolicyCategory(policy, errors) {
    try {
      switch (policy.category) {
        case 'access_control':
          if (!policy.content.includes('authentication') && !policy.content.includes('authorization')) {
            errors.push('Access control policy must include authentication or authorization requirements');
          }
          break;
        case 'data_protection':
          if (!policy.content.includes('encryption') && !policy.content.includes('classification')) {
            errors.push('Data protection policy must include encryption or data classification requirements');
          }
          break;
        case 'incident_response':
          if (!policy.content.includes('response') && !policy.content.includes('notification')) {
            errors.push('Incident response policy must include response or notification procedures');
          }
          break;
      }

    } catch (error) {
      this.logger.error('Policy category validation failed:', error);
      errors.push('Category validation failed');
    }
  }

  /**
   * Save policy to database
   */
  async savePolicy(policy) {
    try {
      const query = this.queryBuilder
        .insert('security_policies')
        .values({
          policy_id: policy.policyId,
          name: policy.name,
          category: policy.category,
          description: policy.description,
          content: policy.content,
          severity: policy.severity,
          version: policy.version,
          status: policy.status,
          owner: policy.owner,
          approvers: policy.approvers,
          effective_date: policy.effectiveDate,
          expiry_date: policy.expiryDate,
          review_date: policy.reviewDate,
          tags: policy.tags,
          metadata: policy.metadata
        });

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to save policy:', error);
      throw error;
    }
  }

  /**
   * Save policy version
   */
  async savePolicyVersion(policyId, version, content, createdBy, changeDescription) {
    try {
      const query = this.queryBuilder
        .insert('policy_versions')
        .values({
          policy_id: policyId,
          version: version,
          content: content,
          change_description: changeDescription,
          created_by: createdBy
        });

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to save policy version:', error);
      throw error;
    }
  }

  /**
   * Record policy approval
   */
  async recordApproval(policyId, version, approvalData) {
    try {
      const query = this.queryBuilder
        .insert('policy_approvals')
        .values({
          policy_id: policyId,
          version: version,
          approver: approvalData.approver,
          approver_role: approvalData.approverRole,
          status: approvalData.status,
          comments: approvalData.comments,
          approved_at: new Date()
        });

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to record policy approval:', error);
      throw error;
    }
  }

  /**
   * Save policy violation
   */
  async savePolicyViolation(violation) {
    try {
      const query = this.queryBuilder
        .insert('policy_violations')
        .values(violation);

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to save policy violation:', error);
      throw error;
    }
  }

  /**
   * Save policy review
   */
  async savePolicyReview(review) {
    try {
      const query = this.queryBuilder
        .insert('policy_reviews')
        .values(review);

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to save policy review:', error);
      throw error;
    }
  }

  /**
   * Update policy status
   */
  async updatePolicyStatus(policyId, status) {
    try {
      const query = this.queryBuilder
        .update('security_policies')
        .set({
          status: status,
          updated_at: new Date()
        })
        .where('policy_id', '=', policyId);

      await this.queryBuilder.execute(query);

    } catch (error) {
      this.logger.error('Failed to update policy status:', error);
      throw error;
    }
  }

  /**
   * Load active policies into cache
   */
  async loadActivePolicies() {
    try {
      const query = this.queryBuilder
        .select('*')
        .from('security_policies')
        .where('status', 'IN', ['approved', 'enforced']);

      const policies = await this.queryBuilder.execute(query);

      for (const policy of policies) {
        this.activePolicies.set(policy.policy_id, policy);
      }

      this.logger.info(`Loaded ${policies.length} active policies into cache`);

    } catch (error) {
      this.logger.error('Failed to load active policies:', error);
    }
  }

  /**
   * Start automated policy reviews
   */
  startAutomatedReviews() {
    // Check daily for policies that need review
    setInterval(async () => {
      try {
        await this.checkPolicyReviews();
      } catch (error) {
        this.logger.error('Automated policy review check failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // Daily
  }

  /**
   * Check policies that need review
   */
  async checkPolicyReviews() {
    try {
      const query = this.queryBuilder
        .select('*')
        .from('security_policies')
        .where('review_date', '<=', new Date())
        .where('status', '=', 'enforced');

      const policiesNeedingReview = await this.queryBuilder.execute(query);

      for (const policy of policiesNeedingReview) {
        this.emit('policyReviewDue', {
          policyId: policy.policy_id,
          policyName: policy.name,
          reviewDate: policy.review_date,
          owner: policy.owner
        });
      }

      if (policiesNeedingReview.length > 0) {
        this.logger.info(`${policiesNeedingReview.length} policies need review`);
      }

    } catch (error) {
      this.logger.error('Failed to check policy reviews:', error);
    }
  }

  /**
   * Get policy templates
   */
  getTemplates() {
    return Array.from(this.templates.values());
  }

  /**
   * Get policy template by ID
   */
  getTemplate(templateId) {
    return this.templates.get(templateId);
  }

  /**
   * Generate unique policy ID
   */
  generatePolicyId() {
    return `policy-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  // Policy template content methods
  getAccessControlTemplate() {
    return `# Access Control Policy

## Purpose
This policy defines the requirements for managing access to organizational information systems and data.

## Scope
This policy applies to all employees, contractors, and third parties with access to organizational systems.

## Policy Statements

### 1. User Account Management
- All user accounts must be uniquely identifiable
- Accounts must be created based on documented authorization
- Account access must be reviewed regularly
- Accounts must be disabled or removed when no longer needed

### 2. Authentication Requirements
- Strong passwords must be enforced
- Multi-factor authentication must be used for privileged access
- Session timeouts must be configured appropriately
- Failed login attempts must be monitored and logged

### 3. Authorization Requirements
- Access must be granted based on principle of least privilege
- Role-based access control must be implemented
- Access rights must be documented and approved
- Regular access reviews must be conducted

### 4. Remote Access
- Remote access must be authenticated and encrypted
- Remote access must be monitored and logged
- Only authorized remote access methods are permitted

## Enforcement
Violation of this policy may result in disciplinary action, up to and including termination of employment.

## Review
This policy will be reviewed annually or as required by changes in technology or business requirements.`;
  }

  getDataProtectionTemplate() {
    return `# Data Protection Policy

## Purpose
This policy establishes the framework for protecting organizational data throughout its lifecycle.

## Scope
This policy applies to all data created, stored, processed, or transmitted by the organization.

## Policy Statements

### 1. Data Classification
- Data must be classified according to sensitivity
- Classification levels: Public, Internal, Confidential, Restricted
- Data classification must be documented and communicated

### 2. Data Handling Requirements
- Data must be handled according to its classification level
- Appropriate security controls must be implemented
- Data must be protected against unauthorized access, modification, or destruction

### 3. Encryption Requirements
- Sensitive data must be encrypted at rest
- Data in transit must be encrypted
- Encryption keys must be securely managed

### 4. Data Retention
- Data must not be retained longer than necessary
- Retention periods must be documented and enforced
- Secure disposal methods must be used

## Enforcement
Violation of this policy may result in disciplinary action and potential legal consequences.

## Review
This policy will be reviewed annually or as required by regulatory changes.`;
  }

  getIncidentResponseTemplate() {
    return `# Incident Response Policy

## Purpose
This policy defines the approach for managing security incidents to minimize impact and ensure timely recovery.

## Scope
This policy applies to all security incidents affecting organizational information systems or data.

## Policy Statements

### 1. Incident Definition
- Security incidents are events that compromise the confidentiality, integrity, or availability of information
- All suspected incidents must be reported immediately
- Incident categorization must be performed

### 2. Response Procedures
- Incident response team must be activated for significant incidents
- Containment, eradication, and recovery procedures must be followed
- Communication procedures must be established

### 3. Reporting Requirements
- Incidents must be documented and tracked
- Management must be informed of significant incidents
- Regulatory reporting requirements must be followed

### 4. Post-Incident Activities
- Root cause analysis must be performed
- Lessons learned must be documented and shared
- Preventive measures must be implemented

## Enforcement
Failure to follow incident response procedures may result in disciplinary action.

## Review
This policy will be reviewed annually or after significant incidents.`;
  }

  /**
   * Get manager statistics
   */
  getStatistics() {
    return {
      activePolicies: this.activePolicies.size,
      templates: this.templates.size,
      categories: this.config.policyCategories,
      approvalRequired: this.config.approvalRequired,
      autoReview: this.config.autoReview,
      reviewPeriod: this.config.reviewPeriod
    };
  }
}

module.exports = PolicyManager;