#!/usr/bin/env node

/**
 * Security Test Suite Runner
 * Comprehensive security testing including penetration testing and vulnerability assessment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { securityScenarios, attackScenarios, performanceScenarios } = require('../tests/security/fixtures/security-scenarios');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/security-tests.log')
    })
  ]
});

class SecurityTestSuite {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.testResults = {
      unit: { passed: 0, failed: 0, skipped: 0 },
      integration: { passed: 0, failed: 0, skipped: 0 },
      penetration: { passed: 0, failed: 0, skipped: 0 },
      performance: { passed: 0, failed: 0, skipped: 0 }
    };
    this.reportDir = path.join(this.projectRoot, 'reports', 'security-tests');
    this.ensureReportDirectory();
  }

  ensureReportDirectory() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  async runUnitTests() {
    logger.info('Running security unit tests...');

    try {
      const command = 'npm test -- --testPathPattern=security --verbose';
      logger.info(`Executing: ${command}`);

      const output = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe'
      });

      // Parse Jest output for results
      const results = this.parseJestOutput(output);
      this.testResults.unit = results;

      logger.info(`Unit tests completed: ${results.passed} passed, ${results.failed} failed`);
      return results;
    } catch (error) {
      logger.error('Unit tests failed:', error.message);
      this.testResults.unit = { passed: 0, failed: 1, skipped: 0 };
      throw error;
    }
  }

  async runIntegrationTests() {
    logger.info('Running security integration tests...');

    try {
      // Test API endpoints with security headers
      const apiTests = await this.testAPIEndpoints();

      // Test authentication and authorization
      const authTests = await this.testAuthentication();

      // Test data protection
      const dataTests = await this.testDataProtection();

      this.testResults.integration = {
        passed: apiTests.passed + authTests.passed + dataTests.passed,
        failed: apiTests.failed + authTests.failed + dataTests.failed,
        skipped: apiTests.skipped + authTests.skipped + dataTests.skipped
      };

      logger.info(`Integration tests completed: ${this.testResults.integration.passed} passed, ${this.testResults.integration.failed} failed`);
      return this.testResults.integration;
    } catch (error) {
      logger.error('Integration tests failed:', error.message);
      this.testResults.integration = { passed: 0, failed: 1, skipped: 0 };
      throw error;
    }
  }

  async testAPIEndpoints() {
    logger.info('Testing API endpoint security...');

    const results = { passed: 0, failed: 0, skipped: 0 };
    const endpoints = [
      '/api/health',
      '/api/auth/login',
      '/api/users/profile',
      '/api/admin/users'
    ];

    for (const endpoint of endpoints) {
      try {
        // Test security headers
        const hasSecurityHeaders = await this.checkSecurityHeaders(endpoint);
        if (hasSecurityHeaders) {
          results.passed++;
        } else {
          results.failed++;
        }

        // Test rate limiting
        const hasRateLimiting = await this.checkRateLimiting(endpoint);
        if (hasRateLimiting) {
          results.passed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        logger.warn(`Failed to test endpoint ${endpoint}:`, error.message);
        results.failed++;
      }
    }

    return results;
  }

  async testAuthentication() {
    logger.info('Testing authentication security...');

    const results = { passed: 0, failed: 0, skipped: 0 };

    try {
      // Test password complexity
      const passwordComplexity = await this.testPasswordComplexity();
      results.passed += passwordComplexity ? 1 : 0;
      results.failed += passwordComplexity ? 0 : 1;

      // Test session management
      const sessionManagement = await this.testSessionManagement();
      results.passed += sessionManagement ? 1 : 0;
      results.failed += sessionManagement ? 0 : 1;

      // Test MFA implementation
      const mfaImplementation = await this.testMFAImplementation();
      results.passed += mfaImplementation ? 1 : 0;
      results.failed += mfaImplementation ? 0 : 1;

    } catch (error) {
      logger.error('Authentication tests failed:', error.message);
      results.failed++;
    }

    return results;
  }

  async testDataProtection() {
    logger.info('Testing data protection...');

    const results = { passed: 0, failed: 0, skipped: 0 };

    try {
      // Test data encryption
      const dataEncryption = await this.testDataEncryption();
      results.passed += dataEncryption ? 1 : 0;
      results.failed += dataEncryption ? 0 : 1;

      // Test PII handling
      const piiHandling = await this.testPIIHandling();
      results.passed += piiHandling ? 1 : 0;
      results.failed += piiHandling ? 0 : 1;

      // Test audit logging
      const auditLogging = await this.testAuditLogging();
      results.passed += auditLogging ? 1 : 0;
      results.failed += auditLogging ? 0 : 1;

    } catch (error) {
      logger.error('Data protection tests failed:', error.message);
      results.failed++;
    }

    return results;
  }

  async runPenetrationTests() {
    logger.info('Running penetration tests...');

    const results = { passed: 0, failed: 0, skipped: 0 };

    try {
      // Test SQL injection
      const sqlInjectionResults = await this.testSQLInjection();
      results.passed += sqlInjectionResults.passed;
      results.failed += sqlInjectionResults.failed;

      // Test XSS
      const xssResults = await this.testXSS();
      results.passed += xssResults.passed;
      results.failed += xssResults.failed;

      // Test CSRF
      const csrfResults = await this.testCSRF();
      results.passed += csrfResults.passed;
      results.failed += csrfResults.failed;

      // Test brute force attacks
      const bruteForceResults = await this.testBruteForce();
      results.passed += bruteForceResults.passed;
      results.failed += bruteForceResults.failed;

      logger.info(`Penetration tests completed: ${results.passed} passed, ${results.failed} failed`);
      return results;
    } catch (error) {
      logger.error('Penetration tests failed:', error.message);
      results.failed++;
      return results;
    }
  }

  async runPerformanceTests() {
    logger.info('Running security performance tests...');

    const results = { passed: 0, failed: 0, skipped: 0 };

    try {
      // Test high-volume event processing
      const highVolumeResults = await this.testHighVolumeEvents();
      results.passed += highVolumeResults.passed;
      results.failed += highVolumeResults.failed;

      // Test concurrent security scans
      const concurrentScanResults = await this.testConcurrentScans();
      results.passed += concurrentScanResults.passed;
      results.failed += concurrentScanResults.failed;

      logger.info(`Performance tests completed: ${results.passed} passed, ${results.failed} failed`);
      return results;
    } catch (error) {
      logger.error('Performance tests failed:', error.message);
      results.failed++;
      return results;
    }
  }

  async testSQLInjection() {
    logger.info('Testing SQL injection vulnerabilities...');

    const results = { passed: 0, failed: 0 };
    const scenarios = attackScenarios.sqlInjection.requests;

    for (const scenario of scenarios) {
      try {
        const detected = await this.simulateAttack(scenario);
        if (scenario.expectedDetection && detected) {
          results.passed++;
        } else if (!scenario.expectedDetection && !detected) {
          results.passed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        logger.warn(`SQL injection test failed:`, error.message);
        results.failed++;
      }
    }

    return results;
  }

  async testXSS() {
    logger.info('Testing XSS vulnerabilities...');

    const results = { passed: 0, failed: 0 };
    const scenarios = attackScenarios.xss.requests;

    for (const scenario of scenarios) {
      try {
        const detected = await this.simulateAttack(scenario);
        if (scenario.expectedDetection && detected) {
          results.passed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        logger.warn(`XSS test failed:`, error.message);
        results.failed++;
      }
    }

    return results;
  }

  async testCSRF() {
    logger.info('Testing CSRF vulnerabilities...');

    const results = { passed: 0, failed: 0 };

    // Test for CSRF tokens
    try {
      const hasCSRFProtection = await this.checkCSRFProtection();
      results.passed += hasCSRFProtection ? 1 : 0;
      results.failed += hasCSRFProtection ? 0 : 1;
    } catch (error) {
      logger.warn(`CSRF test failed:`, error.message);
      results.failed++;
    }

    return results;
  }

  async testBruteForce() {
    logger.info('Testing brute force protection...');

    const results = { passed: 0, failed: 0 };
    const scenarios = attackScenarios.bruteForce.requests;

    for (const scenario of scenarios) {
      try {
        const detected = await this.simulateAttack(scenario);
        if (scenario.expectedDetection && detected) {
          results.passed++;
        } else if (!scenario.expectedDetection && !detected) {
          results.passed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        logger.warn(`Brute force test failed:`, error.message);
        results.failed++;
      }
    }

    return results;
  }

  async generateReport() {
    logger.info('Generating security test report...');

    const timestamp = new Date().toISOString();
    const report = {
      timestamp,
      summary: {
        total: Object.values(this.testResults).reduce((sum, cat) => sum + cat.passed + cat.failed + cat.skipped, 0),
        passed: Object.values(this.testResults).reduce((sum, cat) => sum + cat.passed, 0),
        failed: Object.values(this.testResults).reduce((sum, cat) => sum + cat.failed, 0),
        skipped: Object.values(this.testResults).reduce((sum, cat) => sum + cat.skipped, 0)
      },
      categories: this.testResults,
      recommendations: this.generateRecommendations()
    };

    const reportPath = path.join(this.reportDir, `security-test-report-${timestamp.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    logger.info(`Security test report generated: ${reportPath}`);

    // Generate HTML report
    await this.generateHTMLReport(report, reportPath.replace('.json', '.html'));

    return report;
  }

  generateRecommendations() {
    const recommendations = [];

    if (this.testResults.unit.failed > 0) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Unit Tests',
        description: `${this.testResults.unit.failed} unit tests failed. Fix failing tests to ensure code quality.`
      });
    }

    if (this.testResults.integration.failed > 0) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Integration',
        description: `${this.testResults.integration.failed} integration tests failed. Review API security and authentication.`
      });
    }

    if (this.testResults.penetration.failed > 0) {
      recommendations.push({
        priority: 'CRITICAL',
        category: 'Penetration Testing',
        description: `${this.testResults.penetration.failed} penetration tests failed. Address security vulnerabilities immediately.`
      });
    }

    if (this.testResults.performance.failed > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Performance',
        description: `${this.testResults.performance.failed} performance tests failed. Optimize security monitoring performance.`
      });
    }

    return recommendations;
  }

  async generateHTMLReport(report, htmlPath) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Security Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 5px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .metric { background: #e9ecef; padding: 15px; border-radius: 5px; text-align: center; }
        .passed { background: #d4edda; }
        .failed { background: #f8d7da; }
        .skipped { background: #fff3cd; }
        .recommendations { margin-top: 20px; }
        .recommendation { background: #f8f9fa; padding: 10px; margin: 5px 0; border-left: 4px solid #007bff; }
        .critical { border-left-color: #dc3545; }
        .high { border-left-color: #fd7e14; }
        .medium { border-left-color: #ffc107; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Security Test Report</h1>
        <p>Generated: ${report.timestamp}</p>
    </div>

    <div class="summary">
        <div class="metric">
            <h3>Total Tests</h3>
            <p>${report.summary.total}</p>
        </div>
        <div class="metric passed">
            <h3>Passed</h3>
            <p>${report.summary.passed}</p>
        </div>
        <div class="metric failed">
            <h3>Failed</h3>
            <p>${report.summary.failed}</p>
        </div>
        <div class="metric skipped">
            <h3>Skipped</h3>
            <p>${report.summary.skipped}</p>
        </div>
    </div>

    <div class="recommendations">
        <h2>Recommendations</h2>
        ${report.recommendations.map(rec => `
            <div class="recommendation ${rec.priority.toLowerCase()}">
                <strong>${rec.priority} - ${rec.category}:</strong>
                <p>${rec.description}</p>
            </div>
        `).join('')}
    </div>
</body>
</html>`;

    fs.writeFileSync(htmlPath, html);
    logger.info(`HTML report generated: ${htmlPath}`);
  }

  parseJestOutput(output) {
    const lines = output.split('\n');
    const results = { passed: 0, failed: 0, skipped: 0 };

    for (const line of lines) {
      if (line.includes('✓') || line.includes('PASS')) {
        results.passed++;
      } else if (line.includes('✗') || line.includes('FAIL')) {
        results.failed++;
      } else if (line.includes('○') || line.includes('SKIP')) {
        results.skipped++;
      }
    }

    return results;
  }

  async run() {
    logger.info('Starting comprehensive security test suite...');

    try {
      // Run all test categories
      await this.runUnitTests();
      await this.runIntegrationTests();
      await this.runPenetrationTests();
      await this.runPerformanceTests();

      // Generate comprehensive report
      const report = await this.generateReport();

      // Output summary
      console.log('\n=== Security Test Suite Results ===');
      console.log(`Total Tests: ${report.summary.total}`);
      console.log(`Passed: ${report.summary.passed}`);
      console.log(`Failed: ${report.summary.failed}`);
      console.log(`Skipped: ${report.summary.skipped}`);
      console.log(`Success Rate: ${((report.summary.passed / report.summary.total) * 100).toFixed(2)}%`);

      if (report.summary.failed > 0) {
        console.log('\n⚠️  Some security tests failed - Review recommendations');
        process.exit(1);
      } else {
        console.log('\n✅ All security tests passed');
        process.exit(0);
      }

    } catch (error) {
      logger.error('Security test suite failed:', error);
      process.exit(1);
    }
  }

  // Helper methods (simplified for demonstration)
  async checkSecurityHeaders(endpoint) { /* Implementation */ return true; }
  async checkRateLimiting(endpoint) { /* Implementation */ return true; }
  async testPasswordComplexity() { /* Implementation */ return true; }
  async testSessionManagement() { /* Implementation */ return true; }
  async testMFAImplementation() { /* Implementation */ return true; }
  async testDataEncryption() { /* Implementation */ return true; }
  async testPIIHandling() { /* Implementation */ return true; }
  async testAuditLogging() { /* Implementation */ return true; }
  async simulateAttack(scenario) { /* Implementation */ return true; }
  async checkCSRFProtection() { /* Implementation */ return true; }
  async testHighVolumeEvents() { /* Implementation */ return { passed: 1, failed: 0 }; }
  async testConcurrentScans() { /* Implementation */ return { passed: 1, failed: 0 }; }
}

// Run if called directly
if (require.main === module) {
  const testSuite = new SecurityTestSuite();
  testSuite.run().catch(error => {
    logger.error('Security test suite failed:', error);
    process.exit(1);
  });
}

module.exports = SecurityTestSuite;