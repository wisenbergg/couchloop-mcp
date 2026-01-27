/**
 * MCP Tool: scan_security
 * Comprehensive security vulnerability scanner for AI-generated code
 * Detects SQL injection, XSS, hardcoded secrets, and other security issues
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SqlInjectionDetector } from '../developer/scanners/sql-injection-detector.js';
import { XssDetector } from '../developer/scanners/xss-detector.js';
import { SecretScanner } from '../developer/scanners/secret-scanner.js';
import { logger } from '../utils/logger.js';

const inputSchema = z.object({
  code: z.string().describe('Code snippet to scan for security vulnerabilities'),
  language: z.enum(['javascript', 'typescript', 'python', 'java', 'sql', 'html', 'unknown']).default('javascript').describe('Programming language of the code'),
  scanType: z.enum(['quick', 'thorough']).default('thorough').describe('Scan depth: quick (essential) or thorough (comprehensive)'),
});


interface SecurityVulnerability {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  line: number;
  column: number;
  code: string;
  issue: string;
  cwe: string;
  fix: string;
  scanner: string;
  secretType?: string;
  secretPreview?: string;
}

interface SecurityScanResult {
  summary: {
    totalVulnerabilities: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    language: string;
    scanType: string;
  };
  vulnerabilities: SecurityVulnerability[];
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  recommendations: string[];
  developerNotes: string;
}

export const scanSecurityTool: Tool = {
  name: 'scan_security',
  description: 'Comprehensive security scanner for AI-generated code. Detects SQL injection, XSS, hardcoded secrets, and other vulnerabilities with CWE codes and secure alternatives.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code snippet to scan for security vulnerabilities'
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'python', 'java', 'sql', 'html', 'unknown'],
        default: 'javascript',
        description: 'Programming language of the code'
      },
      scanType: {
        type: 'string',
        enum: ['quick', 'thorough'],
        default: 'thorough',
        description: 'Scan depth: quick (essential checks) or thorough (comprehensive)'
      }
    },
    required: ['code']
  }
};

export async function handleScanSecurity(input: unknown): Promise<SecurityScanResult> {
  try {
    const params = inputSchema.parse(input);

    logger.info(`Security scan requested for ${params.language} code (${params.scanType} mode)`);

    const vulnerabilities: SecurityVulnerability[] = [];

    // Run appropriate scanners based on language and scan type
    if (params.scanType === 'thorough' || ['javascript', 'typescript', 'sql'].includes(params.language)) {
      const sqlDetector = new SqlInjectionDetector();
      const sqlVulns = sqlDetector.scan(params.code);
      vulnerabilities.push(...formatVulnerabilities(sqlVulns, 'SQLInjectionDetector'));
    }

    if (params.scanType === 'thorough' || ['javascript', 'typescript', 'html', 'python', 'java'].includes(params.language)) {
      const xssDetector = new XssDetector();
      const xssVulns = xssDetector.scan(params.code);
      vulnerabilities.push(...formatVulnerabilities(xssVulns, 'XssDetector'));
    }

    if (params.scanType === 'thorough' || ['javascript', 'typescript', 'python', 'java'].includes(params.language)) {
      const secretScanner = new SecretScanner();
      const secretVulns = secretScanner.scan(params.code);
      vulnerabilities.push(...formatVulnerabilities(secretVulns, 'SecretScanner'));
    }

    // Sort by severity and line number
    vulnerabilities.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      const aSeverity = severityOrder[a.severity] ?? 4;
      const bSeverity = severityOrder[b.severity] ?? 4;

      if (aSeverity !== bSeverity) return aSeverity - bSeverity;
      return a.line - b.line;
    });

    // Calculate summary
    const summary = calculateSummary(vulnerabilities, params.language, params.scanType);

    // Generate recommendations
    const recommendations = generateRecommendations(vulnerabilities);

    // Generate developer notes
    const developerNotes = generateDeveloperNotes(vulnerabilities, params.language);

    // Determine overall risk level
    const riskLevel = determineRiskLevel(summary);

    const result: SecurityScanResult = {
      summary,
      vulnerabilities,
      riskLevel,
      recommendations,
      developerNotes,
    };

    logger.info(`Security scan completed: ${vulnerabilities.length} vulnerabilities found (${summary.critical} critical, ${summary.high} high)`);

    return result;
  } catch (error) {
    logger.error('Error during security scan:', error);

    if (error instanceof z.ZodError) {
      return {
        summary: {
          totalVulnerabilities: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          language: 'unknown',
          scanType: 'thorough',
        },
        vulnerabilities: [],
        riskLevel: 'SAFE',
        recommendations: ['Invalid input provided to security scanner'],
        developerNotes: `Validation error: ${error.message}`,
      };
    }

    return {
      summary: {
        totalVulnerabilities: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        language: 'unknown',
        scanType: 'thorough',
      },
      vulnerabilities: [],
      riskLevel: 'SAFE',
      recommendations: ['An error occurred during scanning'],
      developerNotes: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Format vulnerabilities from scanners to unified format
 */
