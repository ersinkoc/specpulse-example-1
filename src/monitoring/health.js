const { logger } = require('../shared/utils/logger');
const { performance } = require('perf_hooks');

class HealthChecker {
  constructor() {
    this.startTime = Date.now();
    this.checks = new Map();
    this.setupDefaultChecks();
  }

  setupDefaultChecks() {
    // Database health check
    this.addCheck('database', async () => {
      try {
        const db = require('../database/connection');
        const result = await db.query('SELECT 1');
        return {
          status: 'healthy',
          message: 'Database connection successful',
          details: {
            queryTime: result.queryTime || 0,
            connectionPool: result.poolStatus || 'unknown'
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: 'Database connection failed',
          error: error.message,
          details: {
            queryTime: 0,
            connectionPool: 'disconnected'
          }
        };
      }
    });

    // Redis health check
    this.addCheck('redis', async () => {
      try {
        const redis = require('../services/redisService');
        const startTime = performance.now();
        const pong = await redis.ping();
        const responseTime = performance.now() - startTime;

        return {
          status: 'healthy',
          message: 'Redis connection successful',
          details: {
            responseTime: `${responseTime.toFixed(2)}ms`,
            pong: pong
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: 'Redis connection failed',
          error: error.message
        };
      }
    });

    // JWT service health check
    this.addCheck('jwt', async () => {
      try {
        const tokenService = require('../auth/services/tokenService');
        const testUser = { id: 'health-check', email: 'health@check.com' };
        const startTime = performance.now();

        const tokens = tokenService.generateTokens(testUser);
        const decoded = tokenService.verifyToken(tokens.accessToken);

        const responseTime = performance.now() - startTime;

        return {
          status: 'healthy',
          message: 'JWT service operational',
          details: {
            responseTime: `${responseTime.toFixed(2)}ms`,
            tokenGeneration: 'success',
            tokenVerification: 'success'
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: 'JWT service error',
          error: error.message
        };
      }
    });

    // OAuth2 service health check
    this.addCheck('oauth2', async () => {
      try {
        const oAuthService = require('../auth/services/oauthService');
        const providers = oAuthService.getAvailableProviders();

        return {
          status: 'healthy',
          message: 'OAuth2 service operational',
          details: {
            availableProviders: providers.length,
            providers: providers.map(p => ({
              name: p.name,
              enabled: p.enabled,
              configured: p.configured
            }))
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: 'OAuth2 service error',
          error: error.message
        };
      }
    });

    // Email service health check
    this.addCheck('email', async () => {
      try {
        const emailService = require('../auth/services/emailService');
        const config = emailService.getConfig();

        return {
          status: config && config.smtpHost ? 'healthy' : 'warning',
          message: config && config.smtpHost ? 'Email service configured' : 'Email service not configured',
          details: {
            configured: !!(config && config.smtpHost),
            smtpHost: config?.smtpHost || 'not set',
            smtpPort: config?.smtpPort || 'not set',
            fromEmail: config?.fromEmail || 'not set'
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: 'Email service error',
          error: error.message
        };
      }
    });

    // File system health check
    this.addCheck('filesystem', async () => {
      try {
        const fs = require('fs').promises;
        const path = require('path');

        const uploadsDir = path.join(process.cwd(), 'uploads');
        const logsDir = path.join(process.cwd(), 'logs');

        const stats = await Promise.allSettled([
          fs.stat(uploadsDir).catch(() => null),
          fs.stat(logsDir).catch(() => null)
        ]);

        const uploadsExists = stats[0].status === 'fulfilled' && stats[0].value;
        const logsExists = stats[1].status === 'fulfilled' && stats[1].value;

        return {
          status: 'healthy',
          message: 'File system accessible',
          details: {
            uploadsDirectory: {
              exists: !!uploadsExists,
              writable: uploadsExists ? await fs.access(uploadsDir, fs.constants.W_OK).then(() => true).catch(() => false) : false
            },
            logsDirectory: {
              exists: !!logsExists,
              writable: logsExists ? await fs.access(logsDir, fs.constants.W_OK).then(() => true).catch(() => false) : false
            }
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: 'File system error',
          error: error.message
        };
      }
    });
  }

  addCheck(name, checkFunction) {
    this.checks.set(name, checkFunction);
  }

  async runCheck(name) {
    const checkFunction = this.checks.get(name);
    if (!checkFunction) {
      throw new Error(`Health check '${name}' not found`);
    }

    const startTime = performance.now();
    try {
      const result = await checkFunction();
      const endTime = performance.now();

      return {
        name,
        ...result,
        duration: `${(endTime - startTime).toFixed(2)}ms`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const endTime = performance.now();

      return {
        name,
        status: 'unhealthy',
        message: `Health check failed: ${error.message}`,
        error: error.message,
        duration: `${(endTime - startTime).toFixed(2)}ms`,
        timestamp: new Date().toISOString()
      };
    }
  }

  async runAllChecks() {
    const checkPromises = Array.from(this.checks.keys()).map(name =>
      this.runCheck(name)
    );

    const results = await Promise.allSettled(checkPromises);

    const checks = [];
    let overallStatus = 'healthy';
    let unhealthyCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        checks.push(result.value);
        if (result.value.status === 'unhealthy') {
          overallStatus = 'unhealthy';
          unhealthyCount++;
        } else if (result.value.status === 'warning' && overallStatus === 'healthy') {
          overallStatus = 'warning';
        }
      } else {
        checks.push({
          name: Array.from(this.checks.keys())[index],
          status: 'unhealthy',
          message: 'Health check threw an error',
          error: result.reason.message,
          timestamp: new Date().toISOString()
        });
        overallStatus = 'unhealthy';
        unhealthyCount++;
      }
    });

    const uptime = Date.now() - this.startTime;

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime / 1000),
        humanReadable: this.formatUptime(uptime)
      },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks,
      summary: {
        total: checks.length,
        healthy: checks.filter(c => c.status === 'healthy').length,
        unhealthy: unhealthyCount,
        warnings: checks.filter(c => c.status === 'warning').length
      }
    };
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async checkSystemHealth() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid,
        uptime: process.uptime()
      },
      memory: {
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    };
  }

  async checkReadiness() {
    // Readiness checks - all critical services must be ready
    const criticalChecks = ['database', 'jwt'];
    const results = {};

    for (const checkName of criticalChecks) {
      try {
        const result = await this.runCheck(checkName);
        results[checkName] = result;
      } catch (error) {
        results[checkName] = {
          status: 'unhealthy',
          message: error.message
        };
      }
    }

    const allReady = Object.values(results).every(result => result.status === 'healthy');

    return {
      status: allReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: results
    };
  }

  async checkLiveness() {
    // Liveness checks - basic application responsiveness
    try {
      const systemHealth = await this.checkSystemHealth();
      return {
        status: 'alive',
        timestamp: new Date().toISOString(),
        system: systemHealth
      };
    } catch (error) {
      return {
        status: 'not_alive',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

module.exports = new HealthChecker();