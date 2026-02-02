/**
 * MCP Tool: check_versions
 * Validates library versions against latest and detects deprecated APIs
 * Prevents AI from using old patterns and outdated library syntax
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { VersionChecker, DeprecatedAPIPattern } from '../developer/validators/version-checker.js';
import { DependencyUpdater, RiskAssessment, MigrationResource } from '../developer/updaters/dependency-updater.js';
import { logger } from '../utils/logger.js';

// Type definitions for check-versions
interface SecurityVulnerability {
  severity: string;
  description: string;
  fixedIn?: string;
  cve?: string;
}

interface UpgradeReportSimplified {
  upgradeCommand: string;
  installCommand: string;
  complexity: string;
  estimatedTime: string;
  breakingChanges: Array<{ description: string }>;
  risks: RiskAssessment;
  testingStrategy: string[];
}

interface PackageResult {
  name: string;
  currentVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  isDeprecated: boolean;
  updateComplexity: string;
  majorVersionsBehind?: number;
  minorVersionsBehind?: number;
  securityVulnerabilities?: SecurityVulnerability[];
  upgradeReport?: UpgradeReportSimplified;
  resources?: MigrationResource[];
}

interface VersionCheckResult {
  status: string;
  timestamp: string;
  packages?: PackageResult[];
  deprecatedAPIs?: DeprecatedAPIPattern[];
  apiWarnings?: string[];
  summary?: VersionCheckSummary;
  code?: string;
}

interface VersionCheckSummary {
  checksPerformed: string[];
}

const CheckVersionsInputSchema = z.object({
  packages: z.array(
    z.object({
      name: z.string().describe('Package name'),
      version: z.string().optional().describe('Current version (optional)'),
      registry: z.enum(['npm', 'pypi', 'maven', 'cargo', 'gem', 'nuget', 'go']).optional()
        .describe('Package registry (auto-detected if omitted)')
    })
  ).optional().describe('Array of packages to check'),
  code: z.string().optional().describe('Code snippet to scan for deprecated APIs'),
  language: z.string().optional().describe('Programming language for code scan'),
  checkDeprecated: z.boolean().default(true).describe('Check for deprecated API patterns'),
  includeUpgradePath: z.boolean().default(false).describe('Include upgrade recommendations'),
  checkSecurity: z.boolean().default(true).describe('Check for security vulnerabilities'),
  format: z.enum(['json', 'markdown', 'summary']).default('json')
    .describe('Output format')
});

export type CheckVersionsInput = z.infer<typeof CheckVersionsInputSchema>;

export const checkVersionsTool: Tool = {
  name: 'check_versions',
  description: 'Validate library versions against latest releases, detect deprecated APIs, and prevent AI from using outdated patterns. Checks for breaking changes, security vulnerabilities, and provides upgrade paths.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Package name' },
            version: { type: 'string', description: 'Current version (optional)' },
            registry: {
              type: 'string',
              enum: ['npm', 'pypi', 'maven', 'cargo', 'gem', 'nuget', 'go'],
              description: 'Package registry'
            }
          },
          required: ['name']
        },
        description: 'Array of packages to check versions for'
      },
      code: {
        type: 'string',
        description: 'Code snippet to scan for deprecated API patterns'
      },
      language: {
        type: 'string',
        description: 'Programming language (javascript, python, java, go, rust, etc.)'
      },
      checkDeprecated: {
        type: 'boolean',
        default: true,
        description: 'Scan code for deprecated API patterns'
      },
      includeUpgradePath: {
        type: 'boolean',
        default: false,
        description: 'Include detailed upgrade recommendations and migration paths'
      },
      checkSecurity: {
        type: 'boolean',
        default: true,
        description: 'Check for known security vulnerabilities'
      },
      format: {
        type: 'string',
        enum: ['json', 'markdown', 'summary'],
        default: 'json',
        description: 'Output format (json, markdown, or summary)'
      }
    }
  }
};

export async function handleCheckVersions(input: unknown): Promise<object> {
  try {
    const params = CheckVersionsInputSchema.parse(input);

    logger.debug(`Version check: ${params.packages?.length || 0} packages, code scan: ${!!params.code}`);

    const versionChecker = new VersionChecker();
    const dependencyUpdater = new DependencyUpdater();

    const result: VersionCheckResult = {
      status: 'success',
      timestamp: new Date().toISOString()
    };

    // Check package versions
    if (params.packages && params.packages.length > 0) {
      result.packages = await checkPackageVersions(
        params.packages,
        versionChecker,
        dependencyUpdater,
        params.includeUpgradePath,
        params.checkSecurity
      );
    }

    // Scan code for deprecated APIs
    if (params.code && params.checkDeprecated) {
      result.deprecatedAPIs = versionChecker.detectDeprecatedAPIs(
        params.code,
        params.language || 'unknown'
      );

      if (result.deprecatedAPIs && result.deprecatedAPIs.length > 0) {
        result.apiWarnings = generateAPIWarnings(result.deprecatedAPIs);
      }
    }

    // Generate summary
    result.summary = generateSummary(result);

    // Format output
    if (params.format === 'markdown') {
      return {
        status: 'success',
        format: 'markdown',
        content: formatAsMarkdown(result),
        raw: result
      };
    }

    if (params.format === 'summary') {
      return {
        status: 'success',
        format: 'summary',
        summary: result.summary,
        outdatedCount: result.packages?.filter((p: PackageResult) => p.isOutdated).length || 0,
        vulnerabilityCount: result.packages?.reduce((sum: number, p: PackageResult) =>
          sum + (p.securityVulnerabilities?.length || 0), 0) || 0,
        deprecatedAPICount: result.deprecatedAPIs?.length || 0,
        actionItems: generateActionItems(result)
      };
    }

    // Default JSON format
    return result;

  } catch (error) {
    logger.error('Version check error:', error);

    if (error instanceof z.ZodError) {
      return {
        status: 'error',
        error: 'Validation error',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      };
    }

    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to check versions'
    };
  }
}

/**
 * Check versions for multiple packages
 */
