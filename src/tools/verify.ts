/**
 * MCP Tool: verify
 * 
 * Pre-delivery verification for AI-generated content.
 * Catches hallucinations, incorrect packages, bad code, and unsafe responses
 * BEFORE they reach the user.
 */

import { z } from 'zod';
import { AIErrorPreventer } from '../developer/evaluators/ai-error-preventer.js';
import { PackageBlocker } from '../developer/blockers/package-blocker.js';
import { PackageEvaluator } from '../developer/evaluators/package-evaluator.js';
import { EvaluationEngine, SessionContext, InterventionAction, RiskLevel } from '../governance/evaluationEngine.js';
import { logger } from '../utils/logger.js';

const VerifyInputSchema = z.object({
  type: z.enum(['code', 'packages', 'facts', 'response', 'all']).describe('What to verify'),
  content: z.string().describe('The AI-generated content to verify'),
  language: z.string().optional().describe('Programming language for code verification'),
  registry: z.enum(['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem']).optional().default('npm'),
  context: z.string().optional().describe('Additional context'),
  session_id: z.string().optional(),
});

export type VerifyInput = z.infer<typeof VerifyInputSchema>;

export const verifyTool = {
  definition: {
    name: 'verify',
    description: `CRITICAL: Pre-delivery verification for AI-generated content. Call BEFORE presenting code, package recommendations, or factual claims to users. Catches: hallucinated packages (24% of AI suggestions don't exist!), hallucinated APIs, incorrect imports, ESM/CJS confusion, deprecated methods, security vulnerabilities, inconsistencies with previous statements. Returns verification result with fixes if needed.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['code', 'packages', 'facts', 'response', 'all'],
          description: "What to verify: 'code' for syntax/APIs, 'packages' for npm/pypi existence, 'facts' for claims/statistics, 'response' for governance/tone, 'all' for comprehensive check",
        },
        content: {
          type: 'string',
          description: 'The AI-generated content to verify before presenting to user',
        },
        language: {
          type: 'string',
          description: 'Programming language for code verification',
        },
        registry: {
          type: 'string',
          enum: ['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem'],
          description: 'Package registry for package verification (default: npm)',
        },
        context: {
          type: 'string',
          description: "Additional context: user's original question, project type, etc.",
        },
      },
      required: ['type', 'content'],
    },
  },

  handler: handleVerify,
};

export async function handleVerify(args: unknown) {
  try {
    const input = VerifyInputSchema.parse(args);
    
    logger.info('Running verification check', { type: input.type });
    
    const results: VerificationResult = {
      verified: true,
      type: input.type,
      checks_run: [],
      issues: [],
      fixes: [],
      warnings: [],
      confidence: 1.0,
    };

    // Run appropriate checks based on type
    if (input.type === 'code' || input.type === 'all') {
      const codeResult = await verifyCode(input.content, input.language || 'typescript');
      results.checks_run.push('code');
      if (codeResult.issues.length > 0) {
        results.verified = false;
        results.issues.push(...codeResult.issues);
        results.fixes.push(...codeResult.fixes);
      }
      results.warnings.push(...codeResult.warnings);
      results.code_verification = codeResult;
    }

    if (input.type === 'packages' || input.type === 'all') {
      const packageResult = await verifyPackages(input.content, input.registry || 'npm');
      results.checks_run.push('packages');
      if (packageResult.invalid.length > 0) {
        results.verified = false;
        results.issues.push(...packageResult.invalid.map(p => `Package does not exist: ${p}`));
        results.fixes.push(...packageResult.suggestions);
      }
      results.package_verification = packageResult;
    }

    if (input.type === 'facts' || input.type === 'response' || input.type === 'all') {
      const governanceResult = await verifyResponse(input.content, input.session_id);
      results.checks_run.push('governance');
      if (governanceResult.action !== InterventionAction.APPROVE) {
        results.verified = false;
        results.issues.push(...governanceResult.issues);
        if (governanceResult.modified_content) {
          results.fixes.push(`Modified content: ${governanceResult.modified_content}`);
        }
      }
      results.confidence = Math.min(results.confidence, 1 - governanceResult.risk_score);
      results.governance_verification = governanceResult;
    }

    // Calculate overall confidence
    results.confidence = results.issues.length === 0 ? 1.0 : 
      Math.max(0.1, 1 - (results.issues.length * 0.15));

    return {
      success: true,
      ...results,
      summary: results.verified 
        ? `✓ Verified. ${results.checks_run.length} checks passed.`
        : `✗ Issues found. ${results.issues.length} problems detected in ${results.checks_run.join(', ')}.`,
      recommendation: results.verified 
        ? 'Safe to present to user.'
        : 'Review issues before presenting. Apply suggested fixes if available.',
    };
  } catch (error) {
    logger.error('Error in verify:', error);
    return {
      success: false,
      verified: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      recommendation: 'Verification failed. Do not present unverified content.',
    };
  }
}

// ============================================================
// CODE VERIFICATION
// ============================================================

interface CodeVerificationResult {
  issues: string[];
  fixes: string[];
  warnings: string[];
  ai_errors_found: number;
  build_context?: {
    language: string;
    module_system?: string;
    requires_js_extensions: boolean;
  };
  fixed_code?: string;
}

async function verifyCode(code: string, language: string): Promise<CodeVerificationResult> {
  const preventer = new AIErrorPreventer();
  const result = await preventer.preventErrors(code, language, {
    autoFix: true,
    checkBuildContext: true,
  });

  const issues: string[] = [];
  const fixes: string[] = [];
  const warnings: string[] = result.warnings || [];

  for (const error of result.errors) {
    issues.push(`[${error.pattern.impact.toUpperCase()}] ${error.pattern.name}: ${error.pattern.description}`);
    if (error.suggestion) {
      fixes.push(error.suggestion);
    }
  }

  return {
    issues,
    fixes,
    warnings,
    ai_errors_found: result.errors.length,
    build_context: result.buildContext ? {
      language: result.buildContext.language,
      module_system: result.buildContext.moduleSystem,
      requires_js_extensions: result.buildContext.requiresJsExtensions,
    } : undefined,
    fixed_code: result.fixedCode,
  };
}

// ============================================================
// PACKAGE VERIFICATION
// ============================================================

interface PackageVerificationResult {
  packages_checked: string[];
  valid: string[];
  invalid: string[];
  suggestions: string[];
  typosquatting_detected: string[];
  deprecated: string[];
}

async function verifyPackages(content: string, registry: string): Promise<PackageVerificationResult> {
  const blocker = new PackageBlocker(true);
  const evaluator = new PackageEvaluator();

  // Extract package names from content (code patterns first)
  let packages = extractPackageNames(content);

  // If no packages found via code patterns, treat content as direct package names
  // Handles bare names like "left-pad" or lists like "express, fastify, koa"
  if (packages.length === 0) {
    packages = parseDirectPackageNames(content);
  }

  // Determine language from registry
  const language = registry === 'npm' ? 'javascript' :
                   registry === 'pypi' ? 'python' :
                   registry === 'maven' ? 'java' : 'unknown';

  const result: PackageVerificationResult = {
    packages_checked: packages,
    valid: [],
    invalid: [],
    suggestions: [],
    typosquatting_detected: [],
    deprecated: [],
  };

  // If we have direct package names, validate each one individually
  // (bypasses interceptCode which only works with code patterns)
  if (packages.length > 0) {
    for (const pkg of packages) {
      try {
        const evalResult = await evaluator.evaluate(pkg, { language: language as 'javascript' | 'python' | 'java' | 'unknown' });
        if (evalResult.package.deprecated) {
          result.deprecated.push(pkg);
          result.suggestions.push(`Package "${pkg}" is deprecated. ${evalResult.warning || ''}`);
        } else if (!evalResult.blocked) {
          result.valid.push(pkg);
        } else {
          result.invalid.push(pkg);
          if (evalResult.warning) {
            result.suggestions.push(evalResult.warning);
          }
        }
      } catch (e) {
        result.suggestions.push(`Could not validate "${pkg}" - manual verification recommended`);
      }
    }
  } else {
    // Fallback: use interceptCode for content with no extractable packages
    const blockResult = await blocker.interceptCode(content, language as 'javascript' | 'python' | 'java' | 'unknown');

    if (!blockResult.allowed) {
      result.invalid.push(...blockResult.blockedPackages);
      result.suggestions.push(...blockResult.warnings);

      for (const [pkg, suggs] of Object.entries(blockResult.suggestions)) {
        if (suggs.length > 0) {
          result.suggestions.push(`For "${pkg}": ${suggs.join(', ')}`);
        }
      }
    }
  }

  return result;
}

function extractPackageNames(content: string): string[] {
  const packages: Set<string> = new Set();
  
  // npm install patterns
  const npmInstall = content.match(/npm\s+i(?:nstall)?\s+([^\n&|;]+)/gi);
  if (npmInstall) {
    for (const match of npmInstall) {
      const pkgs = match.replace(/npm\s+i(?:nstall)?\s+/i, '').split(/\s+/);
      pkgs.forEach(p => {
        if (p && !p.startsWith('-')) {
          packages.add(p.replace(/@[\d.]+$/, '')); // Remove version
        }
      });
    }
  }

  // import/require patterns
  const imports = content.match(/(?:import|require)\s*\(?['"]([^'"./][^'"]*)['"]\)?/g);
  if (imports) {
    for (const match of imports) {
      const pkg = match.match(/['"]([^'"./][^'"]*)['"]/)?.[1];
      if (pkg) {
        // Get base package name (handle scoped packages)
        const basePkg = pkg.startsWith('@') 
          ? pkg.split('/').slice(0, 2).join('/')
          : pkg.split('/')[0];
        if (basePkg) {
          packages.add(basePkg);
        }
      }
    }
  }

  // pip install patterns
  const pipInstall = content.match(/pip\s+install\s+([^\n&|;]+)/gi);
  if (pipInstall) {
    for (const match of pipInstall) {
      const pkgs = match.replace(/pip\s+install\s+/i, '').split(/\s+/);
      pkgs.forEach(p => {
        if (p && !p.startsWith('-')) {
          packages.add(p.replace(/[=<>].*$/, '')); // Remove version constraints
        }
      });
    }
  }

  return Array.from(packages);
}

/**
 * Parse content as direct package names when no code patterns are found.
 * Handles: "left-pad", "express, fastify, koa", "express fastify koa",
 * "express\nfastify\nkoa", and scoped packages like "@babel/core".
 */
function parseDirectPackageNames(content: string): string[] {
  const packages: Set<string> = new Set();

  // Split on commas, whitespace, or newlines
  const candidates = content.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);

  // Valid package name pattern (npm-style, also covers pypi/cargo/etc.)
  const validPkgPattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

  for (const candidate of candidates) {
    // Strip version suffixes like @1.2.3, ==1.0, >=2.0
    // For scoped packages (@scope/pkg@1.0), only strip the version @, not the leading scope @
    let cleaned = candidate;
    if (cleaned.startsWith('@')) {
      // Scoped package: strip version after the package name portion
      cleaned = cleaned.replace(/(@[^/]+\/[^@]+)@[\d].*$/, '$1');
    } else {
      cleaned = cleaned.replace(/[@=<>^~][\d].*$/, '');
    }
    // Also strip ==, >=, <= version operators for pypi-style
    cleaned = cleaned.replace(/[=<>^~]+[\d].*$/, '');
    if (cleaned && validPkgPattern.test(cleaned)) {
      packages.add(cleaned);
    }
  }

  return Array.from(packages);
}

// ============================================================
// RESPONSE/GOVERNANCE VERIFICATION
// ============================================================

interface GovernanceVerificationResult {
  action: InterventionAction;
  risk_level: RiskLevel;
  risk_score: number;
  issues: string[];
  hallucination_detected: boolean;
  inconsistency_detected: boolean;
  tone_drift_detected: boolean;
  unsafe_reasoning_detected: boolean;
  modified_content?: string;
}

async function verifyResponse(content: string, sessionId?: string): Promise<GovernanceVerificationResult> {
  const engine = new EvaluationEngine();
  
  const context: SessionContext = {
    sessionId: sessionId || 'verification-check',
  };

  const evaluation = await engine.evaluate(content, context);

  const issues: string[] = [];
  
  if (evaluation.hallucination.detected) {
    issues.push(`Potential hallucination detected (${Math.round(evaluation.hallucination.confidence * 100)}% confidence)`);
    if (evaluation.hallucination.patterns) {
      issues.push(...evaluation.hallucination.patterns.map(p => `  - ${p}`));
    }
  }

  if (evaluation.inconsistency.detected) {
    issues.push(`Inconsistency with previous statements detected (${Math.round(evaluation.inconsistency.confidence * 100)}% confidence)`);
  }

  if (evaluation.toneDrift.detected) {
    issues.push(`Tone drift detected (${Math.round(evaluation.toneDrift.confidence * 100)}% confidence)`);
    if (evaluation.toneDrift.patterns) {
      issues.push(...evaluation.toneDrift.patterns.map(p => `  - ${p}`));
    }
  }

  if (evaluation.unsafeReasoning.detected) {
    issues.push(`Unsafe reasoning pattern detected (${Math.round(evaluation.unsafeReasoning.confidence * 100)}% confidence)`);
    if (evaluation.unsafeReasoning.patterns) {
      issues.push(...evaluation.unsafeReasoning.patterns.map(p => `  - ${p}`));
    }
  }

  // Calculate risk score
  const riskScores: Record<RiskLevel, number> = {
    [RiskLevel.NONE]: 0,
    [RiskLevel.LOW]: 0.25,
    [RiskLevel.MEDIUM]: 0.5,
    [RiskLevel.HIGH]: 0.75,
    [RiskLevel.CRITICAL]: 1.0,
  };

  return {
    action: evaluation.recommendedAction,
    risk_level: evaluation.overallRisk,
    risk_score: riskScores[evaluation.overallRisk],
    issues,
    hallucination_detected: evaluation.hallucination.detected,
    inconsistency_detected: evaluation.inconsistency.detected,
    tone_drift_detected: evaluation.toneDrift.detected,
    unsafe_reasoning_detected: evaluation.unsafeReasoning.detected,
  };
}

// ============================================================
// TYPES
// ============================================================

interface VerificationResult {
  verified: boolean;
  type: string;
  checks_run: string[];
  issues: string[];
  fixes: string[];
  warnings: string[];
  confidence: number;
  code_verification?: CodeVerificationResult;
  package_verification?: PackageVerificationResult;
  governance_verification?: GovernanceVerificationResult;
}
