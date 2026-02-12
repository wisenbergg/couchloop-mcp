import { ProtectFilesSchema, FileOperation } from '../types/file-protection.js';
import { fileGuardian } from '../developer/guards/file-guardian.js';
import { autoBackup } from '../developer/backup/auto-backup.js';
import { handleError, AuthorizationError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

/**
 * Protect Files Tool - MCP tool handler for file protection
 * Intercepts and validates destructive file operations
 * Prevents accidental deletion, overwriting, and data loss
 */

export async function protectFiles(args: unknown) {
  try {
    // Validate input
    const input = ProtectFilesSchema.parse(args);

    logger.info(
      `File protection check: ${input.operation} on ${input.path}${input.target_path ? ` -> ${input.target_path}` : ''}`
    );

    // Run validation
    const validation = fileGuardian.validateOperation(
      input.operation,
      input.path,
      input.target_path,
      input.force || false
    );

    // Create operation record
    const operation: FileOperation = {
      id: nanoid(),
      operation: input.operation,
      path: input.path,
      targetPath: input.target_path,
      timestamp: new Date(),
      status: 'pending',
      reason: input.reason,
      force: input.force || false,
    };

    // Log the operation
    fileGuardian.logOperation(operation);

    // If operation is not allowed, deny it
    if (!validation.allowed) {
      operation.status = 'denied';
      fileGuardian.logOperation(operation);

      const violationDetails = validation.violations
        .map(v => `[${v.severity.toUpperCase()}] ${v.message}`)
        .join('\n');

      logger.warn(
        `File operation DENIED - ${input.operation} on ${input.path}\nViolations:\n${violationDetails}`
      );

      return {
        success: false,
        operation_id: operation.id,
        allowed: false,
        message: `File operation BLOCKED: ${input.operation} operation not permitted`,
        violations: validation.violations,
        recommendation: `This ${input.operation} operation was blocked for safety. Violations detected: ${validation.violations.length}`,
        action_required: 'Human approval needed for this operation',
      };
    }

    // If operation requires approval (violations exist but not critical), request confirmation
    if (validation.requiresApproval && validation.severity !== 'none') {
      operation.status = 'pending';

      const violationDetails = validation.violations
        .map(v => `[${v.severity.toUpperCase()}] ${v.message}`)
        .join('\n');

      logger.warn(
        `File operation requires approval - ${input.operation} on ${input.path}\nViolations:\n${violationDetails}`
      );

      return {
        success: false,
        operation_id: operation.id,
        allowed: false,
        requires_approval: true,
        message: `File operation requires explicit approval before proceeding`,
        violations: validation.violations,
        severity: validation.severity,
        recommendation: 'Please review violations and either:\n1. Obtain human approval, or\n2. Use force flag (if appropriate)',
        suggested_backup: `Consider creating a backup before proceeding with ${input.operation}`,
      };
    }

    // Operation is allowed - if it involves modification, create backup first
    if (input.operation === 'delete' || input.operation === 'overwrite') {
      const backupResult = await autoBackup.createBackup(
        input.path,
        input.operation,
        input.reason
      );

      if (backupResult.success) {
        operation.backupPath = backupResult.backupPath;
        logger.info(`Backup created before ${input.operation}: ${backupResult.backupPath}`);
      } else {
        logger.warn(`Failed to create backup: ${backupResult.error}`);
        return {
          success: false,
          operation_id: operation.id,
          message: `Cannot proceed - backup creation failed: ${backupResult.error}`,
          reason: 'Safety measure: backups required before destructive operations',
        };
      }
    }

    // Mark operation as approved and ready
    operation.status = 'approved';
    fileGuardian.logOperation(operation);

    // Return approval response with execution details
    return {
      success: true,
      operation_id: operation.id,
      allowed: true,
      status: 'approved',
      message: `File operation ${input.operation} has been validated and approved`,
      operation_details: {
        type: input.operation,
        path: input.path,
        target_path: input.target_path || null,
        backup_path: operation.backupPath || null,
      },
      next_steps: [
        `1. Execute the approved ${input.operation} operation`,
        operation.backupPath ? `2. Backup is available at: ${operation.backupPath}` : '',
        operation.backupPath ? `3. If needed, rollback can restore from this backup` : '',
      ].filter(Boolean),
      safety_measures: {
        backup_created: !!operation.backupPath,
        backup_location: operation.backupPath || 'none',
        rollback_available: !!operation.backupPath,
        operation_logged: true,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof AuthorizationError) {
      return {
        success: false,
        error: error.message,
        details: error.details,
      };
    }
    logger.error('Error in protect_files tool:', error);
    return handleError(error);
  }
}

/**
 * Get file protection status
 */
export async function getProtectionStatus(_args: unknown) {
  try {
    const config = fileGuardian.getProtectionConfig();
    const stats = await autoBackup.getBackupStats();
    const report = fileGuardian.getProtectionReport();

    return {
      success: true,
      protection_status: {
        code_freeze_mode: config.codeFreezeMode,
        protected_patterns: config.protectedPatterns,
        forbidden_paths: config.forbiddenPaths,
        critical_system_files: config.criticalSystemFiles,
      },
      backup_stats: {
        total_backups: stats.totalBackups,
        total_size_mb: Math.round(stats.totalSize / 1024 / 1024),
        oldest_backup: stats.oldestBackup,
        newest_backup: stats.newestBackup,
        disk_usage_percent: Math.round(stats.diskUsagePercent),
      },
      protection_report: {
        code_freeze_enabled: report.codeFreezeEnabled,
        operations_logged: report.totalOperationsLogged,
        protected_items_count: report.protectedItemsCount,
        recent_violations_count: report.recentViolations.length,
      },
    };
  } catch (error) {
    logger.error('Error getting protection status:', error);
    return handleError(error);
  }
}

/**
 * Get operation history
 */
export async function getOperationHistory(args: Record<string, unknown>) {
  try {
    const limit = (args.limit || 50) as number;
    const history = fileGuardian.getOperationHistory(limit);

    return {
      success: true,
      operations_count: history.length,
      operations: history.map(op => ({
        id: op.id,
        operation: op.operation,
        path: op.path,
        target_path: op.targetPath || null,
        timestamp: op.timestamp,
        status: op.status,
        force: op.force,
        backup_path: op.backupPath || null,
        error: op.error || null,
      })),
    };
  } catch (error) {
    logger.error('Error getting operation history:', error);
    return handleError(error);
  }
}

/**
 * List available backups
 */
export async function listBackups(_args: unknown) {
  try {
    const backups = await autoBackup.listBackups();

    return {
      success: true,
      backup_count: backups.length,
      backups: backups.map(backup => ({
        id: backup.originalPath,
        original_path: backup.originalPath,
        backup_path: backup.backupPath,
        timestamp: backup.timestamp,
        file_size_kb: Math.round(backup.fileSize / 1024),
        operation: backup.operation,
        reason: backup.reason || null,
      })),
    };
  } catch (error) {
    logger.error('Error listing backups:', error);
    return handleError(error);
  }
}

/**
 * Rollback a file from backup
 */
export async function rollbackFile(args: Record<string, unknown>) {
  try {
    if (!args.backup_id) {
      throw new ValidationError('backup_id is required for rollback operation');
    }

    const result = await autoBackup.rollback(args.backup_id as string);

    if (!result.success) {
      return {
        success: false,
        message: result.message,
        backup_id: args.backup_id,
      };
    }

    logger.info(`File successfully rolled back: ${result.restoredPath}`);

    return {
      success: true,
      message: result.message,
      restored_path: result.restoredPath,
      backup_id: args.backup_id,
      backup_path: result.backupPath,
      timestamp: result.timestamp,
    };
  } catch (error) {
    logger.error('Error rolling back file:', error);
    return handleError(error);
  }
}

/**
 * Enable code freeze mode (all operations require approval)
 */
export async function enableCodeFreeze(_args: unknown) {
  try {
    fileGuardian.enableCodeFreezeMode();

    logger.warn('CODE FREEZE MODE ENABLED - All file operations require explicit approval');

    return {
      success: true,
      message: 'Code freeze mode is now ENABLED',
      status: 'active',
      effect: 'All file operations (delete, overwrite, move) now require explicit approval',
      warning:
        'Critical mode - use only when sensitive to file modifications. Normal operations will be blocked.',
    };
  } catch (error) {
    logger.error('Error enabling code freeze mode:', error);
    return handleError(error);
  }
}

/**
 * Disable code freeze mode
 */
export async function disableCodeFreeze(_args: unknown) {
  try {
    fileGuardian.disableCodeFreezeMode();

    logger.info('Code freeze mode disabled');

    return {
      success: true,
      message: 'Code freeze mode is now DISABLED',
      status: 'inactive',
      effect: 'File operations resume normal protection rules',
    };
  } catch (error) {
    logger.error('Error disabling code freeze mode:', error);
    return handleError(error);
  }
}
