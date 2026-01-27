import path from 'path';
import { logger } from '../../utils/logger.js';
import { ProtectionViolation, FileOperation } from '../../types/file-protection.js';

/**
 * File Guardian - Detects and prevents destructive file operations
 * Protects against accidental deletion, overwriting, and data loss
 */

// Patterns that ALWAYS require confirmation before modification/deletion
const PROTECTED_PATTERNS = [
  '.env*',
  '*.key',
  '*.pem',
  '*.secret',
  '*.credentials',
  'database.sqlite',
  'production.json',
  'secrets.json',
  'config.json',
  'package.json',
  'package-lock.json',
  'yarn.lock',
];

// Paths that should NEVER be deleted (code freeze)
const FORBIDDEN_PATHS = [
  '.git',
  '.gitignore',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.env.production',
  '.env.staging',
  'Dockerfile',
  '.dockerignore',
];

// System/critical files
const CRITICAL_SYSTEM_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  'package.json',
  'tsconfig.json',
  'eslint.config.js',
  'vitest.config.ts',
  'drizzle.config.ts',
];

// Dangerous operations that require explicit confirmation
const DANGEROUS_OPERATIONS = ['rm -rf', 'rm -f', 'delete', 'unlink', 'truncate'];

export class FileGuardian {
  private codeFreezeMode: boolean = false;
  private operationLog: FileOperation[] = [];

  constructor() {
    this.codeFreezeMode = process.env.CODE_FREEZE_MODE === 'true';
  }

  /**
   * Enable code freeze mode - all file operations require approval
   */
  enableCodeFreezeMode(): void {
    this.codeFreezeMode = true;
    logger.info('Code freeze mode ENABLED - all file operations require approval');
  }

  /**
   * Disable code freeze mode
   */
  disableCodeFreezeMode(): void {
    this.codeFreezeMode = false;
    logger.info('Code freeze mode disabled');
  }

