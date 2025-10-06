/**
 * Dependency Checker
 * Specialized dependency vulnerability checker with advanced analysis
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

class DependencyChecker {
  constructor(config = {}) {
    this.config = {
      scanPath: config.scanPath || process.cwd(),
      ignoreDevDependencies: config.ignoreDevDependencies || false,
      ignoreOptionalDependencies: config.ignoreOptionalDependencies || false,
      customRules: config.customRules || [],
      licenseCheck: config.licenseCheck !== false,
      outdatedCheck: config.outdatedCheck !== false,
      ...config
    };
  }

  /**
   * Analyze package dependencies for vulnerabilities
   */
  async analyzeDependencies() {
    try {
      const packageJsonPath = path.join(this.config.scanPath, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      const dependencies = {
        production: packageJson.dependencies || {},
        development: this.config.ignoreDevDependencies ? {} : (packageJson.devDependencies || {}),
        optional: this.config.ignoreOptionalDependencies ? {} : (packageJson.optionalDependencies || {})
      };

      const analysis = {
        totalDependencies: 0,
        dependencies: {},
        summary: {
          production: Object.keys(dependencies.production).length,
          development: Object.keys(dependencies.development).length,
          optional: Object.keys(dependencies.optional).length
        },
        issues: []
      };

      // Analyze each dependency type
      for (const [type, deps] of Object.entries(dependencies)) {
        analysis.dependencies[type] = await this.analyzeDependencySet(deps, type);
        analysis.totalDependencies += Object.keys(deps).length;
      }

      // Apply custom rules
      if (this.config.customRules.length > 0) {
        await this.applyCustomRules(analysis);
      }

      // Check for outdated packages
      if (this.config.outdatedCheck) {
        analysis.outdated = await this.checkOutdatedPackages(dependencies);
      }

      // Check licenses
      if (this.config.licenseCheck) {
        analysis.licenses = await this.checkLicenses(dependencies);
      }

      return analysis;

    } catch (error) {
      throw new Error(`Dependency analysis failed: ${error.message}`);
    }
  }

  /**
   * Analyze a set of dependencies
   */
  async analyzeDependencySet(dependencies, type) {
    const analysis = {};

    for (const [name, version] of Object.entries(dependencies)) {
      try {
        const depInfo = await this.analyzeSingleDependency(name, version, type);
        analysis[name] = depInfo;
      } catch (error) {
        analysis[name] = {
          name,
          version,
          type,
          error: error.message,
          status: 'error'
        };
      }
    }

    return analysis;
  }

  /**
   * Analyze a single dependency
   */
  async analyzeSingleDependency(name, version, type) {
    const packagePath = path.join(this.config.scanPath, 'node_modules', name, 'package.json');
    let packageInfo = null;

    try {
      if (fs.existsSync(packagePath)) {
        packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      }
    } catch (error) {
      // Continue without package info
    }

    const analysis = {
      name,
      version,
      type,
      status: 'installed',
      hasPackageInfo: !!packageInfo,
      issues: []
    };

    if (packageInfo) {
      analysis.packageInfo = {
        version: packageInfo.version,
        description: packageInfo.description,
        license: packageInfo.license,
        author: packageInfo.author,
        homepage: packageInfo.homepage,
        repository: packageInfo.repository,
        engines: packageInfo.engines,
        scripts: Object.keys(packageInfo.scripts || {}),
        dependencies: Object.keys(packageInfo.dependencies || {}),
        devDependencies: Object.keys(packageInfo.devDependencies || {})
      };

      // Version consistency check
      if (packageInfo.version && !semver.satisfies(packageInfo.version, version)) {
        analysis.issues.push({
          type: 'version_mismatch',
          severity: 'warning',
          message: `Installed version ${packageInfo.version} does not satisfy requirement ${version}`
        });
      }

      // Check for deprecated packages
      if (packageInfo.deprecated) {
        analysis.issues.push({
          type: 'deprecated',
          severity: 'high',
          message: `Package is deprecated: ${packageInfo.deprecated}`
        });
      }

      // Check security scripts
      const suspiciousScripts = ['preinstall', 'postinstall', 'preuninstall', 'postuninstall'];
      const foundSuspiciousScripts = suspiciousScripts.filter(script =>
        packageInfo.scripts && packageInfo.scripts[script]
      );

      if (foundSuspiciousScripts.length > 0) {
        analysis.issues.push({
          type: 'suspicious_scripts',
          severity: 'medium',
          message: `Contains potentially suspicious scripts: ${foundSuspiciousScripts.join(', ')}`
        });
      }

      // Check for known vulnerable patterns
      await this.checkVulnerabilityPatterns(analysis, packageInfo);
    } else {
      analysis.status = 'missing';
      analysis.issues.push({
        type: 'missing_package',
        severity: 'high',
        message: 'Package not found in node_modules'
      });
    }

    return analysis;
  }

  /**
   * Check for vulnerability patterns in package
   */
  async checkVulnerabilityPatterns(analysis, packageInfo) {
    const patterns = [
      {
        name: 'eval_usage',
        pattern: /eval\s*\(/,
        severity: 'critical',
        files: ['*.js', '*.ts']
      },
      {
        name: 'function_constructor',
        pattern: /Function\s*\(/,
        severity: 'high',
        files: ['*.js', '*.ts']
      },
      {
        name: 'child_process',
        pattern: /child_process/,
        severity: 'medium',
        files: ['*.js', '*.ts']
      },
      {
        name: 'shell_execution',
        pattern: /exec\s*\(|execSync\s*\(/,
        severity: 'high',
        files: ['*.js', '*.ts']
      }
    ];

    // This is a simplified check - in production you'd want to scan actual files
    const codeContent = JSON.stringify(packageInfo);

    patterns.forEach(pattern => {
      if (pattern.pattern.test(codeContent)) {
        analysis.issues.push({
          type: pattern.name,
          severity: pattern.severity,
          message: `Potential security pattern detected: ${pattern.name}`
        });
      }
    });
  }

  /**
   * Apply custom analysis rules
   */
  async applyCustomRules(analysis) {
    for (const rule of this.config.customRules) {
      try {
        const violations = await this.applyCustomRule(rule, analysis);
        analysis.issues.push(...violations);
      } catch (error) {
        console.warn(`Custom rule ${rule.name} failed:`, error.message);
      }
    }
  }

  /**
   * Apply a single custom rule
   */
  async applyCustomRule(rule, analysis) {
    const violations = [];

    for (const [depName, depInfo] of Object.entries(analysis.dependencies.production)) {
      if (rule.condition && rule.condition(depInfo)) {
        violations.push({
          type: 'custom_rule',
          rule: rule.name,
          severity: rule.severity || 'medium',
          message: rule.message || `Custom rule violation for ${depName}`,
          dependency: depName
        });
      }
    }

    return violations;
  }

  /**
   * Check for outdated packages
   */
  async checkOutdatedPackages(dependencies) {
    // This would typically involve calling npm outdated or similar
    // For now, return placeholder data
    return {
      outdated: [],
      total: 0
    };
  }

  /**
   * Check package licenses
   */
  async checkLicenses(dependencies) {
    const allowedLicenses = [
      'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
      'ISC', 'Unlicense', 'CC0-1.0'
    ];

    const licenseIssues = [];

    for (const [type, deps] of Object.entries(dependencies)) {
      for (const [name, version] of Object.entries(deps)) {
        try {
          const packagePath = path.join(this.config.scanPath, 'node_modules', name, 'package.json');
          if (fs.existsSync(packagePath)) {
            const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            const license = packageInfo.license;

            if (!license) {
              licenseIssues.push({
                dependency: name,
                type: type,
                issue: 'no_license',
                severity: 'medium',
                message: 'No license specified'
              });
            } else if (!allowedLicenses.includes(license)) {
              licenseIssues.push({
                dependency: name,
                type: type,
                license,
                issue: 'restricted_license',
                severity: 'low',
                message: `License ${license} may have restrictions`
              });
            }
          }
        } catch (error) {
          // Skip if can't read package info
        }
      }
    }

    return {
      issues: licenseIssues,
      total: licenseIssues.length
    };
  }

  /**
   * Generate dependency report
   */
  generateReport(analysis) {
    const report = {
      summary: {
        totalDependencies: analysis.totalDependencies,
        totalIssues: analysis.issues.length,
        criticalIssues: analysis.issues.filter(i => i.severity === 'critical').length,
        highIssues: analysis.issues.filter(i => i.severity === 'high').length,
        mediumIssues: analysis.issues.filter(i => i.severity === 'medium').length,
        lowIssues: analysis.issues.filter(i => i.severity === 'low').length
      },
      dependencies: analysis.dependencies,
      issues: analysis.issues,
      outdated: analysis.outdated,
      licenses: analysis.licenses,
      recommendations: this.generateRecommendations(analysis)
    };

    return report;
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(analysis) {
    const recommendations = [];

    // Critical issues
    const criticalIssues = analysis.issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push({
        priority: 'critical',
        type: 'security',
        message: `Address ${criticalIssues.length} critical security issues immediately`,
        affectedDependencies: criticalIssues.map(i => i.dependency || i.name)
      });
    }

    // High issues
    const highIssues = analysis.issues.filter(i => i.severity === 'high');
    if (highIssues.length > 0) {
      recommendations.push({
        priority: 'high',
        type: 'security',
        message: `Review and fix ${highIssues.length} high-priority issues`,
        affectedDependencies: highIssues.map(i => i.dependency || i.name)
      });
    }

    // Deprecated packages
    const deprecatedIssues = analysis.issues.filter(i => i.type === 'deprecated');
    if (deprecatedIssues.length > 0) {
      recommendations.push({
        priority: 'medium',
        type: 'maintenance',
        message: `Replace ${deprecatedIssues.length} deprecated packages`,
        affectedDependencies: deprecatedIssues.map(i => i.dependency || i.name)
      });
    }

    // Missing packages
    const missingIssues = analysis.issues.filter(i => i.type === 'missing_package');
    if (missingIssues.length > 0) {
      recommendations.push({
        priority: 'high',
        type: 'installation',
        message: `Install ${missingIssues.length} missing packages`,
        affectedDependencies: missingIssues.map(i => i.dependency || i.name)
      });
    }

    return recommendations;
  }
}

module.exports = DependencyChecker;