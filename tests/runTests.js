#!/usr/bin/env node

/**
 * WebSocket Notification System Test Runner
 * Provides comprehensive test execution and reporting
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { testConfig } = require('./config/testConfig');

class TestRunner {
  constructor() {
    this.results = {
      startTime: new Date(),
      endTime: null,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      suites: [],
      coverage: null,
      performance: null
    };

    this.reportDir = testConfig.reporting.outputDir;
    this.ensureReportDirectory();
  }

  /**
   * Ensure report directory exists
   */
  ensureReportDirectory() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  /**
   * Run all test suites
   */
  async runAllTests() {
    console.log('🚀 Starting WebSocket Notification System Test Suite\n');
    console.log(`Started at: ${this.results.startTime.toISOString()}`);
    console.log('=' .repeat(60));

    try {
      // Run unit tests
      await this.runUnitTests();

      // Run integration tests
      await this.runIntegrationTests();

      // Run load tests
      await this.runLoadTests();

      // Run security tests
      await this.runSecurityTests();

      // Generate coverage report
      if (testConfig.reporting.includeCoverage) {
        await this.generateCoverageReport();
      }

      // Generate final report
      this.results.endTime = new Date();
      await this.generateReport();

      console.log('=' .repeat(60));
      console.log('✅ All tests completed successfully!');
      console.log(`Duration: ${this.getDuration()}ms`);

    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Run unit tests
   */
  async runUnitTests() {
    console.log('\n📋 Running Unit Tests...');

    const suiteResults = await this.runMochaTests(
      'tests/unit/**/*.test.js',
      'Unit Tests'
    );

    this.results.suites.push(suiteResults);
    this.updateTotals(suiteResults);

    console.log(`Unit Tests: ${suiteResults.passed}/${suiteResults.total} passed ✅`);
  }

  /**
   * Run integration tests
   */
  async runIntegrationTests() {
    console.log('\n🔗 Running Integration Tests...');

    const suiteResults = await this.runMochaTests(
      'tests/integration/**/*.test.js',
      'Integration Tests'
    );

    this.results.suites.push(suiteResults);
    this.updateTotals(suiteResults);

    console.log(`Integration Tests: ${suiteResults.passed}/${suiteResults.total} passed ✅`);
  }

  /**
   * Run load tests
   */
  async runLoadTests() {
    console.log('\n⚡ Running Load Tests...');

    const suiteResults = await this.runMochaTests(
      'tests/websocket/loadTesting.test.js',
      'Load Tests',
      { timeout: 300000 }
    );

    this.results.suites.push(suiteResults);
    this.updateTotals(suiteResults);

    console.log(`Load Tests: ${suiteResults.passed}/${suiteResults.total} passed ✅`);
  }

  /**
   * Run security tests
   */
  async runSecurityTests() {
    console.log('\n🔒 Running Security Tests...');

    const suiteResults = await this.runMochaTests(
      'tests/security/**/*.test.js',
      'Security Tests'
    );

    this.results.suites.push(suiteResults);
    this.updateTotals(suiteResults);

    console.log(`Security Tests: ${suiteResults.passed}/${suiteResults.total} passed ✅`);
  }

  /**
   * Run Mocha tests
   */
  async runMochaTests(pattern, suiteName, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const mochaPath = require.resolve('mocha/bin/mocha');
        const testFiles = this.findTestFiles(pattern);

        if (testFiles.length === 0) {
          console.log(`⚠️  No test files found for pattern: ${pattern}`);
          resolve({
            name: suiteName,
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0
          });
          return;
        }

        const args = [
          mochaPath,
          ...testFiles,
          '--reporter', 'json',
          '--timeout', options.timeout || '10000',
          '--recursive'
        ];

        if (process.env.CI) {
          args.push('--reporter', 'spec');
        }

        const output = execSync(args.join(' '), {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });

        const results = JSON.parse(output);
        const suiteResults = this.parseMochaResults(results, suiteName);

        resolve(suiteResults);

      } catch (error) {
        // Parse error output for test results
        try {
          const errorOutput = error.stdout || error.stderr;
          if (errorOutput) {
            const results = JSON.parse(errorOutput);
            const suiteResults = this.parseMochaResults(results, suiteName);
            resolve(suiteResults);
            return;
          }
        } catch (parseError) {
          // Could not parse error output
        }

        reject(new Error(`Test execution failed for ${suiteName}: ${error.message}`));
      }
    });
  }

  /**
   * Find test files matching pattern
   */
  findTestFiles(pattern) {
    const glob = require('glob');
    const files = glob.sync(pattern, {
      cwd: path.join(__dirname, '..'),
      absolute: true
    });
    return files.filter(file => fs.existsSync(file));
  }

  /**
   * Parse Mocha JSON results
   */
  parseMochaResults(results, suiteName) {
    const stats = results.stats || {};
    const failures = results.failures || [];

    return {
      name: suiteName,
      total: stats.tests || 0,
      passed: stats.passes || 0,
      failed: stats.failures || 0,
      skipped: stats.pending || 0,
      duration: stats.duration || 0,
      failures: failures.map(failure => ({
        title: failure.fullTitle,
        message: failure.err.message,
        stack: failure.err.stack
      }))
    };
  }

  /**
   * Update total results
   */
  updateTotals(suiteResults) {
    this.results.totalTests += suiteResults.total;
    this.results.passedTests += suiteResults.passed;
    this.results.failedTests += suiteResults.failed;
    this.results.skippedTests += suiteResults.skipped;
  }

  /**
   * Generate coverage report
   */
  async generateCoverageReport() {
    console.log('\n📊 Generating Coverage Report...');

    try {
      const nycPath = require.resolve('nyc/bin/nyc');
      const args = [
        nycPath,
        'report',
        '--reporter', 'json',
        '--reporter', 'html',
        '--reporter', 'text',
        '--report-dir', this.reportDir
      ];

      execSync(args.join(' '), { stdio: 'pipe' });

      // Read coverage data
      const coverageFile = path.join(this.reportDir, 'coverage-summary.json');
      if (fs.existsSync(coverageFile)) {
        this.results.coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
      }

      console.log('Coverage report generated ✅');
    } catch (error) {
      console.log('⚠️  Coverage report generation failed:', error.message);
    }
  }

  /**
   * Generate final report
   */
  async generateReport() {
    const reportData = {
      summary: {
        startTime: this.results.startTime.toISOString(),
        endTime: this.results.endTime.toISOString(),
        duration: this.getDuration(),
        total: this.results.totalTests,
        passed: this.results.passedTests,
        failed: this.results.failedTests,
        skipped: this.results.skippedTests,
        successRate: this.getSuccessRate()
      },
      suites: this.results.suites,
      coverage: this.results.coverage,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        testConfig: testConfig
      }
    };

    // Generate JSON report
    const jsonReport = path.join(this.reportDir, `test-report-${Date.now()}.json`);
    fs.writeFileSync(jsonReport, JSON.stringify(reportData, null, 2));

    // Generate HTML report
    if (testConfig.reporting.formats.includes('html')) {
      await this.generateHTMLReport(reportData);
    }

    // Print summary
    this.printSummary(reportData.summary);
  }

  /**
   * Generate HTML report
   */
  async generateHTMLReport(reportData) {
    const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Notification System Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .summary { margin: 20px 0; }
        .suite { margin: 10px 0; border: 1px solid #ddd; padding: 10px; }
        .passed { color: green; }
        .failed { color: red; }
        .skipped { color: orange; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>WebSocket Notification System Test Report</h1>
        <p>Generated: ${new Date().toISOString()}</p>
    </div>

    <div class="summary">
        <h2>Test Summary</h2>
        <table>
            <tr><th>Total Tests</th><td>${reportData.summary.total}</td></tr>
            <tr><th>Passed</th><td class="passed">${reportData.summary.passed}</td></tr>
            <tr><th>Failed</th><td class="failed">${reportData.summary.failed}</td></tr>
            <tr><th>Skipped</th><td class="skipped">${reportData.summary.skipped}</td></tr>
            <tr><th>Success Rate</th><td>${reportData.summary.successRate.toFixed(2)}%</td></tr>
            <tr><th>Duration</th><td>${reportData.summary.duration}ms</td></tr>
        </table>
    </div>

    <div class="suites">
        <h2>Test Suites</h2>
        ${reportData.suites.map(suite => `
            <div class="suite">
                <h3>${suite.name}</h3>
                <table>
                    <tr><th>Total</th><td>${suite.total}</td></tr>
                    <tr><th>Passed</th><td class="passed">${suite.passed}</td></tr>
                    <tr><th>Failed</th><td class="failed">${suite.failed}</td></tr>
                    <tr><th>Duration</th><td>${suite.duration}ms</td></tr>
                </table>
            </div>
        `).join('')}
    </div>

    ${reportData.coverage ? `
    <div class="coverage">
        <h2>Coverage Report</h2>
        <table>
            <tr><th>Lines</th><td>${reportData.coverage.total.lines.pct}%</td></tr>
            <tr><th>Functions</th><td>${reportData.coverage.total.functions.pct}%</td></tr>
            <tr><th>Branches</th><td>${reportData.coverage.total.branches.pct}%</td></tr>
            <tr><th>Statements</th><td>${reportData.coverup.total.statements.pct}%</td></tr>
        </table>
    </div>
    ` : ''}
</body>
</html>`;

    const htmlReport = path.join(this.reportDir, `test-report-${Date.now()}.html`);
    fs.writeFileSync(htmlReport, htmlTemplate);
  }

  /**
   * Print test summary
   */
  printSummary(summary) {
    console.log('\n' + '=' .repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total Tests: ${summary.total}`);
    console.log(`Passed: ${summary.passed} ✅`);
    console.log(`Failed: ${summary.failed} ❌`);
    console.log(`Skipped: ${summary.skipped} ⏭️`);
    console.log(`Success Rate: ${summary.successRate.toFixed(2)}%`);
    console.log(`Duration: ${summary.duration}ms`);

    if (summary.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.suites.forEach(suite => {
        if (suite.failures && suite.failures.length > 0) {
          console.log(`\n${suite.name}:`);
          suite.failures.forEach(failure => {
            console.log(`  - ${failure.title}`);
            console.log(`    ${failure.message}`);
          });
        }
      });
    }

    console.log('\n📁 Reports saved to:', this.reportDir);
  }

  /**
   * Get test duration
   */
  getDuration() {
    if (this.results.endTime) {
      return this.results.endTime - this.results.startTime;
    }
    return Date.now() - this.results.startTime;
  }

  /**
   * Get success rate
   */
  getSuccessRate() {
    if (this.results.totalTests === 0) return 0;
    return (this.results.passedTests / this.results.totalTests) * 100;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const runner = new TestRunner();

  // Parse command line arguments
  const options = {
    unit: args.includes('--unit'),
    integration: args.includes('--integration'),
    load: args.includes('--load'),
    security: args.includes('--security'),
    coverage: args.includes('--coverage'),
    help: args.includes('--help') || args.includes('-h')
  };

  if (options.help) {
    console.log(`
WebSocket Notification System Test Runner

Usage: node runTests.js [options]

Options:
  --unit          Run unit tests only
  --integration   Run integration tests only
  --load          Run load tests only
  --security      Run security tests only
  --coverage      Generate coverage report
  --help, -h      Show this help message

Examples:
  node runTests.js                    # Run all tests
  node runTests.js --unit             # Run unit tests only
  node runTests.js --load --coverage  # Run load tests with coverage
    `);
    process.exit(0);
  }

  // Run tests based on options
  if (options.unit || options.integration || options.load || options.security) {
    // Run specific test suites
    if (options.unit) await runner.runUnitTests();
    if (options.integration) await runner.runIntegrationTests();
    if (options.load) await runner.runLoadTests();
    if (options.security) await runner.runSecurityTests();
    if (options.coverage) await runner.generateCoverageReport();

    runner.results.endTime = new Date();
    await runner.generateReport();
  } else {
    // Run all tests
    runner.runAllTests();
  }
}

module.exports = TestRunner;