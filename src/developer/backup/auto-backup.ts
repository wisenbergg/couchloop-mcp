import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);

/**
 * Auto-Backup System - Creates automatic backups before file modifications
 * Enables rollback capability and disaster recovery
 */

export interface BackupMetadata {
  originalPath: string;
  backupPath: string;
  timestamp: Date;
  fileSize: number;
  hash: string;
  operation: 'delete' | 'overwrite' | 'move';
  reason?: string;
}

export interface RollbackResult {
  success: boolean;
  restoredPath: string;
  backupPath: string;
  message: string;
  timestamp: Date;
}

export class AutoBackup {
  private backupDir: string;
  private backupMetadata: Map<string, BackupMetadata> = new Map();
  private maxBackupAge: number = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  private maxBackupSize: number = 500 * 1024 * 1024; // 500MB
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(backupDir: string = './.backup') {
    this.backupDir = backupDir;
    this.initializeBackupDirectory();
    this.startCleanupSchedule();
  }

  /**
   * Initialize backup directory structure
   */
  private async initializeBackupDirectory(): Promise<void> {
    try {
      const fullPath = path.resolve(this.backupDir);
      if (!fs.existsSync(fullPath)) {
        await mkdir(fullPath, { recursive: true });
        logger.info(`Backup directory created: ${fullPath}`);
      }

      // Create subdirectories for organization
      const subdirs = ['snapshots', 'metadata', 'rollback-logs'];
      for (const subdir of subdirs) {
        const subdirPath = path.join(fullPath, subdir);
        if (!fs.existsSync(subdirPath)) {
          await mkdir(subdirPath, { recursive: true });
        }
      }
    } catch (error) {
      logger.error('Failed to initialize backup directory:', error);
    }
  }

