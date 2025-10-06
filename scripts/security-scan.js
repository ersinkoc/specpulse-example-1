#!/usr/bin/env node

/**
 * Security Scanning Script
 * Integrates with OWASP Dependency-Check and other security scanning tools
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

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
      filename: path.join(__dirname, '../logs/security-scan.log')
    })
  ]
});

class SecurityScanner {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.reportDir = path.join(this.projectRoot, 'reports', 'security');
    this.ensureReportDirectory();
  }

  ensureReportDirectory() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  async runDependencyCheck() {
    logger.info('Starting OWASP Dependency-Check...');

    try {
      const reportPath = path.join(this.reportDir, 'dependency-check-report.json');

      // Run OWASP Dependency-Check
      const command = `dependency-check --project "Security Audit System" --scan "${this.projectRoot}" --format JSON --out "${this.reportDir}" --suppression "${path.join(__dirname, '../config/suppressions.xml')}"`;

      logger.info(`Executing: ${command}`);
      execSync(command, { stdio: 'inherit' });

      logger.info('Dependency check completed successfully');
      return this.parseDependencyCheckReport(reportPath);
    } catch (error) {
      logger.error('Dependency check failed:', error);
      throw error;
    }
  }

  async runCodeAnalysis() {
    logger.info('Starting code analysis...');

    const issues = [];
    const patterns = [
      {
        pattern: /eval\s*\(/g,
        severity: 'HIGH',
        description: 'Use of eval() function detected'
      },
      {
        pattern: /Function\s*\(/g,
        severity: 'MEDIUM',
        description: 'Use of Function() constructor detected'
      },
      {
        pattern: /setTimeout\s*\(\s*["']/g,
        severity: 'MEDIUM',
        description: 'Use of setTimeout with string argument detected'
      },
      {
        pattern: /innerHTML\s*=/g,
        severity: 'HIGH',
        description: 'Potential XSS vulnerability with innerHTML'
      },
      {
        pattern: /document\.write\s*\(/g,
        severity: 'HIGH',
        description: 'Use of document.write() detected'
      }
    ];

    // Scan JavaScript files
    this.scanDirectory(path.join(this.projectRoot, 'src'), patterns, issues);

    // Scan configuration files
    this.scanDirectory(path.join(this.projectRoot, 'config'), patterns, issues);

    logger.info(`Code analysis completed. Found ${issues.length} issues`);
    return issues;
  }

  scanDirectory(dir, patterns, issues) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = path.join(dir, file.name);

      if (file.isDirectory()) {
        this.scanDirectory(fullPath, patterns, issues);
      } else if (file.isFile() && this.shouldScanFile(file.name)) {
        this.scanFile(fullPath, patterns, issues);
      }
    }
  }

  shouldScanFile(filename) {
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.json'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  scanFile(filePath, patterns, issues) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      patterns.forEach(patternInfo => {
        let match;
        while ((match = patternInfo.pattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split('\n').length;
          issues.push({
            file: filePath,
            line: lineNumber,
            severity: patternInfo.severity,
            description: patternInfo.description,
            match: match[0]
          });
        }
      });
    } catch (error) {
      logger.warn(`Failed to scan file ${filePath}:`, error.message);
    }
  }

  async runEnvironmentCheck() {
    logger.info('Starting environment security check...');

    const issues = [];

    // Check environment variables
    const sensitiveVars = [
      'DATABASE_PASSWORD',
      'JWT_SECRET',
      'SESSION_SECRET',
      'API_KEY',
      'PRIVATE_KEY'
    ];

    sensitiveVars.forEach(varName => {
      if (process.env[varName]) {
        // Check if value is weak
        const value = process.env[varName];
        if (value.length < 16 || value === 'password' || value === 'secret') {
          issues.push({
            type: 'environment',
            severity: 'HIGH',
            description: `Weak value for ${varName}`,
            recommendation: 'Use a strong, randomly generated secret'
          });
        }
      }
    });

    // Check file permissions
    const sensitiveFiles = [
      '.env',
      'keys',
      'config'
    ];

    sensitiveFiles.forEach(file => {
      const fullPath = path.join(this.projectRoot, file);
      if (fs.existsSync(fullPath)) {
        try {
          const stats = fs.statSync(fullPath);
          // Check if file is readable by others
          if ((stats.mode & 0o044) !== 0) {
            issues.push({
              type: 'file-permissions',
              severity: 'MEDIUM',
              file: fullPath,
              description: 'Sensitive file has world-readable permissions',
              recommendation: 'Restrict file permissions to owner only'
            });
          }
        } catch (error) {
          logger.warn(`Failed to check permissions for ${fullPath}:`, error.message);
        }
      }
    });

    logger.info(`Environment check completed. Found ${issues.length} issues`);
    return issues;
  }

  parseDependencyCheckReport(reportPath) {
    try {
      if (!fs.existsSync(reportPath)) {
        return [];
      }

      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const vulnerabilities = [];

      if (report.dependencies) {
        report.dependencies.forEach(dep => {
          if (dep.vulnerabilities) {
            dep.vulnerabilities.forEach(vuln => {
              vulnerabilities.push({
                type: 'dependency',
                severity: this.mapSeverity(vuln.severity),
                dependency: dep.fileName,
                name: vuln.name,
                description: vuln.description,
                cvssScore: vuln.cvssScore,
                cve: vuln.cve,
                vendor: vuln.vendor,
                product: vuln.product
              });
            });
          }
        });
      }

      return vulnerabilities;
    } catch (error) {
      logger.error('Failed to parse dependency check report:', error);
      return [];
    }
  }

  mapSeverity(severity) {
    const mapping = {
      'CRITICAL': 'CRITICAL',
      'HIGH': 'HIGH',
      'MEDIUM': 'MEDIUM',
      'LOW': 'LOW'
    };
    return mapping[severity] || 'UNKNOWN';
  }

  async generateReport(results) {
    const timestamp = new Date().toISOString();
    const report = {
      timestamp,
      summary: {
        total: results.issues.length,
        critical: results.issues.filter(i => i.severity === 'CRITICAL').length,
        high: results.issues.filter(i => i.severity === 'HIGH').length,
        medium: results.issues.filter(i => i.severity === 'MEDIUM').length,
        low: results.issues.filter(i => i.severity === 'LOW').length
      },
      issues: results.issues
    };

    const reportPath = path.join(this.reportDir, `security-scan-${timestamp.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    logger.info(`Security scan report generated: ${reportPath}`);

    // Generate summary for console output
    console.log('\n=== Security Scan Report ===');
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Total Issues: ${report.summary.total}`);
    console.log(`Critical: ${report.summary.critical}`);
    console.log(`High: ${report.summary.high}`);
    console.log(`Medium: ${report.summary.medium}`);
    console.log(`Low: ${report.summary.low}`);

    if (report.summary.critical > 0 || report.summary.high > 0) {
      console.log('\n⚠️  HIGH PRIORITY ISSUES DETECTED - Review immediately!');
    }

    return report;
  }

  async run() {
    logger.info('Starting comprehensive security scan...');

    const results = {
      issues: []
    };

    try {
      // Run all security checks
      const dependencyIssues = await this.runDependencyCheck();
      const codeIssues = await this.runCodeAnalysis();
      const environmentIssues = await this.runEnvironmentCheck();

      results.issues = [...dependencyIssues, ...codeIssues, ...environmentIssues];

      // Generate report
      const report = await this.generateReport(results);

      // Exit with appropriate code
      if (report.summary.critical > 0 || report.summary.high > 0) {
        logger.error('Security scan completed with critical/high issues');
        process.exit(1);
      } else {
        logger.info('Security scan completed successfully');
        process.exit(0);
      }

    } catch (error) {
      logger.error('Security scan failed:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const scanner = new SecurityScanner();
  scanner.run().catch(error => {
    logger.error('Security scanner failed:', error);
    process.exit(1);
  });
}

module.exports = SecurityScanner;