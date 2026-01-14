import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import * as tar from 'tar';
import { logger } from '../../../utils/logger.js';
import { getDb } from '../../../db/client.js';
import { createHash, randomBytes } from 'crypto';
import path from 'path';

/**
 * Data export format options
 */
export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  XML = 'xml',
  PDF = 'pdf',
  ARCHIVE = 'archive', // TAR.GZ with all formats
}

/**
 * Data categories for export
 */
export enum DataCategory {
  PROFILE = 'profile',
  AUTHENTICATION = 'authentication',
  SESSIONS = 'sessions',
  INSIGHTS = 'insights',
  CONSENTS = 'consents',
  ACTIVITY_LOGS = 'activity_logs',
  COMMUNICATIONS = 'communications',
  PREFERENCES = 'preferences',
  THIRD_PARTY_DATA = 'third_party',
  DERIVED_DATA = 'derived',
  ALL = 'all',
}

/**
 * Export request status
 */
export enum ExportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

/**
 * Data export request
 */
export interface ExportRequest {
  id: string;
  userId: string;
  requestedAt: Date;
  requestedBy: string; // User or admin ID
  categories: DataCategory[];
  format: ExportFormat;
  status: ExportStatus;
  completedAt?: Date;
  expiresAt: Date;
  downloadUrl?: string;
  checksum?: string;
  fileSize?: number;
  encryptionKey?: string; // For encrypted exports
  metadata?: {
    ipAddress: string;
    userAgent: string;
    reason?: string;
    includeDeleted: boolean;
    dateRange?: {
      start: Date;
      end: Date;
    };
  };
}

/**
 * User data structure for export
 */
export interface UserDataExport {
  exportVersion: string;
  exportDate: Date;
  userId: string;
  profile: {
    id: string;
    email: string;
    name?: string;
    createdAt: Date;
    lastActive?: Date;
    metadata?: Record<string, any>;
  };
  authentication: {
    providers: string[];
    lastLogin?: Date;
    mfaEnabled: boolean;
    sessions: Array<{
      id: string;
      createdAt: Date;
      expiresAt: Date;
      ipAddress?: string;
      userAgent?: string;
    }>;
  };
  data: {
    [category: string]: any[];
  };
  statistics: {
    totalSessions: number;
    totalInsights: number;
    totalCheckpoints: number;
    dataPointsExported: number;
  };
  legalNotice: string;
}

/**
 * GDPR Data Portability Manager
 * Implements GDPR Article 20 - Right to data portability
 */
export class DataPortabilityManager {
  private readonly EXPORT_VERSION = '1.0.0';
  private readonly EXPORT_EXPIRY_HOURS = 72; // 3 days
  private readonly MAX_EXPORT_SIZE_MB = 1000; // 1GB limit
  private readonly CHUNK_SIZE = 1024 * 1024; // 1MB chunks
  private exportQueue = new Map<string, ExportRequest>();

