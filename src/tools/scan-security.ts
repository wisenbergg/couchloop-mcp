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
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
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
function formatVulnerabilities<T extends object>(vulns: T[], scannerName: string): SecurityVulnerability[] {
  return vulns.map(vuln => ({
    ...(vuln as unknown as SecurityVulnerability),
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
  }

  if (hasXSS) {
    recommendations.add('Use textContent instead of innerHTML for displaying user-provided text.');
    recommendations.add('Sanitize untrusted HTML using libraries like DOMPurify before rendering.');
  }

  if (hasSecrets) {
    recommendations.add('Move all secrets to environment variables (.env files, never commit these).');
    recommendations.add('Rotate any exposed credentials as soon as possible.');
  }

  return Array.from(recommendations);
}

/**
 * Generate developer-friendly notes
 */
function generateDeveloperNotes(vulnerabilities: SecurityVulnerability[], language: string): string {
  const criticalCount = vulnerabilities.filter(v => v.severity === 'CRITICAL').length;
  const highCount = vulnerabilities.filter(v => v.severity === 'HIGH').length;

  if (vulnerabilities.length === 0) {
    return `No security vulnerabilities detected in this ${language} code.`;
  }

  let notes = `Security scan found ${vulnerabilities.length} potential issue(s) in this ${language} code:\n`;

  if (criticalCount > 0) {
    notes += `\nCritical (${criticalCount}): Issues that could lead to security breaches. Should be fixed before deployment.\n`;
  }

  if (highCount > 0) {
    notes += `\nHigh (${highCount}): Significant security concerns worth addressing.\n`;
  }

  const mediumCount = vulnerabilities.filter(v => v.severity === 'MEDIUM').length;
  if (mediumCount > 0) {
    notes += `\nMedium (${mediumCount}): Security improvements to consider.\n`;
  }

  const lowCount = vulnerabilities.filter(v => v.severity === 'LOW').length;
  if (lowCount > 0) {
    notes += `\nLow (${lowCount}): Minor concerns, review when convenient.\n`;
  }

  notes += `\nEach finding includes the code location, CWE reference, and a suggested fix.`;

  return notes;
}

/**
 * Determine overall risk level
 */
function determineRiskLevel(summary: SecurityScanResult['summary']): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE' {
  if (summary.critical >= 3) return 'CRITICAL';
  if (summary.critical > 0) return 'HIGH';
  if (summary.high >= 5) return 'HIGH';
  if (summary.high > 0) return 'MEDIUM';
  if (summary.medium >= 3) return 'MEDIUM';
  if (summary.medium > 0) return 'LOW';
  return 'SAFE';
}
