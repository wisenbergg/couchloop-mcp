/**
 * Governance Middleware for MCP Tool Calls
 * 
 * Automatically runs safety checks on tool inputs/outputs
 * without requiring the AI to explicitly call governance tools.
 */

import { logger } from '../utils/logger.js';

interface GovernanceConfig {
  enabled: boolean;
  mode: 'enforce' | 'shadow' | 'log-only';
  preChecks: {
    validatePackages: boolean;
    scanSecurity: boolean;
  };
  postChecks: {
    preReviewCode: boolean;
    detectCodeSmell: boolean;
  };
}

const defaultConfig: GovernanceConfig = {
  enabled: true,
  mode: 'shadow', // Start in shadow mode (log but don't block)
  preChecks: {
    validatePackages: true,
    scanSecurity: true,
  },
  postChecks: {
    preReviewCode: true,
    detectCodeSmell: false,
  },
};

// Tools that should trigger automatic governance checks
const CODE_GENERATION_TOOLS = [
  'run_in_terminal',
  'create_file',
  'replace_string_in_file',
  'edit_notebook_file',
];

const PACKAGE_RELATED_TOOLS = [
  'run_in_terminal', // Could be npm install, pip install, etc.
];

interface GovernanceResult {
  allowed: boolean;
  issues: string[];
  modified?: unknown;
  confidence: number;
}

/**
 * Pre-check hook - runs before tool execution
 */
export async function governancePreCheck(
  toolName: string,
  args: Record<string, unknown>,
  config: GovernanceConfig = defaultConfig
): Promise<GovernanceResult> {
  if (!config.enabled) {
    return { allowed: true, issues: [], confidence: 1.0 };
  }

  const issues: string[] = [];
  let confidence = 1.0;

  // Check for package-related commands
  if (config.preChecks.validatePackages && PACKAGE_RELATED_TOOLS.includes(toolName)) {
    const command = args.command as string;
    if (command && isPackageCommand(command)) {
      const packageIssues = await checkPackages(command);
      issues.push(...packageIssues);
      if (packageIssues.length > 0) confidence = 0.5;
    }
  }

  // Check for security issues in code
  if (config.preChecks.scanSecurity && args.content) {
    const securityIssues = await scanForSecurityIssues(args.content as string);
    issues.push(...securityIssues);
    if (securityIssues.length > 0) confidence = 0.3;
  }

  const allowed = config.mode === 'log-only' || issues.length === 0;
  
  if (issues.length > 0) {
    logger.warn(`[Governance] Pre-check issues for ${toolName}:`, issues);
  }

  return { allowed, issues, confidence };
}

/**
 * Post-check hook - runs after tool execution, before returning result
 */
export async function governancePostCheck(
  toolName: string,
  result: unknown,
  config: GovernanceConfig = defaultConfig
): Promise<GovernanceResult> {
  if (!config.enabled) {
    return { allowed: true, issues: [], confidence: 1.0, modified: result };
  }

  const issues: string[] = [];
  let confidence = 1.0;

  // Check generated code quality
  if (config.postChecks.preReviewCode && CODE_GENERATION_TOOLS.includes(toolName)) {
    const codeIssues = await preReviewCode(result);
    issues.push(...codeIssues);
    if (codeIssues.length > 0) confidence = 0.7;
  }

  const allowed = config.mode === 'log-only' || issues.length === 0;
  
  if (issues.length > 0) {
    logger.warn(`[Governance] Post-check issues for ${toolName}:`, issues);
  }

  return { allowed, issues, confidence, modified: result };
}

// Helper functions (simplified - would call actual tools in production)

function isPackageCommand(command: string): boolean {
  const packagePatterns = [
    /npm\s+(install|i|add)/i,
    /yarn\s+add/i,
    /pnpm\s+(add|install)/i,
    /pip\s+install/i,
    /cargo\s+add/i,
    /gem\s+install/i,
    /go\s+get/i,
  ];
  return packagePatterns.some(p => p.test(command));
}

async function checkPackages(command: string): Promise<string[]> {
  const issues: string[] = [];
  
  // Extract package names from command
  const npmMatch = command.match(/npm\s+(?:install|i|add)\s+([^\s]+)/i);
  if (npmMatch) {
    const pkg = npmMatch[1];
    // Quick typosquat check
    const suspicious = ['lodas', 'expresss', 'reacct', 'axois'];
    if (suspicious.some(s => pkg?.includes(s))) {
      issues.push(`Suspicious package name: ${pkg} (possible typosquat)`);
    }
  }
  
  return issues;
}

async function scanForSecurityIssues(code: string): Promise<string[]> {
  const issues: string[] = [];
  
  // Quick security pattern checks
  const patterns = [
    { pattern: /eval\s*\(/i, issue: 'Dangerous eval() usage' },
    { pattern: /innerHTML\s*=/i, issue: 'Potential XSS via innerHTML' },
    { pattern: /password\s*=\s*['"][^'"]+['"]/i, issue: 'Hardcoded password detected' },
    { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, issue: 'Hardcoded API key detected' },
  ];
  
  for (const { pattern, issue } of patterns) {
    if (pattern.test(code)) {
      issues.push(issue);
    }
  }
  
  return issues;
}

async function preReviewCode(result: unknown): Promise<string[]> {
  const issues: string[] = [];
  
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  
  // Quick code quality checks
  if (/console\.log/.test(text) && !/\/\/.*debug/i.test(text)) {
    issues.push('Contains console.log without debug comment');
  }
  if (/TODO|FIXME|HACK/i.test(text)) {
    issues.push('Contains TODO/FIXME markers');
  }
  if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/i.test(text)) {
    issues.push('Empty catch block - swallowed error');
  }
  
  return issues;
}

/**
 * Wrap a tool handler with governance middleware
 */
export function withGovernance<T>(
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<T>,
  config?: GovernanceConfig
): (args: Record<string, unknown>) => Promise<T> {
  return async (args: Record<string, unknown>) => {
    const cfg = config || defaultConfig;
    
    // Pre-check
    const preResult = await governancePreCheck(toolName, args, cfg);
    if (!preResult.allowed && cfg.mode === 'enforce') {
      throw new Error(`Governance blocked: ${preResult.issues.join(', ')}`);
    }
    
    // Execute original handler
    const result = await handler(args);
    
    // Post-check
    const postResult = await governancePostCheck(toolName, result, cfg);
    if (!postResult.allowed && cfg.mode === 'enforce') {
      throw new Error(`Governance blocked output: ${postResult.issues.join(', ')}`);
    }
    
    return (postResult.modified as T) || result;
  };
}

export default { governancePreCheck, governancePostCheck, withGovernance };