  /**
   * Request data export
   */
  async requestExport(
    userId: string,
    categories: DataCategory[] = [DataCategory.ALL],
    format: ExportFormat = ExportFormat.JSON,
    options?: {
      requestedBy?: string;
      reason?: string;
      dateRange?: { start: Date; end: Date };
      includeDeleted?: boolean;
      encrypted?: boolean;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<ExportRequest> {
    // Check for existing pending export
    const existingExport = await this.getActiveExport(userId);
    if (existingExport) {
      logger.warn(`Export already in progress for user ${userId}`);
      return existingExport;
    }

    const exportId = this.generateExportId(userId);
    const now = new Date();

    const request: ExportRequest = {
      id: exportId,
      userId,
      requestedAt: now,
      requestedBy: options?.requestedBy || userId,
      categories: categories.includes(DataCategory.ALL)
        ? Object.values(DataCategory).filter(c => c !== DataCategory.ALL)
        : categories,
      format,
      status: ExportStatus.PENDING,
      expiresAt: new Date(now.getTime() + this.EXPORT_EXPIRY_HOURS * 3600000),
      metadata: {
        ipAddress: options?.ipAddress || '',
        userAgent: options?.userAgent || '',
        reason: options?.reason,
        includeDeleted: options?.includeDeleted || false,
        dateRange: options?.dateRange,
      },
    };

    // Generate encryption key if requested
    if (options?.encrypted) {
      request.encryptionKey = randomBytes(32).toString('base64');
    }

    // Store request
    await this.storeExportRequest(request);
    this.exportQueue.set(exportId, request);

    // Process asynchronously
    this.processExportAsync(request);

    logger.info(`Data export requested for user ${userId}: ${exportId}`);
    return request;
  }

  /**
   * Process export asynchronously
   */
  private async processExportAsync(request: ExportRequest): Promise<void> {
    try {
      // Update status
      request.status = ExportStatus.PROCESSING;
      await this.updateExportRequest(request);

      // Collect user data
      const userData = await this.collectUserData(
        request.userId,
        request.categories,
        request.metadata?.dateRange
      );

      // Validate data size
      const estimatedSize = this.estimateDataSize(userData);
      if (estimatedSize > this.MAX_EXPORT_SIZE_MB * 1024 * 1024) {
        throw new Error(`Export size exceeds limit: ${estimatedSize} bytes`);
      }

      // Generate export file
      const filePath = await this.generateExportFile(
        userData,
        request.format,
        request.encryptionKey
      );

      // Calculate checksum
      const checksum = await this.calculateChecksum(filePath);

      // Upload to secure storage
      const downloadUrl = await this.uploadToStorage(filePath, request.id);

      // Update request
      request.status = ExportStatus.COMPLETED;
      request.completedAt = new Date();
      request.downloadUrl = downloadUrl;
      request.checksum = checksum;
      request.fileSize = estimatedSize;

      await this.updateExportRequest(request);

      // Send notification
      await this.notifyExportComplete(request);

      logger.info(`Export completed for user ${request.userId}: ${request.id}`);
    } catch (error) {
      logger.error(`Export failed for user ${request.userId}:`, error);

      request.status = ExportStatus.FAILED;
      await this.updateExportRequest(request);

      await this.notifyExportFailed(request, error);
    } finally {
      this.exportQueue.delete(request.id);
    }
  }

  /**
   * Collect all user data for export
   */
  private async collectUserData(
    userId: string,
    categories: DataCategory[],
    dateRange?: { start: Date; end: Date }
  ): Promise<UserDataExport> {
    const data: UserDataExport = {
      exportVersion: this.EXPORT_VERSION,
      exportDate: new Date(),
      userId,
      profile: await this.getUserProfile(userId),
      authentication: await this.getAuthenticationData(userId),
      data: {},
      statistics: {
        totalSessions: 0,
        totalInsights: 0,
        totalCheckpoints: 0,
        dataPointsExported: 0,
      },
      legalNotice: this.generateLegalNotice(),
    };

    // Collect data by category
    for (const category of categories) {
      const categoryData = await this.collectCategoryData(
        userId,
        category,
        dateRange
      );

      if (categoryData && categoryData.length > 0) {
        data.data[category] = categoryData;
        data.statistics.dataPointsExported += categoryData.length;

        // Update statistics
        switch (category) {
          case DataCategory.SESSIONS:
            data.statistics.totalSessions = categoryData.length;
            break;
          case DataCategory.INSIGHTS:
            data.statistics.totalInsights = categoryData.length;
            break;
        }
      }
    }

    // Add data relationships and cross-references
    data.data.relationships = await this.getDataRelationships(userId);

    return data;
  }

  /**
   * Collect data for specific category
   */
  private async collectCategoryData(
    userId: string,
    category: DataCategory,
    dateRange?: { start: Date; end: Date }
  ): Promise<any[]> {
    const db = getDb();

    switch (category) {
      case DataCategory.PROFILE:
        return [await this.getUserProfile(userId)];

      case DataCategory.SESSIONS:
        // Get sessions with optional date range
        return []; // Would query database

      case DataCategory.INSIGHTS:
        // Get user insights
        return []; // Would query database

      case DataCategory.CONSENTS:
        // Get consent history
        return []; // Would query database

      case DataCategory.ACTIVITY_LOGS:
        // Get activity logs
        return []; // Would query database

      case DataCategory.COMMUNICATIONS:
        // Get communication preferences and history
        return []; // Would query database

      case DataCategory.PREFERENCES:
        // Get user preferences
        return []; // Would query database

      case DataCategory.THIRD_PARTY_DATA:
        // Get data from third-party integrations
        return []; // Would query external services

      case DataCategory.DERIVED_DATA:
        // Get AI-derived insights and predictions
        return []; // Would query database

      default:
        return [];
    }
  }

  /**
   * Generate export file in specified format
   */
  private async generateExportFile(
    data: UserDataExport,
    format: ExportFormat,
    encryptionKey?: string
  ): Promise<string> {
    const tempDir = '/tmp/gdpr-exports';
    const fileName = `export-${data.userId}-${Date.now()}`;
    let filePath: string;

    switch (format) {
      case ExportFormat.JSON:
        filePath = await this.generateJSONExport(data, tempDir, fileName);
        break;

      case ExportFormat.CSV:
        filePath = await this.generateCSVExport(data, tempDir, fileName);
        break;

      case ExportFormat.XML:
        filePath = await this.generateXMLExport(data, tempDir, fileName);
        break;

      case ExportFormat.PDF:
        filePath = await this.generatePDFExport(data, tempDir, fileName);
        break;

      case ExportFormat.ARCHIVE:
        filePath = await this.generateArchiveExport(data, tempDir, fileName);
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Encrypt if requested
    if (encryptionKey) {
      filePath = await this.encryptExportFile(filePath, encryptionKey);
    }

    return filePath;
  }

  /**
   * Generate JSON export
   */
  private async generateJSONExport(
    data: UserDataExport,
    tempDir: string,
    fileName: string
  ): Promise<string> {
    const filePath = path.join(tempDir, `${fileName}.json`);
    const content = JSON.stringify(data, null, 2);

    await this.writeFile(filePath, content);
    return filePath;
  }

  /**
   * Generate CSV export (flattened data)
   */
  private async generateCSVExport(
    data: UserDataExport,
    tempDir: string,
    fileName: string
  ): Promise<string> {
    const filePath = path.join(tempDir, `${fileName}.csv`);

    // Convert nested data to CSV format
    // This would use a CSV library in production
    const csvContent = this.convertToCSV(data);

    await this.writeFile(filePath, csvContent);
    return filePath;
  }

  /**
   * Generate XML export
   */
  private async generateXMLExport(
    data: UserDataExport,
    tempDir: string,
    fileName: string
  ): Promise<string> {
    const filePath = path.join(tempDir, `${fileName}.xml`);

    // Convert to XML format
    const xmlContent = this.convertToXML(data);

    await this.writeFile(filePath, xmlContent);
    return filePath;
  }

  /**
   * Generate PDF export (human-readable)
   */
  private async generatePDFExport(
    data: UserDataExport,
    tempDir: string,
    fileName: string
  ): Promise<string> {
    const filePath = path.join(tempDir, `${fileName}.pdf`);

    // Generate PDF (would use PDF library like pdfkit)
    // For now, just create a placeholder
    await this.writeFile(filePath, JSON.stringify(data));

    return filePath;
  }

  /**
   * Generate archive with all formats
   */
  private async generateArchiveExport(
    data: UserDataExport,
    tempDir: string,
    fileName: string
  ): Promise<string> {
    const archiveDir = path.join(tempDir, fileName);

    // Generate all formats
    await this.generateJSONExport(data, archiveDir, 'data');
    await this.generateCSVExport(data, archiveDir, 'data');
    await this.generateXMLExport(data, archiveDir, 'data');
    await this.generatePDFExport(data, archiveDir, 'report');

    // Create TAR.GZ archive
    const archivePath = path.join(tempDir, `${fileName}.tar.gz`);

    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: tempDir,
      },
      [fileName]
    );

    return archivePath;
  }

  /**
   * Import user data (for transfer between services)
   */
  async importUserData(
    importData: UserDataExport,
    options?: {
      merge?: boolean;
      validateSchema?: boolean;
      skipExisting?: boolean;
    }
  ): Promise<{
    success: boolean;
    imported: number;
    skipped: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    };

    try {
      // Validate schema
      if (options?.validateSchema) {
        const valid = await this.validateImportSchema(importData);
        if (!valid) {
          result.errors.push('Invalid data schema');
          return result;
        }
      }

      // Check if user exists
      const userExists = await this.checkUserExists(importData.userId);

      if (userExists && !options?.merge) {
        result.errors.push('User already exists');
        return result;
      }

      // Import data by category
      for (const [category, items] of Object.entries(importData.data)) {
        try {
          const imported = await this.importCategoryData(
            importData.userId,
            category as DataCategory,
            items,
            options
          );
          result.imported += imported.count;
          result.skipped += imported.skipped;
        } catch (error) {
          result.errors.push(`Failed to import ${category}: ${error}`);
        }
      }

      result.success = result.errors.length === 0;
      logger.info(`Data import completed: ${result.imported} imported, ${result.skipped} skipped`);

    } catch (error) {
      logger.error('Data import failed:', error);
      result.errors.push(`Import failed: ${error}`);
    }

    return result;
  }