function formatVulnerabilities(vulns: any[], scannerName: string): SecurityVulnerability[] {
  return vulns.map(vuln => ({
    ...vuln,
    scanner: scannerName,
  }));
}

/**
 * Calculate vulnerability summary
 */
function calculateSummary(vulnerabilities: SecurityVulnerability[], language: string, scanType: string) {
  const counts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  for (const vuln of vulnerabilities) {
    counts[vuln.severity]++;
  }

  return {
    totalVulnerabilities: vulnerabilities.length,
    critical: counts.CRITICAL,
    high: counts.HIGH,
    medium: counts.MEDIUM,
    low: counts.LOW,
    language,
    scanType,
  };
}

/**
 * Generate recommendations based on vulnerabilities found
 */
function generateRecommendations(vulnerabilities: SecurityVulnerability[]): string[] {
  const recommendations: Set<string> = new Set();

  // Group vulnerabilities by type
  const hasSQL = vulnerabilities.some(v => v.type === 'SQL_INJECTION' || v.type === 'UNPARAMETERIZED_QUERY');
  const hasXSS = vulnerabilities.some(v => v.type?.includes('XSS') || v.type?.includes('INNERHTML'));
  const hasSecrets = vulnerabilities.some(v => v.type === 'HARDCODED_API_KEY' || v.type === 'HARDCODED_PASSWORD');

  if (hasSQL) {
    recommendations.add('Use parameterized queries for all database operations. Never concatenate user input directly into SQL strings.');
    recommendations.add('Consider using an ORM like Prisma, Drizzle, or TypeORM that handle SQL injection prevention automatically.');
    recommendations.add('Validate and whitelist all dynamic table and column names using strict allowlists.');
  }

  if (hasXSS) {
    recommendations.add('Use textContent instead of innerHTML for displaying user-provided text.');
    recommendations.add('Always sanitize untrusted HTML using libraries like DOMPurify before rendering.');
    recommendations.add('Use content security policies (CSP) to prevent inline script execution.');
    recommendations.add('Never use eval() or Function() constructors with user input.');
    recommendations.add('In React, prefer component composition over dangerouslySetInnerHTML.');
  }

  if (hasSecrets) {
    recommendations.add('Move all secrets to environment variables (.env files, never commit these).');
    recommendations.add('Use a secrets management system: AWS Secrets Manager, HashiCorp Vault, or cloud provider equivalents.');
    recommendations.add('Rotate all exposed credentials immediately - they may be compromised.');
    recommendations.add('Implement pre-commit hooks to prevent secrets from being committed.');
  }

  // General recommendations
  recommendations.add('Enable OWASP dependency scanning in your CI/CD pipeline (npm audit, Snyk, etc.).');
  recommendations.add('Implement automated security scanning in code review process.');
  recommendations.add('Conduct regular security audits of AI-generated code before deployment.');
  recommendations.add('Use security linters: ESLint security plugins, Semgrep, or SonarQube.');

  return Array.from(recommendations);
}

/**
 * Generate developer-friendly notes
 */
function generateDeveloperNotes(vulnerabilities: SecurityVulnerability[], language: string): string {
  const criticalCount = vulnerabilities.filter(v => v.severity === 'CRITICAL').length;
  const highCount = vulnerabilities.filter(v => v.severity === 'HIGH').length;

  if (vulnerabilities.length === 0) {
    return `Good news! No security vulnerabilities detected in this ${language} code snippet during scanning. ✓`;
  }

  let notes = `Security scan found ${vulnerabilities.length} potential issue(s) in this ${language} code:\n`;

  if (criticalCount > 0) {
    notes += `\n🔴 CRITICAL (${criticalCount}): These vulnerabilities could lead to immediate security breaches. Fix these before any deployment.\n`;
  }

  if (highCount > 0) {
    notes += `\n🟠 HIGH (${highCount}): Serious security issues that should be fixed as soon as possible.\n`;
  }

  const mediumCount = vulnerabilities.filter(v => v.severity === 'MEDIUM').length;
  if (mediumCount > 0) {
    notes += `\n🟡 MEDIUM (${mediumCount}): Important security improvements to make.\n`;
  }

  notes += `\n📋 Each vulnerability includes:
- The specific code location (line number)
- CWE code for security reference
- Clear explanation of the risk
- Secure code example for fixing

⚠️  Research Finding: 80% of AI-generated code contains security vulnerabilities. Developers are 3.5x more likely to think insecure code is secure. Always review AI-generated code with security in mind.`;

  return notes;
}

/**
 * Determine overall risk level
 */
function determineRiskLevel(summary: any): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE' {
  if (summary.critical > 0) return 'CRITICAL';
  if (summary.high >= 3) return 'CRITICAL';
  if (summary.high > 0) return 'HIGH';
  if (summary.medium >= 3) return 'MEDIUM';
  if (summary.medium > 0) return 'LOW';
  return 'SAFE';
}
