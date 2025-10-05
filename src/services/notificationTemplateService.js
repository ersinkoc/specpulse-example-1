const { v4: uuidv4 } = require('uuid');
const db = require('../database/connection');
const logger = require('../shared/utils/logger');

/**
 * Notification Template Service
 * Manages notification templates for dynamic content generation
 */
class NotificationTemplateService {
  constructor() {
    this.templateCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Create a new notification template
   */
  async createTemplate(templateData) {
    try {
      const {
        name,
        category,
        type,
        priority = 'medium',
        titleTemplate,
        messageTemplate,
        defaultActions = [],
        variables = {},
        isActive = true
      } = templateData;

      // Validate required fields
      if (!name || !category || !type || !titleTemplate || !messageTemplate) {
        throw new Error('Name, category, type, titleTemplate, and messageTemplate are required');
      }

      // Validate category
      const validCategories = ['security', 'system', 'social', 'task', 'administrative'];
      if (!validCategories.includes(category)) {
        throw new Error(`Invalid category: ${category}`);
      }

      // Validate priority
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        throw new Error(`Invalid priority: ${priority}`);
      }

      // Check if template name already exists
      const existingTemplate = await this.getTemplateByName(name);
      if (existingTemplate) {
        throw new Error(`Template with name '${name}' already exists`);
      }

      const templateId = uuidv4();

      const query = `
        INSERT INTO notification_templates (
          id, name, category, type, priority, title_template, message_template,
          default_actions, variables, is_active, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const values = [
        templateId,
        name,
        category,
        type,
        priority,
        titleTemplate,
        messageTemplate,
        JSON.stringify(defaultActions),
        JSON.stringify(variables),
        isActive,
        templateData.createdBy || null
      ];

      const result = await db.query(query, values);
      const template = result.rows[0];

      // Clear cache
      this.clearCache();

      logger.info('Notification template created', {
        templateId,
        name,
        category,
        type,
        createdBy: templateData.createdBy
      });

      return {
        id: template.id,
        name: template.name,
        category: template.category,
        type: template.type,
        priority: template.priority,
        titleTemplate: template.title_template,
        messageTemplate: template.message_template,
        defaultActions: template.default_actions,
        variables: template.variables,
        isActive: template.is_active,
        createdBy: template.created_by,
        createdAt: template.created_at,
        updatedAt: template.updated_at
      };

    } catch (error) {
      logger.error('Failed to create notification template:', error);
      throw error;
    }
  }

  /**
   * Get template by ID
   */
  async getTemplate(templateId) {
    try {
      // Check cache first
      const cacheKey = `template:${templateId}`;
      const cached = this.templateCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.data;
      }

      const query = `
        SELECT * FROM notification_templates
        WHERE id = $1 AND is_active = true
      `;

      const result = await db.query(query, [templateId]);

      if (result.rows.length === 0) {
        return null;
      }

      const template = this.formatTemplate(result.rows[0]);

      // Cache the result
      this.templateCache.set(cacheKey, {
        data: template,
        timestamp: Date.now()
      });

      return template;

    } catch (error) {
      logger.error('Failed to get notification template:', error);
      throw error;
    }
  }

  /**
   * Get template by name
   */
  async getTemplateByName(name) {
    try {
      const query = `
        SELECT * FROM notification_templates
        WHERE name = $1 AND is_active = true
      `;

      const result = await db.query(query, [name]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.formatTemplate(result.rows[0]);

    } catch (error) {
      logger.error('Failed to get notification template by name:', error);
      throw error;
    }
  }

  /**
   * Get all templates with filtering
   */
  async getTemplates(filters = {}) {
    try {
      const {
        category,
        type,
        priority,
        isActive = true,
        limit = 100,
        offset = 0
      } = filters;

      let whereConditions = ['is_active = $1'];
      let queryParams = [isActive];
      let paramIndex = 2;

      if (category) {
        whereConditions.push(`category = $${paramIndex++}`);
        queryParams.push(category);
      }

      if (type) {
        whereConditions.push(`type = $${paramIndex++}`);
        queryParams.push(type);
      }

      if (priority) {
        whereConditions.push(`priority = $${paramIndex++}`);
        queryParams.push(priority);
      }

      const whereClause = whereConditions.join(' AND ');

      const query = `
        SELECT * FROM notification_templates
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      queryParams.push(limit, offset);

      const result = await db.query(query, queryParams);

      return result.rows.map(row => this.formatTemplate(row));

    } catch (error) {
      logger.error('Failed to get notification templates:', error);
      throw error;
    }
  }

  /**
   * Render notification from template
   */
  async renderNotification(templateId, variables = {}) {
    try {
      const template = await this.getTemplate(templateId);

      if (!template) {
        throw new Error(`Template with ID ${templateId} not found`);
      }

      const rendered = {
        title: this.renderTemplate(template.titleTemplate, variables),
        message: this.renderTemplate(template.messageTemplate, variables),
        category: template.category,
        type: template.type,
        priority: template.priority,
        actions: this.renderActions(template.defaultActions, variables),
        data: {
          ...variables,
          templateId: template.id,
          templateName: template.name,
          renderedAt: new Date().toISOString()
        }
      };

      return rendered;

    } catch (error) {
      logger.error('Failed to render notification from template:', error);
      throw error;
    }
  }