  /**
   * Create a backup of a file before modification
   */
  async createBackup(
    filePath: string,
    operation: 'delete' | 'overwrite' | 'move',
    reason?: string
  ): Promise<{
    success: boolean;
    backupPath?: string;
    backupId?: string;
    error?: string;
  }> {
    try {
      const fullPath = path.resolve(filePath);

      // Verify file exists
      if (!fs.existsSync(fullPath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      // Get file stats
      const stats = await stat(fullPath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${filePath}`,
        };
      }

      // Check file size
      if (stats.size > 50 * 1024 * 1024) {
        return {
          success: false,
          error: `File too large for backup (>50MB): ${filePath}`,
        };
      }

      // Read file content
      const fileContent = await readFile(fullPath);

      // Generate backup ID and paths
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupId = `${timestamp}_${path.basename(fullPath)}`;
      const backupPath = path.join(this.backupDir, 'snapshots', backupId);

      // Write backup file
      await writeFile(backupPath, fileContent);

      // Create metadata
      const metadata: BackupMetadata = {
        originalPath: fullPath,
        backupPath,
        timestamp: new Date(),
        fileSize: stats.size,
        hash: this.generateSimpleHash(fileContent.toString()),
        operation,
        reason,
      };

      this.backupMetadata.set(backupId, metadata);

      // Save metadata to file
      await this.saveMetadata(backupId, metadata);

      logger.info(`Backup created: ${backupPath} for ${operation} operation on ${filePath}`);

      return {
        success: true,
        backupPath,
        backupId,
      };
    } catch (error) {
      logger.error(`Failed to create backup for ${filePath}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during backup creation',
      };
    }
  }

  /**
   * Restore a file from backup (rollback capability)
   */
  async rollback(backupId: string): Promise<RollbackResult> {
    try {
      const metadata = this.backupMetadata.get(backupId);

      if (!metadata) {
        return {
          success: false,
          restoredPath: '',
          backupPath: '',
          message: `Backup not found: ${backupId}`,
          timestamp: new Date(),
        };
      }

      // Verify backup exists
      if (!fs.existsSync(metadata.backupPath)) {
        return {
          success: false,
          restoredPath: '',
          backupPath: metadata.backupPath,
          message: `Backup file no longer exists: ${metadata.backupPath}`,
          timestamp: new Date(),
        };
      }

      // Read backup content
      const backupContent = await readFile(metadata.backupPath);

      // Restore to original path
      const restorePath = metadata.originalPath;

      // Create parent directory if needed
      const parentDir = path.dirname(restorePath);
      if (!fs.existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }

      // Restore file
      await writeFile(restorePath, backupContent);

      // Log rollback
      await this.logRollback(backupId, restorePath, metadata);

      logger.info(`File rolled back from backup: ${restorePath}`);

      return {
        success: true,
        restoredPath: restorePath,
        backupPath: metadata.backupPath,
        message: `Successfully restored ${path.basename(restorePath)} from backup`,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error(`Failed to rollback backup ${backupId}:`, error);
      return {
        success: false,
        restoredPath: '',
        backupPath: '',
        message: error instanceof Error ? error.message : 'Unknown error during rollback',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get list of available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    const backups: BackupMetadata[] = [];

    try {
      const snapshotsDir = path.join(this.backupDir, 'snapshots');
      if (!fs.existsSync(snapshotsDir)) {
        return backups;
      }

      const files = await readdir(snapshotsDir);

      for (const file of files) {
        const backupId = path.basename(file, path.extname(file));
        const metadata = this.backupMetadata.get(backupId);
        if (metadata) {
          backups.push(metadata);
        }
      }

      // Sort by timestamp descending
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return backups;
    } catch (error) {
      logger.error('Failed to list backups:', error);
      return backups;
    }
  }

  /**
   * Get backup details
   */
  getBackupDetails(backupId: string): BackupMetadata | null {
    return this.backupMetadata.get(backupId) || null;
  }

  /**
   * Clean up old backups (>7 days)
   */
  async cleanupOldBackups(): Promise<{ deletedCount: number; freedSpace: number }> {
    let deletedCount = 0;
    let freedSpace = 0;

    try {
      const backups = await this.listBackups();
      const now = new Date().getTime();

      for (const backup of backups) {
        const backupAge = now - backup.timestamp.getTime();

        if (backupAge > this.maxBackupAge) {
          try {
            if (fs.existsSync(backup.backupPath)) {
              const stats = await stat(backup.backupPath);
              await unlink(backup.backupPath);
              freedSpace += stats.size;
              deletedCount++;
              this.backupMetadata.delete(
                path.basename(backup.backupPath, path.extname(backup.backupPath))
              );
            }
          } catch (error) {
            logger.error(`Failed to delete old backup ${backup.backupPath}:`, error);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleanup: Removed ${deletedCount} old backups, freed ${this.formatBytes(freedSpace)}`);
      }

      return { deletedCount, freedSpace };
    } catch (error) {
      logger.error('Failed to cleanup old backups:', error);
      return { deletedCount: 0, freedSpace: 0 };
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    oldestBackup?: Date;
    newestBackup?: Date;
    diskUsagePercent: number;
  }> {
    try {
      const backups = await this.listBackups();
      let totalSize = 0;

      for (const backup of backups) {
        totalSize += backup.fileSize;
      }

      const oldestBackup = backups.length > 0 ? backups[backups.length - 1]?.timestamp : undefined;
      const newestBackup = backups.length > 0 ? backups[0]?.timestamp : undefined;
      const diskUsagePercent = (totalSize / this.maxBackupSize) * 100;

      return {
        totalBackups: backups.length,
        totalSize,
        oldestBackup,
        newestBackup,
        diskUsagePercent,
      };
    } catch (error) {
      logger.error('Failed to get backup stats:', error);
      return {
        totalBackups: 0,
        totalSize: 0,
        diskUsagePercent: 0,
      };
    }
  }

  /**
   * Start automatic cleanup schedule
   */
  private startCleanupSchedule(): void {
    // Run cleanup every 6 hours
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldBackups().catch(error => {
        logger.error('Scheduled backup cleanup failed:', error);
      });
    }, 6 * 60 * 60 * 1000);

    logger.info('Backup cleanup schedule started (every 6 hours)');
  }

  /**
   * Stop cleanup schedule
   */
  stopCleanupSchedule(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Backup cleanup schedule stopped');
    }
  }

  /**
   * Save metadata to file
   */
  private async saveMetadata(backupId: string, metadata: BackupMetadata): Promise<void> {
    try {
      const metadataPath = path.join(this.backupDir, 'metadata', `${backupId}.json`);
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      logger.error(`Failed to save metadata for ${backupId}:`, error);
    }
  }

  /**
   * Log rollback operation
   */
  private async logRollback(backupId: string, restoredPath: string, metadata: BackupMetadata): Promise<void> {
    try {
      const rollbackLogPath = path.join(
        this.backupDir,
        'rollback-logs',
        `rollback_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      );

      const logEntry = {
        backupId,
        restoredPath,
        originalPath: metadata.originalPath,
        operation: metadata.operation,
        timestamp: new Date().toISOString(),
        originalBackupTime: metadata.timestamp,
      };

      await writeFile(rollbackLogPath, JSON.stringify(logEntry, null, 2));
    } catch (error) {
      logger.error(`Failed to log rollback:`, error);
    }
  }

  /**
   * Generate simple hash of file content for verification
   */
  private generateSimpleHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < Math.min(content.length, 1000); i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}

// Export singleton instance
export const autoBackup = new AutoBackup();
