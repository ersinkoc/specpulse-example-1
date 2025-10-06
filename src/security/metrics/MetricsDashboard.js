/**
 * Security Metrics Dashboard
 * Real-time security dashboard with interactive visualizations and live updates
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const winston = require('winston');
const { SecurityMetricsCalculator } = require('./SecurityMetricsCalculator');

class MetricsDashboard extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      port: config.port || 3001,
      updateInterval: config.updateInterval || 5000, // 5 seconds
      maxConnections: config.maxConnections || 100,
      enableAuthentication: config.enableAuthentication !== false,
      enableWebSocketCompression: config.enableWebSocketCompression !== false,
      sessionTimeout: config.sessionTimeout || 3600000, // 1 hour
      refreshRates: {
        realtime: 5000,    // 5 seconds
        frequent: 15000,   // 15 seconds
        normal: 60000,     // 1 minute
        slow: 300000       // 5 minutes
      },
      widgets: config.widgets || this.getDefaultWidgets(),
      themes: config.themes || ['light', 'dark'],
      defaultTheme: config.defaultTheme || 'light',
      ...config
    };

    // WebSocket server
    this.wss = null;
    this.connections = new Map();
    this.sessions = new Map();

    // Initialize metrics calculator
    this.metricsCalculator = new SecurityMetricsCalculator();

    // Dashboard state
    this.dashboardState = {
      widgets: this.config.widgets,
      layout: this.getDefaultLayout(),
      filters: {},
      timeRange: 'daily',
      theme: this.config.defaultTheme,
      refreshRate: 'normal',
      alerts: [],
      notifications: []
    };

    // Data cache
    this.dataCache = new Map();
    this.lastUpdate = new Map();

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
          filename: 'logs/metrics-dashboard.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize dashboard
   */
  async initialize() {
    try {
      // Initialize WebSocket server
      await this.initializeWebSocketServer();

      // Start data updates
      this.startDataUpdates();

      // Initialize dashboard data
      await this.initializeDashboardData();

      this.logger.info(`Security metrics dashboard initialized on port ${this.config.port}`);

    } catch (error) {
      this.logger.error('Failed to initialize dashboard:', error);
      throw error;
    }
  }

  /**
   * Initialize WebSocket server
   */
  async initializeWebSocketServer() {
    try {
      this.wss = new WebSocket.Server({
        port: this.config.port,
        perMessageDeflate: this.config.enableWebSocketCompression,
        verifyClient: this.config.enableAuthentication ? this.verifyClient : null
      });

      this.wss.on('connection', (ws, request) => {
        this.handleConnection(ws, request);
      });

      this.wss.on('error', (error) => {
        this.logger.error('WebSocket server error:', error);
      });

      this.logger.info(`WebSocket server listening on port ${this.config.port}`);

    } catch (error) {
      this.logger.error('Failed to initialize WebSocket server:', error);
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, request) {
    try {
      const connectionId = this.generateConnectionId();
      const sessionId = this.createSession(connectionId, request);

      const connection = {
        id: connectionId,
        sessionId: sessionId,
        ws: ws,
        authenticated: true,
        lastActivity: new Date(),
        subscriptions: new Set(['overview']),
        preferences: {
          theme: this.config.defaultTheme,
          refreshRate: 'normal'
        }
      };

      this.connections.set(connectionId, connection);

      // Setup event handlers
      ws.on('message', (data) => {
        this.handleMessage(connectionId, data);
      });

      ws.on('close', () => {
        this.handleDisconnection(connectionId);
      });

      ws.on('error', (error) => {
        this.logger.error(`Connection error for ${connectionId}:`, error);
        this.handleDisconnection(connectionId);
      });

      // Send initial dashboard state
      this.sendDashboardState(connectionId);

      // Send initial data
      this.sendInitialData(connectionId);

      this.logger.info(`New dashboard connection: ${connectionId}`);

    } catch (error) {
      this.logger.error('Failed to handle connection:', error);
    }
  }

  /**
   * Handle WebSocket message
   */
  handleMessage(connectionId, data) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      connection.lastActivity = new Date();

      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'subscribe':
          this.handleSubscription(connectionId, message.data);
          break;
        case 'unsubscribe':
          this.handleUnsubscription(connectionId, message.data);
          break;
        case 'updateWidget':
          this.handleWidgetUpdate(connectionId, message.data);
          break;
        case 'changeTimeRange':
          this.handleTimeRangeChange(connectionId, message.data);
          break;
        case 'applyFilters':
          this.handleFilterChange(connectionId, message.data);
          break;
        case 'updatePreferences':
          this.handlePreferenceUpdate(connectionId, message.data);
          break;
        case 'refreshData':
          this.handleDataRefresh(connectionId, message.data);
          break;
        case 'exportData':
          this.handleDataExport(connectionId, message.data);
          break;
        case 'acknowledgeAlert':
          this.handleAlertAcknowledgment(connectionId, message.data);
          break;
        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
      }

    } catch (error) {
      this.logger.error(`Failed to handle message from ${connectionId}:`, error);
    }
  }

  /**
   * Handle disconnection
   */
  handleDisconnection(connectionId) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      // Clean up session
      this.sessions.delete(connection.sessionId);

      // Remove connection
      this.connections.delete(connectionId);

      this.logger.info(`Dashboard disconnected: ${connectionId}`);

    } catch (error) {
      this.logger.error(`Failed to handle disconnection: ${connectionId}:`, error);
    }
  }

  /**
   * Send dashboard state to client
   */
  sendDashboardState(connectionId) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const state = {
        type: 'dashboardState',
        data: {
          widgets: this.dashboardState.widgets,
          layout: this.dashboardState.layout,
          theme: connection.preferences.theme,
          refreshRate: connection.preferences.refreshRate,
          timeRange: this.dashboardState.timeRange,
          filters: this.dashboardState.filters,
          alerts: this.dashboardState.alerts,
          notifications: this.dashboardState.notifications
        }
      };

      this.sendToConnection(connectionId, state);

    } catch (error) {
      this.logger.error(`Failed to send dashboard state to ${connectionId}:`, error);
    }
  }

  /**
   * Send initial data to client
   */
  async sendInitialData(connectionId) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      // Send overview data
      const overviewData = await this.getOverviewData();
      this.sendToConnection(connectionId, {
        type: 'data',
        widget: 'overview',
        data: overviewData
      });

      // Send data for subscribed widgets
      for (const widgetType of connection.subscriptions) {
        if (widgetType !== 'overview') {
          const widgetData = await this.getWidgetData(widgetType);
          this.sendToConnection(connectionId, {
            type: 'data',
            widget: widgetType,
            data: widgetData
          });
        }
      }

    } catch (error) {
      this.logger.error(`Failed to send initial data to ${connectionId}:`, error);
    }
  }

  /**
   * Get overview data
   */
  async getOverviewData() {
    try {
      const cacheKey = 'overview';
      const data = await this.getCachedData(cacheKey, async () => {
        const metrics = await this.metricsCalculator.calculateMetrics('hourly');

        return {
          overallScore: metrics.overallScore,
          riskLevel: this.calculateRiskLevel(metrics.overallScore),
          keyMetrics: {
            totalIncidents: metrics.incidents.total,
            complianceScore: metrics.compliance.overallScore,
            availability: metrics.performance.availability.percentage,
            threatsBlocked: metrics.threatIntelligence.indicatorsBlocked
          },
          recentActivity: this.getRecentActivity(metrics),
          systemStatus: this.assessSystemStatus(metrics),
          alerts: this.getActiveAlerts(metrics),
          trends: this.getQuickTrends(metrics)
        };
      });

      return data;

    } catch (error) {
      this.logger.error('Failed to get overview data:', error);
      return {};
    }
  }

  /**
   * Get widget data
   */
  async getWidgetData(widgetType) {
    try {
      const cacheKey = `widget_${widgetType}`;
      const data = await this.getCachedData(cacheKey, async () => {
        switch (widgetType) {
          case 'incidents':
            return await this.getIncidentsWidgetData();
          case 'securityEvents':
            return await this.getSecurityEventsWidgetData();
          case 'compliance':
            return await this.getComplianceWidgetData();
          case 'performance':
            return await this.getPerformanceWidgetData();
          case 'risk':
            return await this.getRiskWidgetData();
          case 'threats':
            return await this.getThreatsWidgetData();
          case 'assets':
            return await this.getAssetsWidgetData();
          case 'users':
            return await this.getUsersWidgetData();
          default:
            return {};
        }
      });

      return data;

    } catch (error) {
      this.logger.error(`Failed to get widget data for ${widgetType}:`, error);
      return {};
    }
  }

  /**
   * Get incidents widget data
   */
  async getIncidentsWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('daily');

      return {
        total: metrics.incidents.total,
        bySeverity: metrics.incidents.bySeverity,
        byStatus: metrics.incidents.byStatus,
        trend: this.calculateIncidentTrend(metrics.incidents),
        mttr: metrics.incidents.mttr,
        slaCompliance: metrics.incidents.slaCompliance,
        recentIncidents: await this.getRecentIncidents()
      };

    } catch (error) {
      this.logger.error('Failed to get incidents widget data:', error);
      return {};
    }
  }

  /**
   * Get security events widget data
   */
  async getSecurityEventsWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('hourly');

      return {
        total: metrics.securityEvents.total,
        eventsPerMinute: metrics.securityEvents.eventsPerMinute,
        byType: metrics.securityEvents.byType,
        bySeverity: metrics.securityEvents.bySeverity,
        bySource: metrics.securityEvents.bySource,
        peakActivity: metrics.securityEvents.peakActivityHour,
        detectionRate: metrics.securityEvents.detectionRate
      };

    } catch (error) {
      this.logger.error('Failed to get security events widget data:', error);
      return {};
    }
  }

  /**
   * Get compliance widget data
   */
  async getComplianceWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('weekly');

      return {
        overallScore: metrics.compliance.overallScore,
        frameworkCompliance: metrics.compliance.frameworkCompliance,
        auditResults: metrics.compliance.auditResults,
        violations: metrics.compliance.violations,
        remediation: metrics.compliance.remediation,
        certifications: metrics.compliance.certifications
      };

    } catch (error) {
      this.logger.error('Failed to get compliance widget data:', error);
      return {};
    }
  }

  /**
   * Get performance widget data
   */
  async getPerformanceWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('hourly');

      return {
        responseTime: metrics.performance.responseTime,
        throughput: metrics.performance.throughput,
        availability: metrics.performance.availability,
        resourceUtilization: metrics.performance.resourceUtilization,
        errorRate: metrics.performance.errorRate,
        latency: metrics.performance.latency
      };

    } catch (error) {
      this.logger.error('Failed to get performance widget data:', error);
      return {};
    }
  }

  /**
   * Get risk widget data
   */
  async getRiskWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('weekly');

      return {
        overallScore: metrics.risk.overallRiskScore,
        riskDistribution: metrics.risk.riskDistribution,
        topRisks: metrics.risk.topRisks.slice(0, 5),
        riskCoverage: metrics.risk.riskCoverage,
        mitigation: metrics.risk.riskMitigation
      };

    } catch (error) {
      this.logger.error('Failed to get risk widget data:', error);
      return {};
    }
  }

  /**
   * Get threats widget data
   */
  async getThreatsWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('daily');

      return {
        indicatorsReceived: metrics.threatIntelligence.indicatorsReceived,
        indicatorsProcessed: metrics.threatIntelligence.indicatorsProcessed,
        indicatorsBlocked: metrics.threatIntelligence.indicatorsBlocked,
        byType: metrics.threatIntelligence.byType,
        bySeverity: metrics.threatIntelligence.bySeverity,
        threatsDetected: metrics.threatIntelligence.threatsDetected,
        threatsPrevented: metrics.threatIntelligence.threatsPrevented
      };

    } catch (error) {
      this.logger.error('Failed to get threats widget data:', error);
      return {};
    }
  }

  /**
   * Get assets widget data
   */
  async getAssetsWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('weekly');

      return {
        totalAssets: metrics.assets.totalAssets,
        byType: metrics.assets.byType,
        byCriticality: metrics.assets.byCriticality,
        vulnerabilityCoverage: metrics.assets.vulnerabilityCoverage,
        complianceCoverage: metrics.assets.complianceCoverage,
        assetValue: metrics.assets.assetValue
      };

    } catch (error) {
      this.logger.error('Failed to get assets widget data:', error);
      return {};
    }
  }

  /**
   * Get users widget data
   */
  async getUsersWidgetData() {
    try {
      const metrics = await this.metricsCalculator.calculateMetrics('daily');

      return {
        totalUsers: metrics.userBehavior.totalUsers,
        activeUsers: metrics.userBehavior.activeUsers,
        suspiciousActivities: metrics.userBehavior.suspiciousActivities,
        authenticationMetrics: metrics.userBehavior.authenticationMetrics,
        privilegeEscalations: metrics.userBehavior.privilegeEscalations,
        dataAccess: metrics.userBehavior.dataAccess
      };

    } catch (error) {
      this.logger.error('Failed to get users widget data:', error);
      return {};
    }
  }

  /**
   * Handle subscription to widget
   */
  handleSubscription(connectionId, data) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const { widgetType } = data;

      if (widgetType) {
        connection.subscriptions.add(widgetType);

        // Send current data for the widget
        this.getWidgetData(widgetType).then(widgetData => {
          this.sendToConnection(connectionId, {
            type: 'data',
            widget: widgetType,
            data: widgetData
          });
        });
      }

    } catch (error) {
      this.logger.error(`Failed to handle subscription for ${connectionId}:`, error);
    }
  }

  /**
   * Handle unsubscription from widget
   */
  handleUnsubscription(connectionId, data) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const { widgetType } = data;

      if (widgetType) {
        connection.subscriptions.delete(widgetType);
      }

    } catch (error) {
      this.logger.error(`Failed to handle unsubscription for ${connectionId}:`, error);
    }
  }

  /**
   * Handle widget update
   */
  handleWidgetUpdate(connectionId, data) {
    try {
      const { widgetId, config } = data;

      // Update widget configuration
      const widget = this.dashboardState.widgets.find(w => w.id === widgetId);
      if (widget) {
        Object.assign(widget.config, config);

        // Notify all connections of the update
        this.broadcast({
          type: 'widgetUpdated',
          data: { widgetId, config }
        });
      }

    } catch (error) {
      this.logger.error(`Failed to handle widget update for ${connectionId}:`, error);
    }
  }

  /**
   * Handle time range change
   */
  async handleTimeRangeChange(connectionId, data) {
    try {
      const { timeRange } = data;
      this.dashboardState.timeRange = timeRange;

      // Clear cache for affected widgets
      this.clearCacheForTimeRange(timeRange);

      // Send updated data to connection
      for (const widgetType of this.connections.get(connectionId).subscriptions) {
        const widgetData = await this.getWidgetData(widgetType);
        this.sendToConnection(connectionId, {
          type: 'data',
          widget: widgetType,
          data: widgetData
        });
      }

    } catch (error) {
      this.logger.error(`Failed to handle time range change for ${connectionId}:`, error);
    }
  }

  /**
   * Handle filter change
   */
  async handleFilterChange(connectionId, data) {
    try {
      const { filters } = data;
      Object.assign(this.dashboardState.filters, filters);

      // Clear cache
      this.dataCache.clear();

      // Send updated data to connection
      for (const widgetType of this.connections.get(connectionId).subscriptions) {
        const widgetData = await this.getWidgetData(widgetType);
        this.sendToConnection(connectionId, {
          type: 'data',
          widget: widgetType,
          data: widgetData
        });
      }

    } catch (error) {
      this.logger.error(`Failed to handle filter change for ${connectionId}:`, error);
    }
  }

  /**
   * Handle preference update
   */
  handlePreferenceUpdate(connectionId, data) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      Object.assign(connection.preferences, data);

      // Send updated preferences
      this.sendToConnection(connectionId, {
        type: 'preferencesUpdated',
        data: connection.preferences
      });

    } catch (error) {
      this.logger.error(`Failed to handle preference update for ${connectionId}:`, error);
    }
  }

  /**
   * Handle data refresh
   */
  async handleDataRefresh(connectionId, data) {
    try {
      const { widgetTypes } = data;

      for (const widgetType of widgetTypes) {
        const cacheKey = `widget_${widgetType}`;
        this.lastUpdate.delete(cacheKey);

        const widgetData = await this.getWidgetData(widgetType);
        this.sendToConnection(connectionId, {
          type: 'data',
          widget: widgetType,
          data: widgetData
        });
      }

    } catch (error) {
      this.logger.error(`Failed to handle data refresh for ${connectionId}:`, error);
    }
  }

  /**
   * Handle data export
   */
  async handleDataExport(connectionId, data) {
    try {
      const { widgetType, format } = data;

      const exportData = await this.exportWidgetData(widgetType, format);

      this.sendToConnection(connectionId, {
        type: 'exportData',
        data: {
          widgetType,
          format,
          data: exportData
        }
      });

    } catch (error) {
      this.logger.error(`Failed to handle data export for ${connectionId}:`, error);
    }
  }

  /**
   * Handle alert acknowledgment
   */
  handleAlertAcknowledgment(connectionId, data) {
    try {
      const { alertId } = data;

      // Update alert status
      const alert = this.dashboardState.alerts.find(a => a.id === alertId);
      if (alert) {
        alert.acknowledged = true;
        alert.acknowledgedAt = new Date();
        alert.acknowledgedBy = connectionId;

        // Broadcast alert update
        this.broadcast({
          type: 'alertAcknowledged',
          data: { alertId, acknowledgedBy: connectionId }
        });
      }

    } catch (error) {
      this.logger.error(`Failed to handle alert acknowledgment for ${connectionId}:`, error);
    }
  }

  /**
   * Start data updates
   */
  startDataUpdates() {
    // Start periodic data updates
    setInterval(() => {
      this.updateSubscribers();
    }, this.config.updateInterval);

    // Start real-time metrics collection
    this.startRealTimeUpdates();
  }

  /**
   * Start real-time updates
   */
  startRealTimeUpdates() {
    setInterval(async () => {
      try {
        const realTimeData = this.metricsCalculator.getRealTimeMetrics();

        // Send to subscribers of real-time widgets
        for (const [connectionId, connection] of this.connections) {
          if (connection.subscriptions.has('realtime')) {
            this.sendToConnection(connectionId, {
              type: 'realtimeData',
              data: realTimeData
            });
          }
        }

      } catch (error) {
        this.logger.error('Failed to get real-time data:', error);
      }
    }, this.config.refreshRates.realtime);
  }

  /**
   * Update subscribers with fresh data
   */
  async updateSubscribers() {
    try {
      for (const [connectionId, connection] of this.connections) {
        const refreshRate = this.config.refreshRates[connection.preferences.refreshRate];
        const lastActivity = connection.lastActivity.getTime();

        // Skip inactive connections
        if (Date.now() - lastActivity > this.config.sessionTimeout) {
          this.handleDisconnection(connectionId);
          continue;
        }

        // Update subscribed widgets based on refresh rate
        for (const widgetType of connection.subscriptions) {
          const cacheKey = `widget_${widgetType}`;
          const lastUpdate = this.lastUpdate.get(cacheKey) || 0;

          if (Date.now() - lastUpdate >= refreshRate) {
            const widgetData = await this.getWidgetData(widgetType);
            this.sendToConnection(connectionId, {
              type: 'data',
              widget: widgetType,
              data: widgetData
            });
          }
        }
      }

    } catch (error) {
      this.logger.error('Failed to update subscribers:', error);
    }
  }

  /**
   * Initialize dashboard data
   */
  async initializeDashboardData() {
    try {
      // Pre-populate cache with common widgets
      await this.getOverviewData();
      await this.getIncidentsWidgetData();
      await this.getSecurityEventsWidgetData();
      await this.getComplianceWidgetData();

      this.logger.info('Dashboard data initialized');

    } catch (error) {
      this.logger.error('Failed to initialize dashboard data:', error);
    }
  }

  /**
   * Send message to specific connection
   */
  sendToConnection(connectionId, message) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      connection.ws.send(JSON.stringify(message));

    } catch (error) {
      this.logger.error(`Failed to send message to ${connectionId}:`, error);
    }
  }

  /**
   * Broadcast message to all connections
   */
  broadcast(message) {
    try {
      for (const [connectionId, connection] of this.connections) {
        if (connection.ws.readyState === WebSocket.OPEN) {
          this.sendToConnection(connectionId, message);
        }
      }

    } catch (error) {
      this.logger.error('Failed to broadcast message:', error);
    }
  }

  /**
   * Get cached data or compute and cache it
   */
  async getCachedData(cacheKey, computeFunction) {
    try {
      const lastUpdate = this.lastUpdate.get(cacheKey) || 0;
      const now = Date.now();

      // Check if cache is valid (5 minutes)
      if (now - lastUpdate < 300000 && this.dataCache.has(cacheKey)) {
        return this.dataCache.get(cacheKey);
      }

      // Compute fresh data
      const data = await computeFunction();

      // Cache the data
      this.dataCache.set(cacheKey, data);
      this.lastUpdate.set(cacheKey, now);

      return data;

    } catch (error) {
      this.logger.error(`Failed to get cached data for ${cacheKey}:`, error);
      return {};
    }
  }

  /**
   * Clear cache for specific time range
   */
  clearCacheForTimeRange(timeRange) {
    const keysToDelete = [];

    for (const [key] of this.dataCache) {
      if (key.includes(timeRange) || key === 'overview') {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.dataCache.delete(key);
      this.lastUpdate.delete(key);
    });
  }

  /**
   * Verify client authentication
   */
  verifyClient(info) {
    // Implement authentication logic
    // For now, accept all connections
    return true;
  }

  /**
   * Create session for connection
   */
  createSession(connectionId, request) {
    const sessionId = this.generateSessionId();

    this.sessions.set(sessionId, {
      id: sessionId,
      connectionId: connectionId,
      createdAt: new Date(),
      ipAddress: request.socket.remoteAddress,
      userAgent: request.headers['user-agent']
    });

    return sessionId;
  }

  /**
   * Generate unique IDs
   */
  generateConnectionId() {
    return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateSessionId() {
    return `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get default widgets configuration
   */
  getDefaultWidgets() {
    return [
      {
        id: 'overview',
        type: 'overview',
        title: 'Security Overview',
        position: { x: 0, y: 0, w: 4, h: 2 },
        config: { refreshRate: 'normal' }
      },
      {
        id: 'incidents',
        type: 'incidents',
        title: 'Incidents',
        position: { x: 0, y: 2, w: 2, h: 3 },
        config: { refreshRate: 'normal' }
      },
      {
        id: 'securityEvents',
        type: 'securityEvents',
        title: 'Security Events',
        position: { x: 2, y: 2, w: 2, h: 3 },
        config: { refreshRate: 'frequent' }
      },
      {
        id: 'compliance',
        type: 'compliance',
        title: 'Compliance',
        position: { x: 4, y: 0, w: 2, h: 2 },
        config: { refreshRate: 'slow' }
      },
      {
        id: 'performance',
        type: 'performance',
        title: 'Performance',
        position: { x: 4, y: 2, w: 2, h: 3 },
        config: { refreshRate: 'frequent' }
      },
      {
        id: 'risk',
        type: 'risk',
        title: 'Risk Assessment',
        position: { x: 6, y: 0, w: 2, h: 2 },
        config: { refreshRate: 'normal' }
      },
      {
        id: 'threats',
        type: 'threats',
        title: 'Threat Intelligence',
        position: { x: 6, y: 2, w: 2, h: 3 },
        config: { refreshRate: 'normal' }
      },
      {
        id: 'assets',
        type: 'assets',
        title: 'Security Assets',
        position: { x: 8, y: 0, w: 2, h: 2 },
        config: { refreshRate: 'slow' }
      },
      {
        id: 'users',
        type: 'users',
        title: 'User Activity',
        position: { x: 8, y: 2, w: 2, h: 3 },
        config: { refreshRate: 'normal' }
      }
    ];
  }

  /**
   * Get default layout
   */
  getDefaultLayout() {
    return {
      columns: 12,
      rowHeight: 100,
      margin: [10, 10],
      containerPadding: [10, 10]
    };
  }

  /**
   * Helper methods for dashboard functionality
   */
  calculateRiskLevel(score) {
    if (score >= 90) return 'low';
    if (score >= 70) return 'medium';
    if (score >= 50) return 'high';
    return 'critical';
  }

  getRecentActivity(metrics) {
    // Extract recent activity from metrics
    return {
      incidents: metrics.incidents.total,
      events: metrics.securityEvents.total,
      alerts: metrics.thresholdBreaches.length
    };
  }

  assessSystemStatus(metrics) {
    if (metrics.thresholdBreaches.some(b => b.level === 'critical')) {
      return 'critical';
    }
    if (metrics.overallScore < 70) {
      return 'degraded';
    }
    return 'operational';
  }

  getActiveAlerts(metrics) {
    return metrics.thresholdBreaches.map(breach => ({
      id: `alert-${breach.metric}-${Date.now()}`,
      type: 'threshold',
      metric: breach.metric,
      level: breach.level,
      value: breach.value,
      threshold: breach.threshold,
      message: `${breach.metric} threshold breached: ${breach.value} (threshold: ${breach.threshold})`,
      timestamp: new Date(),
      acknowledged: false
    }));
  }

  getQuickTrends(metrics) {
    return {
      incidents: this.calculateTrendDirection(metrics.incidents.total),
      compliance: this.calculateTrendDirection(metrics.compliance.overallScore),
      performance: this.calculateTrendDirection(metrics.performance.availability.percentage)
    };
  }

  calculateTrendDirection(currentValue) {
    // Simple trend calculation - would use historical data in production
    return Math.random() > 0.5 ? 'up' : 'down';
  }

  calculateIncidentTrend(incidents) {
    return {
      direction: this.calculateTrendDirection(incidents.total),
      percentage: Math.floor(Math.random() * 20) - 10 // -10% to +10%
    };
  }

  async getRecentIncidents() {
    // Placeholder for recent incidents data
    return [];
  }

  async exportWidgetData(widgetType, format) {
    const data = await this.getWidgetData(widgetType);

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'csv':
        return this.convertToCSV(data);
      default:
        return data;
    }
  }

  convertToCSV(data) {
    // Simple CSV conversion
    const headers = Object.keys(data);
    const values = headers.map(header => data[header]);
    return [headers.join(','), values.join(',')].join('\n');
  }

  /**
   * Get dashboard statistics
   */
  getStatistics() {
    return {
      activeConnections: this.connections.size,
      activeSessions: this.sessions.size,
      cacheSize: this.dataCache.size,
      widgets: this.dashboardState.widgets.length,
      uptime: process.uptime(),
      port: this.config.port
    };
  }

  /**
   * Shutdown dashboard
   */
  shutdown() {
    try {
      if (this.wss) {
        this.wss.close();
      }

      this.connections.clear();
      this.sessions.clear();
      this.dataCache.clear();

      this.logger.info('Security metrics dashboard shutdown complete');

    } catch (error) {
      this.logger.error('Failed to shutdown dashboard:', error);
    }
  }
}

module.exports = MetricsDashboard;