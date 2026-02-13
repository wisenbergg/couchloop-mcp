/**
 * MCP Tool: validate_packages
 * Validates package dependencies and prevents hallucinated packages
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PackageBlocker } from '../developer/blockers/package-blocker.js';
import { PackageEvaluator } from '../developer/evaluators/package-evaluator.js';
import { logger } from '../utils/logger.js';

const inputSchema = z.object({
  code: z.string().optional().describe('Code snippet containing package imports/requires'),
  command: z.string().optional().describe('Package manager command (npm install, pip install, etc.)'),
  packages: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    registry: z.enum(['npm', 'pypi', 'maven']).optional()
  })).optional().describe('Array of packages to validate'),
  language: z.enum(['javascript', 'typescript', 'python', 'java', 'unknown']).default('unknown'),
  autoFix: z.boolean().default(true).describe('Automatically fix package names when possible')
});

export const validatePackagesTool: Tool = {
  name: 'validate_packages',
  description: 'Validate package dependencies to prevent installation of non-existent or malicious packages',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code snippet containing package imports/requires'
      },
      command: {
        type: 'string',
        description: 'Package manager command (npm install, pip install, etc.)'
      },
      packages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Package name to validate' },
            version: { type: 'string', description: 'Specific version to check (optional)' },
            registry: {
              type: 'string',
              enum: ['npm', 'pypi', 'maven'],
              description: 'Package registry (npm, pypi, or maven)'
            }
          },
          required: ['name']
        },
        description: 'Array of packages to validate'
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'python', 'java', 'unknown'],
        default: 'unknown',
        description: 'Programming language of the code being validated'
      },
      autoFix: {
        type: 'boolean',
        default: true,
        description: 'Automatically fix package names when possible'
      }
    }
  }
};

export async function handleValidatePackages(input: unknown): Promise<object> {
  try {
    const params = inputSchema.parse(input);
    const blocker = new PackageBlocker(params.autoFix);
    const evaluator = new PackageEvaluator();

    // Handle code validation
    if (params.code) {
      const result = await blocker.interceptCode(params.code, params.language);

      return {
        type: 'code_validation',
        allowed: result.allowed,
        blockedPackages: result.blockedPackages,
        warnings: result.warnings,
        suggestions: result.suggestions,
        modifiedCode: result.modified,
        summary: generateSummary(result.blockedPackages, result.warnings)
      };
    }

    // Handle command validation
    if (params.command) {
      const result = await blocker.interceptCommand(params.command);

      return {
        type: 'command_validation',
        allowed: result.allowed,
        blockedPackages: result.blockedPackages,
        warnings: result.warnings,
        suggestions: result.suggestions,
        modifiedCommand: result.modified,
        summary: generateSummary(result.blockedPackages, result.warnings)
      };
    }

    // Handle direct package list validation
    if (params.packages && params.packages.length > 0) {
      const results = await Promise.all(
        params.packages.map(async (pkg) => {
          const evaluation = await evaluator.evaluate(
            pkg.name,
            { language: params.language },
            pkg.version
          );

          return {
            package: pkg.name,
            version: pkg.version,
            exists: evaluation.package.exists,
            blocked: evaluation.blocked,
            reason: evaluation.reason,
            warnings: evaluation.warning,
            suggestions: evaluation.suggestions,
            latestVersion: evaluation.package.latestVersion,
            deprecated: evaluation.package.deprecated,
            securityIssues: evaluation.package.securityIssues
          };
        })
      );

      const blockedCount = results.filter(r => r.blocked).length;
      const warningCount = results.filter(r => r.warnings).length;

      return {
        type: 'package_validation',
        packages: results,
        summary: {
          total: results.length,
          valid: results.filter(r => r.exists && !r.blocked).length,
          blocked: blockedCount,
          warnings: warningCount,
          message: blockedCount > 0
            ? `⚠️ ${blockedCount} package(s) blocked - they don't exist or have issues`
            : warningCount > 0
            ? `✓ All packages exist but ${warningCount} have warnings`
            : '✅ All packages validated successfully'
        }
      };
    }

    return {
      error: 'No input provided. Please provide code, command, or packages to validate.'
    };

  } catch (error) {
    logger.error('Package validation error:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to validate packages'
    };
  }
}

function generateSummary(blockedPackages: string[], warnings: string[]): object {
  if (blockedPackages.length === 0 && warnings.length === 0) {
    return {
      status: 'success',
      message: '✅ All packages validated successfully'
    };
  }

  if (blockedPackages.length > 0) {
    return {
      status: 'blocked',
      message: `❌ Blocked ${blockedPackages.length} non-existent/malicious package(s)`,
      details: `Prevented installation of: ${blockedPackages.join(', ')}`
    };
  }

  return {
    status: 'warning',
    message: `⚠️ ${warnings.length} warning(s) found`,
    details: warnings[0] // Show first warning
  };
}