  /**
   * Send notification using template
   */
  async sendFromTemplate(templateId, userId, variables = {}, options = {}) {
    try {
      const notificationService = require('./notificationService');

      // Render notification from template
      const notificationData = await this.renderNotification(templateId, variables);

      // Apply overrides if provided
      if (options.title) notificationData.title = options.title;
      if (options.message) notificationData.message = options.message;
      if (options.priority) notificationData.priority = options.priority;
      if (options.expiresAt) notificationData.expiresAt = options.expiresAt;
      if (options.actions) notificationData.actions = options.actions;

      // Add template metadata
      notificationData.data.templateUsed = true;
      notificationData.data.templateOptions = options;

      // Send notification
      const notification = await notificationService.sendToUser(userId, notificationData);

      logger.info('Notification sent from template', {
        templateId,
        userId,
        notificationId: notification.id
      });

      return notification;

    } catch (error) {
      logger.error('Failed to send notification from template:', error);
      throw error;
    }
  }

  /**
   * Update template
   */
  async updateTemplate(templateId, updateData) {
    try {
      const allowedFields = [
        'name', 'category', 'type', 'priority', 'titleTemplate',
        'messageTemplate', 'defaultActions', 'variables', 'isActive'
      ];

      const updateFields = [];
      const queryParams = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key)) {
          const fieldName = key === 'titleTemplate' ? 'title_template' :
                           key === 'messageTemplate' ? 'message_template' :
                           key === 'defaultActions' ? 'default_actions' : key;

          updateFields.push(`${fieldName} = $${paramIndex++}`);
          queryParams.push(typeof value === 'object' ? JSON.stringify(value) : value);
        }
      }

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update');
      }

      queryParams.push(templateId);

      const query = `
        UPDATE notification_templates
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await db.query(query, queryParams);

      if (result.rows.length === 0) {
        throw new Error('Template not found');
      }

      // Clear cache
      this.clearCache();

      const template = this.formatTemplate(result.rows[0]);

      logger.info('Notification template updated', {
        templateId,
        updatedFields: Object.keys(updateData)
      });

      return template;

    } catch (error) {
      logger.error('Failed to update notification template:', error);
      throw error;
    }
  }

  /**
   * Delete template (soft delete - set is_active to false)
   */
  async deleteTemplate(templateId) {
    try {
      const query = `
        UPDATE notification_templates
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name
      `;

      const result = await db.query(query, [templateId]);

      if (result.rows.length === 0) {
        throw new Error('Template not found');
      }

      // Clear cache
      this.clearCache();

      logger.info('Notification template deleted', {
        templateId,
        name: result.rows[0].name
      });

      return {
        id: result.rows[0].id,
        name: result.rows[0].name,
        deleted: true
      };

    } catch (error) {
      logger.error('Failed to delete notification template:', error);
      throw error;
    }
  }

  /**
   * Render template string with variables
   */
  renderTemplate(templateString, variables) {
    try {
      let rendered = templateString;

      // Simple template variable replacement {{variable}}
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        rendered = rendered.replace(regex, value);
      }

      // Handle conditional blocks {{#if variable}}...{{/if}}
      rendered = rendered.replace(/{{#if\s+(\w+)}}(.*?){{\/if}}/gs, (match, varName, content) => {
        return variables[varName] ? content : '';
      });

      // Handle inverted blocks {{#unless variable}}...{{/unless}}
      rendered = rendered.replace(/{{#unless\s+(\w+)}}(.*?){{\/unless}}/gs, (match, varName, content) => {
        return !variables[varName] ? content : '';
      });

      return rendered;

    } catch (error) {
      logger.error('Failed to render template string:', error);
      return templateString; // Return original on error
    }
  }

  /**
   * Render actions with variables
   */
  renderActions(actions, variables) {
    try {
      if (!Array.isArray(actions)) {
        return [];
      }

      return actions.map(action => ({
        ...action,
        label: this.renderTemplate(action.label || '', variables),
        url: action.url ? this.renderTemplate(action.url, variables) : action.url
      }));

    } catch (error) {
      logger.error('Failed to render template actions:', error);
      return actions; // Return original on error
    }
  }

  /**
   * Format template database row
   */
  formatTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      type: row.type,
      priority: row.priority,
      titleTemplate: row.title_template,
      messageTemplate: row.message_template,
      defaultActions: row.default_actions,
      variables: row.variables,
      isActive: row.is_active,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Clear template cache
   */
  clearCache() {
    this.templateCache.clear();
  }

  /**
   * Get template statistics
   */
  async getTemplateStatistics() {
    try {
      const query = `
        SELECT
          COUNT(*) as total_templates,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_templates,
          COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_templates,
          category,
          COUNT(*) as count
        FROM notification_templates
        GROUP BY category
        ORDER BY count DESC
      `;

      const result = await db.query(query);

      const stats = {
        total: 0,
        active: 0,
        inactive: 0,
        byCategory: {}
      };

      for (const row of result.rows) {
        stats.total += parseInt(row.count);
        if (row.is_active) {
          stats.active += parseInt(row.count);
        } else {
          stats.inactive += parseInt(row.count);
        }
        stats.byCategory[row.category] = parseInt(row.count);
      }

      return stats;

    } catch (error) {
      logger.error('Failed to get template statistics:', error);
      throw error;
    }
  }

  /**
   * Validate template variables
   */
  validateTemplateVariables(templateString, variables) {
    try {
      // Find all variable placeholders in template
      const variableRegex = /{{\\s*(\\w+)\\s*}}/g;
      const usedVariables = [];
      let match;

      while ((match = variableRegex.exec(templateString)) !== null) {
        usedVariables.push(match[1]);
      }

      // Check if all used variables are provided
      const missingVariables = usedVariables.filter(varName => !(varName in variables));

      return {
        isValid: missingVariables.length === 0,
        usedVariables,
        missingVariables,
        providedVariables: Object.keys(variables)
      };

    } catch (error) {
      logger.error('Failed to validate template variables:', error);
      return {
        isValid: false,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const notificationTemplateService = new NotificationTemplateService();

module.exports = notificationTemplateService;