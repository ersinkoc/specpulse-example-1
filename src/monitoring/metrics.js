const { logger } = require('../shared/utils/logger');
const EventEmitter = require('events');

class MetricsCollector extends EventEmitter {
  constructor() {
    super();
    this.metrics = new Map();
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
    this.startTime = Date.now();

    this.initializeDefaultMetrics();
    this.startCollection();
  }

  initializeDefaultMetrics() {
    // Request metrics
    this.createCounter('http_requests_total', 'Total HTTP requests');
    this.createHistogram('http_request_duration', 'HTTP request duration', [0.1, 0.5, 1, 2, 5, 10]);
    this.createCounter('http_errors_total', 'Total HTTP errors');

    // Authentication metrics
    this.createCounter('auth_logins_total', 'Total login attempts');
    this.createCounter('auth_registrations_total', 'Total registration attempts');
    this.createCounter('auth_logins_success_total', 'Successful logins');
    this.createCounter('auth_logins_failure_total', 'Failed logins');
    this.createCounter('auth_tokens_issued_total', 'Tokens issued');
    this.createCounter('auth_tokens_refreshed_total', 'Tokens refreshed');
    this.createCounter('auth_oauth_attempts_total', 'OAuth2 attempts');
    this.createCounter('auth_oauth_success_total', 'Successful OAuth2 authentications');

    // Database metrics
    this.createCounter('db_queries_total', 'Total database queries');
    this.createHistogram('db_query_duration', 'Database query duration', [0.01, 0.05, 0.1, 0.5, 1, 2]);
    this.createGauge('db_connections_active', 'Active database connections');
    this.createCounter('db_errors_total', 'Total database errors');

    // User metrics
    this.createGauge('users_total', 'Total number of users');
    this.createGauge('users_active', 'Active users (last 24h)');
    this.createGauge('users_verified', 'Verified users');
    this.createGauge('users_oauth_linked', 'Users with OAuth2 providers linked');

    // Security metrics
    this.createCounter('security_rate_limit_hits_total', 'Rate limit violations');
    this.createCounter('security_blocked_ips_total', 'Blocked IP addresses');
    this.createCounter('security_suspicious_activities_total', 'Suspicious activities detected');
    this.createCounter('security_password_resets_total', 'Password reset requests');

    // System metrics
    this.createGauge('system_memory_usage', 'Memory usage in MB');
    this.createGauge('system_cpu_usage', 'CPU usage percentage');
    this.createGauge('system_uptime', 'System uptime in seconds');

    // OAuth2 provider metrics
    for (const provider of ['google', 'github']) {
      this.createCounter(`oauth_${provider}_attempts_total`, `${provider} OAuth2 attempts`);
      this.createCounter(`oauth_${provider}_success_total`, `${provider} OAuth2 successes`);
      this.createCounter(`oauth_${provider}_errors_total`, `${provider} OAuth2 errors`);
    }
  }

  createCounter(name, help) {
    this.counters.set(name, {
      type: 'counter',
      name,
      help,
      value: 0
    });
  }

  createHistogram(name, help, buckets) {
    this.histograms.set(name, {
      type: 'histogram',
      name,
      help,
      buckets: buckets || [],
      observations: [],
      count: 0,
      sum: 0
    });
  }

  createGauge(name, help) {
    this.gauges.set(name, {
      type: 'gauge',
      name,
      help,
      value: 0
    });
  }

  incrementCounter(name, labels = {}) {
    const counter = this.counters.get(name);
    if (counter) {
      counter.value++;
      this.emit('metric', { type: 'counter', name, value: counter.value, labels });
    }
  }