async function checkPackageVersions(
  packages: Array<{ name: string; version?: string; registry?: string }>,
  versionChecker: VersionChecker,
  dependencyUpdater: DependencyUpdater,
  includeUpgradePath: boolean,
  checkSecurity: boolean
): Promise<PackageResult[]> {
  const results = await Promise.all(
    packages.map(async (pkg) => {
      const versionInfo = await versionChecker.checkVersion(
        pkg.name,
        pkg.version,
        pkg.registry as 'npm' | 'pypi' | 'maven' | 'cargo' | 'gem' | 'nuget' | 'go' | undefined
      );

      const result: PackageResult = {
        name: pkg.name,
        currentVersion: pkg.version || 'unknown',
        latestVersion: versionInfo.latestVersion || 'unknown',
        isOutdated: versionInfo.isOutdated,
        isDeprecated: versionInfo.isDeprecated,
        updateComplexity: versionInfo.updateComplexity,
        majorVersionsBehind: versionInfo.majorVersionsBehind,
        minorVersionsBehind: versionInfo.minorVersionsBehind
      };

      // Add security info
      if (checkSecurity && versionInfo.securityVulnerabilities.length > 0) {
        result.securityVulnerabilities = versionInfo.securityVulnerabilities.map(v => ({
          severity: v.severity,
          description: v.description,
          fixedIn: v.fixedIn,
          cve: v.cve
        }));
      }

      // Add upgrade path
      if (includeUpgradePath && versionInfo.isOutdated) {
        const upgradeReport = dependencyUpdater.generateUpgradeReport(versionInfo, pkg.version);

        result.upgradeReport = {
          upgradeCommand: upgradeReport.upgradeCommand,
          installCommand: upgradeReport.installCommand,
          complexity: upgradeReport.complexity,
          estimatedTime: upgradeReport.estimatedTime,
          breakingChanges: upgradeReport.breakingChanges.slice(0, 3), // Limit to 3
          risks: upgradeReport.risks,
          testingStrategy: upgradeReport.testingStrategy.slice(0, 5) // Limit to 5
        };

        if (upgradeReport.resources.length > 0) {
          result.resources = upgradeReport.resources.slice(0, 3); // Limit to 3
        }
      }

      return result;
    })
  );

  return results;
}

/**
 * Generate warnings for deprecated APIs
 */
function generateAPIWarnings(apis: DeprecatedAPIPattern[]): string[] {
  return apis.map(api => {
    return `DEPRECATED: ${api.pattern} (deprecated in ${api.deprecatedSince})
    → Use: ${api.replacement}
    → Reason: ${api.reason}`;
  });
}

/**
 * Generate summary of version checks
 */
function generateSummary(result: VersionCheckResult): VersionCheckSummary {
  const summary: VersionCheckSummary = {
    checksPerformed: []
  };

  if (result.packages) {
    const outdated = result.packages.filter((p: PackageResult) => p.isOutdated).length;
    const deprecated = result.packages.filter((p: PackageResult) => p.isDeprecated).length;
    const vulnerable = result.packages.filter((p: PackageResult) => (p.securityVulnerabilities?.length ?? 0) > 0).length;

    summary.checksPerformed.push(`Package version check (${result.packages.length} packages)`);

    if (outdated > 0) {
      summary.checksPerformed.push(`Found ${outdated} outdated package(s)`);
    }

    if (deprecated > 0) {
      summary.checksPerformed.push(`Found ${deprecated} deprecated package(s)`);
    }

    if (vulnerable > 0) {
      summary.checksPerformed.push(`Found ${vulnerable} package(s) with security vulnerabilities`);
    }

    if (outdated === 0 && deprecated === 0 && vulnerable === 0) {
      summary.checksPerformed.push('All packages are current and secure');
    }
  }

  if ((result.deprecatedAPIs?.length ?? 0) > 0) {
    summary.checksPerformed.push(`API scan (found ${result.deprecatedAPIs!.length} deprecated patterns)`);
  }

  if (result.code && !(result.deprecatedAPIs?.length)) {
    summary.checksPerformed.push('Code scan completed (no deprecated patterns found)');
  }

  return summary;
}