  /**
   * Get export status
   */
  async getExportStatus(exportId: string): Promise<ExportRequest | null> {
    return this.exportQueue.get(exportId) || null;
  }

  /**
   * Cancel export request
   */
  async cancelExport(exportId: string, userId: string): Promise<boolean> {
    const request = this.exportQueue.get(exportId);

    if (!request) {
      return false;
    }

    if (request.userId !== userId) {
      throw new Error('Unauthorized to cancel this export');
    }

    if (request.status !== ExportStatus.PENDING) {
      throw new Error('Cannot cancel export in progress');
    }

    request.status = ExportStatus.CANCELLED;
    await this.updateExportRequest(request);
    this.exportQueue.delete(exportId);

    logger.info(`Export cancelled: ${exportId}`);
    return true;
  }

  /**
   * Clean up expired exports
   */
  async cleanupExpiredExports(): Promise<number> {
    const now = new Date();
    let cleaned = 0;

    for (const [id, request] of this.exportQueue) {
      if (request.expiresAt < now) {
        // Delete file from storage
        if (request.downloadUrl) {
          await this.deleteFromStorage(request.downloadUrl);
        }

        // Update status
        request.status = ExportStatus.EXPIRED;
        await this.updateExportRequest(request);

        // Remove from queue
        this.exportQueue.delete(id);
        cleaned++;
      }
    }

    logger.info(`Cleaned up ${cleaned} expired exports`);
    return cleaned;
  }

