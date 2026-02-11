/**
 * MCP Tool: comprehensive_package_audit
 * 
 * One-stop package/dependency audit that bundles:
 * - Package validation (typosquatting, existence, legitimacy)
 * - Version checking (outdated, deprecated, security vulnerabilities)
 * - Upgrade report generation (breaking changes, migration guides)
 * 
 * User just says "audit my dependencies" and gets everything.
 */

import { z } from 'zod';
import { handleValidatePackages } from './validate_packages.js';
import { handleCheckVersions } from './check-versions.js';
import { handleGenerateUpgradeReport } from './generate-upgrade-report.js';
import { logger } from '../utils/logger.js';

const ComprehensivePackageAuditInputSchema = z.object({
  packages: z.array(z.string()).describe('List of packages to audit'),
  registry: z.enum(['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem']).default('npm'),
  include_upgrade_reports: z.boolean().default(true).describe('Generate upgrade reports for outdated packages'),
  current_versions: z.record(z.string()).optional().describe('Map of package name to current version'),
});

export const comprehensivePackageAuditTool = {
  name: 'comprehensive_package_audit',
  description: 'Complete dependency audit in one call: validates packages exist and are safe, checks for outdated versions and vulnerabilities, generates upgrade reports with migration guides. Just provide package names.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true, // Makes network requests
  },
  inputSchema: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of packages to audit',
      },
      registry: {
        type: 'string',
        enum: ['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem'],
        description: 'Package registry (default: npm)',
      },
      include_upgrade_reports: {
        type: 'boolean',
        description: 'Generate upgrade reports for outdated packages (default: true)',
      },
      current_versions: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Map of package name to current version',
      },
    },
    required: ['packages'],
  },
};

export async function handleComprehensivePackageAudit(args: unknown) {
  try {
    const input = ComprehensivePackageAuditInputSchema.parse(args);
    
    logger.info(`Running comprehensive package audit for ${input.packages.length} packages`);
    
    const results: {
      safe: string[];
      suspicious: string[];
      outdated: string[];
      vulnerable: string[];
      upgrade_reports: Record<string, unknown>;
    } = {
      safe: [],
      suspicious: [],
      outdated: [],
      vulnerable: [],
      upgrade_reports: {},
    };

    // Step 1: Validate all packages exist and are legitimate
    const validationResult = await handleValidatePackages({ 
      packages: input.packages.map(pkg => ({ 
        name: pkg, 
        registry: input.registry 
      })),
    }) as Record<string, unknown>;

    if (validationResult.results && typeof validationResult.results === 'object') {
      const validationResults = validationResult.results as Record<string, { 
        valid: boolean; 
        suspicious?: boolean;
        reason?: string;
      }>;
      
      for (const [pkg, result] of Object.entries(validationResults)) {
        if (!result.valid) {
          results.suspicious.push(pkg);
        }
      }
    }

    // Step 2: Check versions for all packages
    const versionResult = await handleCheckVersions({
      packages: input.packages.map(p => ({
        name: p,
        currentVersion: input.current_versions?.[p],
      })),
      registry: input.registry,
    }) as Record<string, unknown>;

    if (Array.isArray(versionResult.results)) {
      for (const pkg of versionResult.results as Array<{
        package: string;
        isOutdated?: boolean;
        securityVulnerabilities?: unknown[];
      }>) {
        if (pkg.isOutdated) {
          results.outdated.push(pkg.package);
        }
        if (pkg.securityVulnerabilities && pkg.securityVulnerabilities.length > 0) {
          results.vulnerable.push(pkg.package);
        }
      }
    }

    // Step 3: Generate upgrade reports for outdated/vulnerable packages
    if (input.include_upgrade_reports) {
      const packagesToReport = [...new Set([...results.outdated, ...results.vulnerable])];
      
      for (const pkg of packagesToReport.slice(0, 5)) { // Limit to 5 to avoid timeout
        try {
          const report = await handleGenerateUpgradeReport({
            package_name: pkg,
            current_version: input.current_versions?.[pkg],
            registry: input.registry,
          });
          results.upgrade_reports[pkg] = report;
        } catch (err) {
          logger.warn(`Failed to generate upgrade report for ${pkg}:`, err);
        }
      }
    }

    // Determine safe packages
    const problematic = new Set([...results.suspicious, ...results.outdated, ...results.vulnerable]);
    results.safe = input.packages.filter(p => !problematic.has(p));

    // Calculate summary
    const recommendation = results.vulnerable.length > 0
      ? '🚨 SECURITY VULNERABILITIES - Update vulnerable packages immediately.'
      : results.suspicious.length > 0
      ? '⚠️ SUSPICIOUS PACKAGES - Review and verify before using.'
      : results.outdated.length > 0
      ? '📦 OUTDATED - Consider updating for latest features and fixes.'
      : '✅ All packages look good!';

    return {
      success: true,
      summary: {
        total_packages: input.packages.length,
        safe: results.safe.length,
        suspicious: results.suspicious.length,
        outdated: results.outdated.length,
        vulnerable: results.vulnerable.length,
        recommendation,
      },
      safe_packages: results.safe,
      suspicious_packages: results.suspicious,
      outdated_packages: results.outdated,
      vulnerable_packages: results.vulnerable,
      upgrade_reports: results.upgrade_reports,
    };
  } catch (error) {
    logger.error('Error in comprehensive_package_audit:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