/**
 * Format result as markdown
 */
function formatAsMarkdown(result: VersionCheckResult): string {
  let md = '# Version Check Report\n\n';
  md += `Generated: ${result.timestamp}\n\n`;

  // Packages section
  if ((result.packages?.length ?? 0) > 0) {
    md += '## Package Updates\n\n';

    for (const pkg of result.packages!) {
      const status = pkg.isOutdated ? '🔴 OUTDATED' : pkg.isDeprecated ? '🟡 DEPRECATED' : '✅ CURRENT';
      md += `### ${pkg.name} ${status}\n`;
      md += `- Current: ${pkg.currentVersion}\n`;
      md += `- Latest: ${pkg.latestVersion}\n`;

      if (pkg.majorVersionsBehind) {
        md += `- Behind: ${pkg.majorVersionsBehind} major version(s)\n`;
      }

      if ((pkg.securityVulnerabilities?.length ?? 0) > 0) {
        md += `- **Security Issues**: ${pkg.securityVulnerabilities!.length}\n`;
        for (const vuln of pkg.securityVulnerabilities!.slice(0, 2)) {
          md += `  - [${vuln.severity.toUpperCase()}] ${vuln.description}\n`;
        }
      }

      if (pkg.upgradeReport) {
        md += `\n#### Update Instructions\n`;
        md += `\`\`\`bash\n${pkg.upgradeReport.upgradeCommand}\n\`\`\`\n`;
        md += `- Complexity: ${pkg.upgradeReport.complexity}\n`;
        md += `- Estimated time: ${pkg.upgradeReport.estimatedTime}\n`;

        if (pkg.upgradeReport.breakingChanges?.length > 0) {
          md += `\n**Breaking Changes**:\n`;
          for (const change of pkg.upgradeReport.breakingChanges.slice(0, 2)) {
            md += `- ${change.description}\n`;
          }
        }
      }

      md += '\n';
    }
  }

  // Deprecated APIs section
  if ((result.deprecatedAPIs?.length ?? 0) > 0) {
    md += '## Deprecated API Patterns Detected\\n\\n';

    for (const api of result.deprecatedAPIs!) {
      md += `### ${api.pattern}\\n`;
      md += `- Library: ${api.library}\\n`;
      md += `- Deprecated: ${api.deprecatedSince}\\n`;
      md += `- Reason: ${api.reason}\\n`;
      md += `- Use instead: \`${api.replacement}\`\\n\\n`;
    }
  }

  // Summary section
  if ((result.summary?.checksPerformed?.length ?? 0) > 0) {
    md += '## Summary\n\n';
    for (const item of result.summary!.checksPerformed) {
      md += `- ${item}\n`;
    }
  }

  return md;
}

/**
 * Generate action items
 */
function generateActionItems(result: VersionCheckResult): string[] {
  const items: string[] = [];

  if (result.packages) {
    const critical = result.packages.filter((p: PackageResult) =>
      p.securityVulnerabilities?.some((v: SecurityVulnerability) => v.severity === 'critical')
    );

    if (critical.length > 0) {
      items.push(`CRITICAL: Update ${critical.map((p: PackageResult) => p.name).join(', ')} immediately for security`);
    }

    const outdated = result.packages.filter((p: PackageResult) => p.isOutdated && !p.securityVulnerabilities?.length);
    if (outdated.length > 0) {
      items.push(`Update ${outdated.length} outdated package(s) to latest versions`);
    }

    const deprecated = result.packages.filter((p: PackageResult) => p.isDeprecated);
    if (deprecated.length > 0) {
      items.push(`Plan migration away from ${deprecated.length} deprecated package(s)`);
    }
  }

  if ((result.deprecatedAPIs?.length ?? 0) > 0) {
    items.push(`Remove ${result.deprecatedAPIs!.length} deprecated API pattern(s) from code`);
  }

  if (items.length === 0) {
    items.push('All packages are current and code uses modern patterns');
  }

  return items;
}

export function createCheckVersionsTool() {
  return {
    definition: checkVersionsTool,
    handler: handleCheckVersions
  };
}