  // Helper methods

  private generateExportId(userId: string): string {
    return `export_${userId}_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private estimateDataSize(data: UserDataExport): number {
    return JSON.stringify(data).length;
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    return createHash('sha256')
      .update(await this.readFile(filePath))
      .digest('hex');
  }

  private convertToCSV(data: any): string {
    // Simplified CSV conversion
    return JSON.stringify(data); // Would use proper CSV library
  }

  private convertToXML(data: any): string {
    // Simplified XML conversion
    return `<?xml version="1.0"?><data>${JSON.stringify(data)}</data>`;
  }

  private generateLegalNotice(): string {
    return `This data export contains personal information protected under GDPR.
    It is provided for data portability purposes as per Article 20 of GDPR.
    This data should be handled securely and in compliance with applicable privacy laws.`;
  }

  // Mock database operations
  private async getUserProfile(userId: string): Promise<any> {
    return { id: userId, email: 'user@example.com' };
  }

  private async getAuthenticationData(userId: string): Promise<any> {
    return { providers: ['google'], mfaEnabled: true, sessions: [] };
  }

  private async getDataRelationships(userId: string): Promise<any> {
    return {};
  }

  private async storeExportRequest(request: ExportRequest): Promise<void> {
    // Store in database
  }

  private async updateExportRequest(request: ExportRequest): Promise<void> {
    // Update in database
  }

  private async getActiveExport(userId: string): Promise<ExportRequest | null> {
    // Check database for active exports
    return null;
  }

  private async uploadToStorage(filePath: string, exportId: string): Promise<string> {
    // Upload to secure cloud storage
    return `https://storage.example.com/exports/${exportId}`;
  }

  private async deleteFromStorage(url: string): Promise<void> {
    // Delete from cloud storage
  }

  private async notifyExportComplete(request: ExportRequest): Promise<void> {
    // Send notification
  }

  private async notifyExportFailed(request: ExportRequest, error: any): Promise<void> {
    // Send failure notification
  }

  private async encryptExportFile(filePath: string, key: string): Promise<string> {
    // Encrypt file
    return `${filePath}.encrypted`;
  }

  private async validateImportSchema(data: UserDataExport): Promise<boolean> {
    // Validate data structure
    return true;
  }

  private async checkUserExists(userId: string): Promise<boolean> {
    // Check if user exists
    return false;
  }

  private async importCategoryData(
    userId: string,
    category: DataCategory,
    items: any[],
    options?: any
  ): Promise<{ count: number; skipped: number }> {
    // Import data
    return { count: items.length, skipped: 0 };
  }

  private async writeFile(path: string, content: string): Promise<void> {
    // Write file
  }

  private async readFile(path: string): Promise<string> {
    // Read file
    return '';
  }
}

// Export singleton instance
export const dataPortabilityManager = new DataPortabilityManager();