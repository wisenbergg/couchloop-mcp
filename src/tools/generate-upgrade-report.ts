/**
 * MCP Tool: generate_upgrade_report
 * 
 * Generates comprehensive upgrade reports with migration guides, breaking changes,
 * and rollback strategies for updating dependencies.
 */

import { z } from 'zod';
import { DependencyUpdater } from '../developer/updaters/dependency-updater.js';
import { VersionChecker } from '../developer/validators/version-checker.js';
import { logger } from '../utils/logger.js';

const GenerateUpgradeReportInputSchema = z.object({
  package_name: z.string().describe('Package name to upgrade'),
  current_version: z.string().optional().describe('Current version (auto-detected if not provided)'),
  target_version: z.string().optional().describe('Target version (latest if not specified)'),
  registry: z.enum(['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem']).default('npm').describe('Package registry'),
});

export const generateUpgradeReportTool = {
  name: 'generate_upgrade_report',
  description: 'Generates comprehensive upgrade reports for dependencies: breaking changes, migration steps, code changes needed, testing strategy, and rollback commands. Essential before major version upgrades.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true, // Makes network requests
  },
  inputSchema: {
    type: 'object',
    properties: {
      package_name: {
        type: 'string',
        description: 'Package name to upgrade',
      },
      current_version: {
        type: 'string',
        description: 'Current version (auto-detected if not provided)',
      },
      target_version: {
        type: 'string',
        description: 'Target version (latest if not specified)',
      },
      registry: {
        type: 'string',
        enum: ['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem'],
        description: 'Package registry (default: npm)',
      },
    },
    required: ['package_name'],
  },
};

export async function handleGenerateUpgradeReport(args: unknown) {
  try {
    const input = GenerateUpgradeReportInputSchema.parse(args);
    
    logger.info(`Generating upgrade report for ${input.package_name}`);
    
    // First, get version info from the checker
    const versionChecker = new VersionChecker();
    const versionInfo = await versionChecker.checkVersion(
      input.package_name,
      input.current_version,
      input.registry
    );

    if (!versionInfo.latestVersion) {
      return {
        success: false,
        error: `Could not find version info for ${input.package_name} in ${input.registry} registry`,
      };
    }

    // Generate the upgrade report
    const updater = new DependencyUpdater();
    const report = updater.generateUpgradeReport(versionInfo, input.current_version);

    return {
      success: true,
      package: report.packageName,
      from_version: report.fromVersion,
      to_version: report.toVersion,
      complexity: report.complexity,
      estimated_time: report.estimatedTime,
      upgrade_command: report.upgradeCommand,
      install_command: report.installCommand,
      breaking_changes: report.breakingChanges,
      deprecations: report.deprecations,
      migration_steps: report.migrationSteps.map(step => ({
        step: step.step,
        title: step.title,
        description: step.description,
        commands: step.commands,
        code_changes: step.codeChanges,
        verification: step.verification,
      })),
      testing_strategy: report.testingStrategy,
      rollback_strategy: report.rollbackStrategy,
      risks: {
        level: report.risks.level,
        factors: report.risks.factors,
        mitigations: report.risks.mitigations,
      },
      resources: report.resources,
    };
  } catch (error) {
    logger.error('Error in generate_upgrade_report:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