  /**
   * Check if a file path matches a protected pattern
   */
  matchesProtectedPattern(filePath: string): boolean {
    const fileName = path.basename(filePath);
    return PROTECTED_PATTERNS.some(pattern => {
      const globPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${globPattern}$`);
      return regex.test(fileName);
    });
  }

  /**
   * Check if a path is forbidden (should never be deleted)
   */
  isForbiddenPath(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    return FORBIDDEN_PATHS.some(forbidden => {
      return normalized.includes(forbidden) || path.basename(normalized) === forbidden;
    });
  }

  /**
   * Check if this is a critical system file
   */
  isCriticalSystemFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    return CRITICAL_SYSTEM_FILES.includes(fileName);
  }

  /**
   * Check if operation is dangerous
   */
  isDangerousOperation(operation: string): boolean {
    return DANGEROUS_OPERATIONS.some(op => operation.toLowerCase().includes(op));
  }

  /**
   * Validate file deletion operation
   */
  validateDelete(filePath: string, _force: boolean = false): ProtectionViolation[] {
    const violations: ProtectionViolation[] = [];

    // Check if path is forbidden
    if (this.isForbiddenPath(filePath)) {
      violations.push({
        type: 'forbidden_path',
        path: filePath,
        message: `Path '${filePath}' is protected and cannot be deleted. This directory/file is critical to system operation.`,
        severity: 'critical',
      });
    }

    // Check for critical system files
    if (this.isCriticalSystemFile(filePath)) {
      violations.push({
        type: 'system_file',
        path: filePath,
        message: `System file '${filePath}' requires special approval before deletion.`,
        severity: 'high',
      });
    }

    // Check protected patterns
    if (this.matchesProtectedPattern(filePath)) {
      violations.push({
        type: 'protected_pattern',
        path: filePath,
        message: `File '${filePath}' matches protected pattern. Credentials/configs must not be deleted.`,
        severity: 'critical',
      });
    }

    // Code freeze mode check
    if (this.codeFreezeMode) {
      violations.push({
        type: 'dangerous_operation',
        path: filePath,
        message: `Code freeze mode is ENABLED. All delete operations require explicit approval. Cannot proceed.`,
        severity: 'critical',
      });
    }

    return violations;
  }

  /**
   * Validate file overwrite operation
   */
  validateOverwrite(filePath: string, _force: boolean = false): ProtectionViolation[] {
    const violations: ProtectionViolation[] = [];

    // Check for critical system files
    if (this.isCriticalSystemFile(filePath)) {
      violations.push({
        type: 'system_file',
        path: filePath,
        message: `System file '${filePath}' cannot be overwritten without backup and approval.`,
        severity: 'high',
      });
    }

    // Check protected patterns
    if (this.matchesProtectedPattern(filePath)) {
      violations.push({
        type: 'protected_pattern',
        path: filePath,
        message: `File '${filePath}' is protected. Overwriting credentials/configs is dangerous.`,
        severity: 'critical',
      });
    }

    // Code freeze mode check
    if (this.codeFreezeMode) {
      violations.push({
        type: 'dangerous_operation',
        path: filePath,
        message: `Code freeze mode is ENABLED. All file modifications require explicit approval.`,
        severity: 'critical',
      });
    }

    return violations;
  }

  /**
   * Validate file move operation
   */
  validateMove(sourcePath: string, targetPath: string, _force: boolean = false): ProtectionViolation[] {
    const violations: ProtectionViolation[] = [];

    // Check if source is forbidden
    if (this.isForbiddenPath(sourcePath)) {
      violations.push({
        type: 'forbidden_path',
        path: sourcePath,
        message: `Cannot move protected path '${sourcePath}'`,
        severity: 'critical',
      });
    }

    // Check if source is critical
    if (this.isCriticalSystemFile(sourcePath)) {
      violations.push({
        type: 'system_file',
        path: sourcePath,
        message: `Cannot move critical system file '${sourcePath}' without backup.`,
        severity: 'high',
      });
    }

    // Warn if target path suggests unsafe operation
    if (this.isForbiddenPath(targetPath)) {
      violations.push({
        type: 'dangerous_operation',
        path: targetPath,
        message: `Moving to protected location '${targetPath}' may cause issues.`,
        severity: 'high',
      });
    }

    // Code freeze mode check
    if (this.codeFreezeMode) {
      violations.push({
        type: 'dangerous_operation',
        path: sourcePath,
        message: `Code freeze mode is ENABLED. All file operations require explicit approval.`,
        severity: 'critical',
      });
    }

    return violations;
  }

  /**
   * Perform comprehensive file operation validation
   */
  validateOperation(
    operation: 'delete' | 'overwrite' | 'move',
    filePath: string,
    targetPath?: string,
    force: boolean = false
  ): {
    allowed: boolean;
    violations: ProtectionViolation[];
    requiresApproval: boolean;
    severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  } {
    let violations: ProtectionViolation[] = [];

    switch (operation) {
      case 'delete':
        violations = this.validateDelete(filePath, force);
        break;
      case 'overwrite':
        violations = this.validateOverwrite(filePath, force);
        break;
      case 'move':
        violations = this.validateMove(filePath, targetPath || '', force);
        break;
    }

    // Determine severity from violations
    let maxSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
    for (const violation of violations) {
      if (violation.severity === 'critical') {
        maxSeverity = 'critical';
      } else if (violation.severity === 'high' && maxSeverity !== 'critical') {
        maxSeverity = 'high';
      } else if (violation.severity === 'medium' && maxSeverity === 'none') {
        maxSeverity = 'medium';
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      requiresApproval: violations.length > 0,
      severity: maxSeverity,
    };
  }

  /**
   * Log a file operation
   */
  logOperation(operation: FileOperation): void {
    this.operationLog.push({
      ...operation,
      timestamp: new Date(),
    });

    logger.info(
      `File operation logged: ${operation.operation} on ${operation.path} - Status: ${operation.status}`
    );

    // Keep only last 100 operations
    if (this.operationLog.length > 100) {
      this.operationLog = this.operationLog.slice(-100);
    }
  }

  /**
   * Get operation history
   */
  getOperationHistory(limit: number = 50): FileOperation[] {
    return this.operationLog.slice(-limit);
  }

  /**
   * Get protected paths configuration
   */
  getProtectionConfig(): {
    protectedPatterns: string[];
    forbiddenPaths: string[];
    criticalSystemFiles: string[];
    codeFreezeMode: boolean;
  } {
    return {
      protectedPatterns: PROTECTED_PATTERNS,
      forbiddenPaths: FORBIDDEN_PATHS,
      criticalSystemFiles: CRITICAL_SYSTEM_FILES,
      codeFreezeMode: this.codeFreezeMode,
    };
  }

  /**
   * Generate protection report
   */
  getProtectionReport(): {
    codeFreezeEnabled: boolean;
    totalOperationsLogged: number;
    recentViolations: ProtectionViolation[];
    protectedItemsCount: number;
  } {
    const recentViolations: ProtectionViolation[] = [];

    // Extract violations from recent operations
    for (const _op of this.operationLog.slice(-20)) {
      // This would need to store violations in FileOperation
      // For now, return empty
    }

    return {
      codeFreezeEnabled: this.codeFreezeMode,
      totalOperationsLogged: this.operationLog.length,
      recentViolations,
      protectedItemsCount: PROTECTED_PATTERNS.length + FORBIDDEN_PATHS.length,
    };
  }
}

// Export singleton instance
export const fileGuardian = new FileGuardian();