  recordHistogram(name, value, labels = {}) {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.count++;
      histogram.sum += value;
      histogram.observations.push({ value, timestamp: Date.now(), labels });

      // Keep only last 1000 observations to prevent memory issues
      if (histogram.observations.length > 1000) {
        histogram.observations = histogram.observations.slice(-1000);
      }

      this.emit('metric', { type: 'histogram', name, value, count: histogram.count, sum: histogram.sum, labels });
    }
  }

  setGauge(name, value, labels = {}) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value = value;
      this.emit('metric', { type: 'gauge', name, value, labels });
    }
  }

  // Convenience methods for common metrics
  recordHttpRequest(method, route, statusCode, duration) {
    this.incrementCounter('http_requests_total', { method, route, status: statusCode.toString() });
    this.recordHistogram('http_request_duration', duration, { method, route });

    if (statusCode >= 400) {
      this.incrementCounter('http_errors_total', { method, route, status: statusCode.toString() });
    }
  }

  recordAuthenticationAttempt(type, success, provider = null) {
    if (type === 'login') {
      this.incrementCounter('auth_logins_total');
      if (success) {
        this.incrementCounter('auth_logins_success_total');
      } else {
        this.incrementCounter('auth_logins_failure_total');
      }
    } else if (type === 'registration') {
      this.incrementCounter('auth_registrations_total');
    } else if (type === 'oauth') {
      this.incrementCounter('auth_oauth_attempts_total');
      if (provider) {
        this.incrementCounter(`oauth_${provider}_attempts_total`);
        if (success) {
          this.incrementCounter(`oauth_${provider}_success_total`);
          this.incrementCounter('auth_oauth_success_total');
        } else {
          this.incrementCounter(`oauth_${provider}_errors_total`);
        }
      }
    }
  }

  recordTokenOperation(operation) {
    if (operation === 'issued') {
      this.incrementCounter('auth_tokens_issued_total');
    } else if (operation === 'refreshed') {
      this.incrementCounter('auth_tokens_refreshed_total');
    }
  }

  recordDatabaseQuery(duration, error = null) {
    this.incrementCounter('db_queries_total');
    this.recordHistogram('db_query_duration', duration);

    if (error) {
      this.incrementCounter('db_errors_total', { error_type: error.constructor.name });
    }
  }

  recordSecurityEvent(event, details = {}) {
    const eventMapping = {
      'rate_limit_hit': 'security_rate_limit_hits_total',
      'ip_blocked': 'security_blocked_ips_total',
      'suspicious_activity': 'security_suspicious_activities_total',
      'password_reset': 'security_password_resets_total'
    };

    const counterName = eventMapping[event];
    if (counterName) {
      this.incrementCounter(counterName, details);
    }
  }

  updateUserMetrics(total, active, verified, oauthLinked) {
    this.setGauge('users_total', total);
    this.setGauge('users_active', active);
    this.setGauge('users_verified', verified);
    this.setGauge('users_oauth_linked', oauthLinked);
  }

  collectSystemMetrics() {
    const memUsage = process.memoryUsage();

    // Memory metrics (in MB)
    this.setGauge('system_memory_usage', memUsage.rss / 1024 / 1024);

    // CPU metrics (basic approximation)
    const cpuUsage = process.cpuUsage();
    this.setGauge('system_cpu_usage', (cpuUsage.user + cpuUsage.system) / 1000000);

    // Uptime
    this.setGauge('system_uptime', process.uptime());
  }

  collectDatabaseMetrics() {
    try {
      const db = require('../database/connection');
      const poolStatus = db.getPoolStatus();

      if (poolStatus) {
        this.setGauge('db_connections_active', poolStatus.activeConnections || 0);
      }
    } catch (error) {
      logger.warn('Failed to collect database metrics:', error.message);
    }
  }

  collectUserMetrics() {
    try {
      const User = require('../auth/models/User');

      // Get user statistics
      User.getTotalCount()
        .then(total => this.setGauge('users_total', total))
        .catch(err => logger.warn('Failed to get total users count:', err.message));

      User.getActiveCount()
        .then(active => this.setGauge('users_active', active))
        .catch(err => logger.warn('Failed to get active users count:', err.message));

      User.getVerifiedCount()
        .then(verified => this.setGauge('users_verified', verified))
        .catch(err => logger.warn('Failed to get verified users count:', err.message));

      User.getOAuthLinkedCount()
        .then(oauthLinked => this.setGauge('users_oauth_linked', oauthLinked))
        .catch(err => logger.warn('Failed to get OAuth linked users count:', err.message));
    } catch (error) {
      logger.warn('Failed to collect user metrics:', error.message);
    }
  }

  getPrometheusMetrics() {
    let metrics = '';

    // Counter metrics
    for (const [name, counter] of this.counters) {
      metrics += `# HELP ${counter.name} ${counter.help}\n`;
      metrics += `# TYPE ${counter.name} counter\n`;
      metrics += `${counter.name} ${counter.value}\n\n`;
    }

    // Gauge metrics
    for (const [name, gauge] of this.gauges) {
      metrics += `# HELP ${gauge.name} ${gauge.help}\n`;
      metrics += `# TYPE ${gauge.name} gauge\n`;
      metrics += `${gauge.name} ${gauge.value}\n\n`;
    }

    // Histogram metrics
    for (const [name, histogram] of this.histograms) {
      metrics += `# HELP ${histogram.name} ${histogram.help}\n`;
      metrics += `# TYPE ${histogram.name} histogram\n`;

      // Count and sum
      metrics += `${name}_count ${histogram.count}\n`;
      metrics += `${name}_sum ${histogram.sum}\n`;

      // Buckets
      for (const bucket of histogram.buckets) {
        const count = histogram.observations.filter(obs => obs.value <= bucket).length;
        metrics += `${name}_bucket{le="${bucket}"} ${count}\n`;
      }
      metrics += `${name}_bucket{le="+Inf"} ${histogram.count}\n\n`;
    }

    return metrics;
  }

  getMetricsSummary() {
    const summary = {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      counters: {},
      gauges: {},
      histograms: {}
    };

    // Counters
    for (const [name, counter] of this.counters) {
      summary.counters[name] = counter.value;
    }

    // Gauges
    for (const [name, gauge] of this.gauges) {
      summary.gauges[name] = gauge.value;
    }

    // Histograms
    for (const [name, histogram] of this.histograms) {
      if (histogram.observations.length > 0) {
        const values = histogram.observations.map(obs => obs.value);
        values.sort((a, b) => a - b);

        summary.histograms[name] = {
          count: histogram.count,
          sum: histogram.sum,
          min: values[0],
          max: values[values.length - 1],
          mean: histogram.sum / histogram.count,
          p50: values[Math.floor(values.length * 0.5)],
          p95: values[Math.floor(values.length * 0.95)],
          p99: values[Math.floor(values.length * 0.99)]
        };
      } else {
        summary.histograms[name] = {
          count: 0,
          sum: 0,
          min: 0,
          max: 0,
          mean: 0,
          p50: 0,
          p95: 0,
          p99: 0
        };
      }
    }

    return summary;
  }

  resetMetrics() {
    for (const counter of this.counters.values()) {
      counter.value = 0;
    }

    for (const histogram of this.histograms.values()) {
      histogram.count = 0;
      histogram.sum = 0;
      histogram.observations = [];
    }
  }

  startCollection() {
    // Collect system metrics every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Collect database metrics every 60 seconds
    setInterval(() => {
      this.collectDatabaseMetrics();
    }, 60000);

    // Collect user metrics every 5 minutes
    setInterval(() => {
      this.collectUserMetrics();
    }, 300000);

    logger.info('Metrics collection started');
  }

  // Middleware for Express.js
  expressMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const route = req.route ? req.route.path : req.path;
        const method = req.method.toLowerCase();

        this.recordHttpRequest(method, route, res.statusCode, duration);
      });

      next();
    };
  }
}

module.exports = new MetricsCollector();