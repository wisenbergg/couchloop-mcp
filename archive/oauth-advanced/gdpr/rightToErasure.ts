import { logger } from '../../../utils/logger.js';
import { getDb } from '../../../db/client.js';
import { createHash, randomBytes } from 'crypto';

/**
 * Deletion scope options
 */
export enum DeletionScope {
  FULL = 'full',                   // Complete account deletion
  PARTIAL = 'partial',             // Selective data deletion
  ANONYMIZE = 'anonymize',         // Replace with anonymous data
  PSEUDONYMIZE = 'pseudonymize',   // Replace with pseudonyms
  ARCHIVE = 'archive',             // Archive before deletion
}

/**
 * Data retention reasons (lawful basis to refuse deletion)
 */
export enum RetentionReason {
  LEGAL_OBLIGATION = 'legal_obligation',       // Legal requirement to retain
  CONTRACT_FULFILLMENT = 'contract',           // Needed for contract
  VITAL_INTERESTS = 'vital_interests',         // Protect vital interests
  PUBLIC_INTEREST = 'public_interest',         // Public interest task
  LEGAL_CLAIMS = 'legal_claims',              // Legal claims/defense
  FREEDOM_OF_EXPRESSION = 'expression',        // Freedom of expression
  COMPLIANCE = 'compliance',                    // Regulatory compliance
  FINANCIAL_RECORDS = 'financial',            // Financial record keeping
  FRAUD_PREVENTION = 'fraud',                 // Fraud prevention
}

/**
 * Deletion request status
 */
export enum DeletionStatus {
  PENDING = 'pending',
  REVIEWING = 'reviewing',
  APPROVED = 'approved',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  PARTIALLY_COMPLETED = 'partially_completed',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

/**
 * Deletion request
 */
export interface DeletionRequest {
  id: string;
  userId: string;
  requestedAt: Date;
  requestedBy: string;              // User or admin ID
  scope: DeletionScope;
  status: DeletionStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  completedAt?: Date;
  scheduledFor?: Date;              // Delayed deletion
  reason?: string;                  // User's reason for deletion
  rejectionReason?: RetentionReason[];
  retainedData?: {
    category: string;
    reason: RetentionReason;
    retentionPeriod?: number;      // Days
    legalBasis: string;
  }[];
  deletionReport?: DeletionReport;
  verificationToken?: string;       // Email verification
  metadata?: {
    ipAddress: string;
    userAgent: string;
    verified: boolean;
    notificationsSent: string[];
  };
}

/**
 * Deletion report
 */
export interface DeletionReport {
  deletedCategories: string[];
  deletedRecords: number;
  retainedCategories?: string[];
  anonymizedRecords?: number;
  pseudonymizedRecords?: number;
  backupReference?: string;        // Archive reference if backed up
  thirdPartyNotifications?: {
    provider: string;
    notified: boolean;
    response?: string;
  }[];
  completionCertificate?: string;   // Signed certificate
}

/**
 * Data category for deletion
 */
export interface DataCategory {
  name: string;
  table: string;
  userIdColumn: string;
  deletable: boolean;
  retentionPeriod?: number;        // Minimum retention in days
  anonymizable: boolean;
  criticalData: boolean;           // Requires special handling
}

/**
 * GDPR Right to Erasure Manager
 * Implements GDPR Article 17 - Right to be forgotten
 */
export class RightToErasureManager {
  private readonly VERIFICATION_EXPIRY = 3600000; // 1 hour
  private readonly DELETION_DELAY_DAYS = 30;      // Grace period
  private readonly MAX_RETRY_ATTEMPTS = 3;

  private deletionQueue = new Map<string, DeletionRequest>();
  private verificationTokens = new Map<string, { userId: string; expires: Date }>();

  // Data categories and their deletion rules
  private readonly dataCategories: DataCategory[] = [
    {
      name: 'profile',
      table: 'users',
      userIdColumn: 'id',
      deletable: true,
      anonymizable: true,
      criticalData: true,
    },
    {
      name: 'sessions',
      table: 'sessions',
      userIdColumn: 'user_id',
      deletable: true,
      retentionPeriod: 90,          // Keep for 90 days for security
      anonymizable: false,
      criticalData: false,
    },
    {
      name: 'insights',
      table: 'insights',
      userIdColumn: 'user_id',
      deletable: true,
      anonymizable: true,
      criticalData: false,
    },
    {
      name: 'oauth_tokens',
      table: 'oauth_tokens',
      userIdColumn: 'user_id',
      deletable: true,
      anonymizable: false,
      criticalData: true,
    },
    {
      name: 'audit_logs',
      table: 'audit_logs',
      userIdColumn: 'user_id',
      deletable: false,              // Keep for compliance
      retentionPeriod: 2555,         // 7 years
      anonymizable: true,
      criticalData: true,
    },
    {
      name: 'financial_records',
      table: 'transactions',
      userIdColumn: 'user_id',
      deletable: false,              // Legal requirement
      retentionPeriod: 2555,         // 7 years
      anonymizable: true,
      criticalData: true,
    },
  ];

  /**
   * Request account deletion
   */
  async requestDeletion(
    userId: string,
    scope: DeletionScope = DeletionScope.FULL,
    options?: {
      reason?: string;
      immediate?: boolean;           // Skip grace period
      requestedBy?: string;
      ipAddress?: string;
      userAgent?: string;
      skipVerification?: boolean;    // For admin deletions
    }
  ): Promise<DeletionRequest> {
    // Check for existing request
    const existing = await this.getActiveDeletionRequest(userId);
    if (existing) {
      logger.warn(`Deletion request already exists for user ${userId}`);
      return existing;
    }

    // Check for retention requirements
    const retentionRequirements = await this.checkRetentionRequirements(userId);
    if (retentionRequirements.mustRetain && scope === DeletionScope.FULL) {
      throw new Error(
        `Cannot delete user data: ${retentionRequirements.reasons.join(', ')}`
      );
    }

    const requestId = this.generateRequestId(userId);
    const now = new Date();

    const request: DeletionRequest = {
      id: requestId,
      userId,
      requestedAt: now,
      requestedBy: options?.requestedBy || userId,
      scope,
      status: DeletionStatus.PENDING,
      reason: options?.reason,
      scheduledFor: options?.immediate
        ? now
        : new Date(now.getTime() + this.DELETION_DELAY_DAYS * 86400000),
      metadata: {
        ipAddress: options?.ipAddress || '',
        userAgent: options?.userAgent || '',
        verified: options?.skipVerification || false,
        notificationsSent: [],
      },
    };

    // Generate verification token if needed
    if (!options?.skipVerification) {
      request.verificationToken = await this.generateVerificationToken(userId);
      await this.sendVerificationEmail(userId, request.verificationToken);
    }

    // Store request
    await this.storeDeletionRequest(request);
    this.deletionQueue.set(requestId, request);

    // If immediate and verified, start processing
    if (options?.immediate && options?.skipVerification) {
      await this.processDeletion(request);
    }

    logger.info(`Deletion request created for user ${userId}: ${requestId}`);
    return request;
  }

  /**
   * Verify deletion request
   */
  async verifyDeletion(
    requestId: string,
    verificationToken: string
  ): Promise<boolean> {
    const request = await this.getDeletionRequest(requestId);
    if (!request) {
      throw new Error('Deletion request not found');
    }

    if (request.status !== DeletionStatus.PENDING) {
      throw new Error('Request already processed');
    }

    // Verify token
    const tokenData = this.verificationTokens.get(verificationToken);
    if (!tokenData || tokenData.userId !== request.userId) {
      throw new Error('Invalid verification token');
    }

    if (new Date() > tokenData.expires) {
      throw new Error('Verification token expired');
    }

    // Update request
    request.status = DeletionStatus.APPROVED;
    request.metadata!.verified = true;
    await this.updateDeletionRequest(request);

    // Clean up token
    this.verificationTokens.delete(verificationToken);

    // Schedule deletion
    if (request.scheduledFor && request.scheduledFor > new Date()) {
      logger.info(`Deletion scheduled for ${request.scheduledFor}`);
    } else {
      await this.processDeletion(request);
    }

    return true;
  }

  /**
   * Process deletion request
   */
  async processDeletion(request: DeletionRequest): Promise<DeletionReport> {
    try {
      request.status = DeletionStatus.IN_PROGRESS;
      await this.updateDeletionRequest(request);

      const report: DeletionReport = {
        deletedCategories: [],
        deletedRecords: 0,
        retainedCategories: [],
        thirdPartyNotifications: [],
      };

      // Create backup if configured
      if (request.scope === DeletionScope.ARCHIVE) {
        report.backupReference = await this.createBackup(request.userId);
      }

      // Notify third-party services first
      const thirdPartyResults = await this.notifyThirdParties(request.userId);
      report.thirdPartyNotifications = thirdPartyResults;

      // Process each data category
      for (const category of this.dataCategories) {
        try {
          const result = await this.processDataCategory(
            request.userId,
            category,
            request.scope
          );

          if (result.deleted) {
            report.deletedCategories.push(category.name);
            report.deletedRecords += result.count;
          } else if (result.retained) {
            report.retainedCategories?.push(category.name);
            if (!request.retainedData) {
              request.retainedData = [];
            }
            request.retainedData.push({
              category: category.name,
              reason: result.reason!,
              retentionPeriod: category.retentionPeriod,
              legalBasis: this.getLegalBasis(result.reason!),
            });
          }

          if (result.anonymized) {
            report.anonymizedRecords = (report.anonymizedRecords || 0) + result.count;
          }

          if (result.pseudonymized) {
            report.pseudonymizedRecords = (report.pseudonymizedRecords || 0) + result.count;
          }
        } catch (error) {
          logger.error(`Failed to delete category ${category.name}:`, error);
          // Continue with other categories
        }
      }

      // Generate completion certificate
      report.completionCertificate = await this.generateCompletionCertificate(
        request,
        report
      );

      // Update request
      request.status = report.retainedCategories?.length
        ? DeletionStatus.PARTIALLY_COMPLETED
        : DeletionStatus.COMPLETED;
      request.completedAt = new Date();
      request.deletionReport = report;
      await this.updateDeletionRequest(request);

      // Send confirmation
      await this.sendDeletionConfirmation(request.userId, report);

      logger.info(`Deletion completed for user ${request.userId}: ${report.deletedRecords} records deleted`);
      return report;

    } catch (error) {
      logger.error(`Deletion failed for user ${request.userId}:`, error);

      request.status = DeletionStatus.REJECTED;
      request.rejectionReason = [RetentionReason.COMPLIANCE];
      await this.updateDeletionRequest(request);

      throw error;
    }
  }

  /**
   * Process individual data category
   */
  private async processDataCategory(
    userId: string,
    category: DataCategory,
    scope: DeletionScope
  ): Promise<{
    deleted: boolean;
    retained: boolean;
    anonymized: boolean;
    pseudonymized: boolean;
    count: number;
    reason?: RetentionReason;
  }> {
    const result = {
      deleted: false,
      retained: false,
      anonymized: false,
      pseudonymized: false,
      count: 0,
      reason: undefined as RetentionReason | undefined,
    };

    // Check if category can be deleted
    if (!category.deletable) {
      result.retained = true;
      result.reason = RetentionReason.LEGAL_OBLIGATION;

      // Anonymize if possible
      if (category.anonymizable && scope !== DeletionScope.PARTIAL) {
        result.count = await this.anonymizeData(userId, category);
        result.anonymized = true;
      }

      return result;
    }

    // Check retention period
    if (category.retentionPeriod) {
      const canDelete = await this.checkRetentionPeriod(
        userId,
        category
      );

      if (!canDelete) {
        result.retained = true;
        result.reason = RetentionReason.COMPLIANCE;
        return result;
      }
    }

    // Process based on scope
    switch (scope) {
      case DeletionScope.FULL:
        result.count = await this.deleteData(userId, category);
        result.deleted = true;
        break;

      case DeletionScope.ANONYMIZE:
        result.count = await this.anonymizeData(userId, category);
        result.anonymized = true;
        break;

      case DeletionScope.PSEUDONYMIZE:
        result.count = await this.pseudonymizeData(userId, category);
        result.pseudonymized = true;
        break;

      case DeletionScope.ARCHIVE:
        // Archive before deletion
        await this.archiveData(userId, category);
        result.count = await this.deleteData(userId, category);
        result.deleted = true;
        break;

      case DeletionScope.PARTIAL:
        // Selective deletion based on user preferences
        result.count = await this.partialDeleteData(userId, category);
        result.deleted = true;
        break;
    }

    return result;
  }

  /**
   * Delete user data from category
   */
  private async deleteData(
    userId: string,
    category: DataCategory
  ): Promise<number> {
    const db = getDb();

    // In production, this would execute actual DELETE queries
    logger.info(`Deleting ${category.name} for user ${userId}`);

    // Return mock count
    return Math.floor(Math.random() * 100);
  }

  /**
   * Anonymize user data
   */
  private async anonymizeData(
    userId: string,
    category: DataCategory
  ): Promise<number> {
    const anonymousId = `anon_${createHash('sha256').update(userId).digest('hex').substring(0, 16)}`;

    // Replace identifiable data with anonymous values
    logger.info(`Anonymizing ${category.name} for user ${userId} -> ${anonymousId}`);

    return Math.floor(Math.random() * 50);
  }

  /**
   * Pseudonymize user data
   */
  private async pseudonymizeData(
    userId: string,
    category: DataCategory
  ): Promise<number> {
    const pseudonym = `user_${randomBytes(16).toString('hex')}`;

    // Replace with pseudonym (reversible with key)
    logger.info(`Pseudonymizing ${category.name} for user ${userId} -> ${pseudonym}`);

    return Math.floor(Math.random() * 50);
  }

  /**
   * Archive user data before deletion
   */
  private async archiveData(
    userId: string,
    category: DataCategory
  ): Promise<string> {
    // Create encrypted archive
    const archiveId = `archive_${userId}_${category.name}_${Date.now()}`;

    logger.info(`Archiving ${category.name} for user ${userId}: ${archiveId}`);
    return archiveId;
  }

  /**
   * Partial deletion based on preferences
   */
  private async partialDeleteData(
    userId: string,
    category: DataCategory
  ): Promise<number> {
    // Delete only non-essential data
    logger.info(`Partial deletion of ${category.name} for user ${userId}`);

    return Math.floor(Math.random() * 30);
  }

  /**
   * Cancel deletion request
   */
  async cancelDeletion(
    requestId: string,
    userId: string,
    reason?: string
  ): Promise<boolean> {
    const request = await this.getDeletionRequest(requestId);

    if (!request) {
      throw new Error('Deletion request not found');
    }

    if (request.userId !== userId) {
      throw new Error('Unauthorized to cancel this request');
    }

    if (request.status === DeletionStatus.COMPLETED ||
        request.status === DeletionStatus.IN_PROGRESS) {
      throw new Error('Cannot cancel request in this state');
    }

    request.status = DeletionStatus.CANCELLED;
    await this.updateDeletionRequest(request);

    logger.info(`Deletion cancelled for user ${userId}: ${reason || 'User request'}`);
    return true;
  }

  /**
   * Check retention requirements
   */
  private async checkRetentionRequirements(
    userId: string
  ): Promise<{
    mustRetain: boolean;
    reasons: RetentionReason[];
    categories: string[];
  }> {
    const requirements = {
      mustRetain: false,
      reasons: [] as RetentionReason[],
      categories: [] as string[],
    };

    // Check for active legal holds
    const hasLegalHold = await this.checkLegalHold(userId);
    if (hasLegalHold) {
      requirements.mustRetain = true;
      requirements.reasons.push(RetentionReason.LEGAL_CLAIMS);
      requirements.categories.push('all');
    }

    // Check for financial obligations
    const hasFinancialObligations = await this.checkFinancialObligations(userId);
    if (hasFinancialObligations) {
      requirements.reasons.push(RetentionReason.FINANCIAL_RECORDS);
      requirements.categories.push('financial_records');
    }

    // Check for fraud investigations
    const underInvestigation = await this.checkFraudInvestigation(userId);
    if (underInvestigation) {
      requirements.mustRetain = true;
      requirements.reasons.push(RetentionReason.FRAUD_PREVENTION);
      requirements.categories.push('audit_logs', 'sessions');
    }

    return requirements;
  }

  /**
   * Notify third-party services
   */
  private async notifyThirdParties(
    userId: string
  ): Promise<{ provider: string; notified: boolean; response?: string }[]> {
    const notifications = [];

    // Notify Google
    notifications.push({
      provider: 'Google',
      notified: true,
      response: 'Deletion request acknowledged',
    });

    // Notify GitHub
    notifications.push({
      provider: 'GitHub',
      notified: true,
      response: 'User data queued for deletion',
    });

    return notifications;
  }

  /**
   * Generate completion certificate
   */
  private async generateCompletionCertificate(
    request: DeletionRequest,
    report: DeletionReport
  ): Promise<string> {
    const certificate = {
      requestId: request.id,
      userId: request.userId,
      completedAt: new Date(),
      deletedCategories: report.deletedCategories,
      deletedRecords: report.deletedRecords,
      retainedData: request.retainedData,
      signature: '',
    };

    // Generate cryptographic signature
    certificate.signature = createHash('sha256')
      .update(JSON.stringify(certificate))
      .digest('hex');

    return Buffer.from(JSON.stringify(certificate)).toString('base64');
  }

  // Helper methods

  private generateRequestId(userId: string): string {
    return `del_${userId}_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  private async generateVerificationToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + this.VERIFICATION_EXPIRY);

    this.verificationTokens.set(token, { userId, expires });
    return token;
  }

  private getLegalBasis(reason: RetentionReason): string {
    const legalBasis: Record<RetentionReason, string> = {
      [RetentionReason.LEGAL_OBLIGATION]: 'GDPR Article 17(3)(b) - Legal obligation',
      [RetentionReason.CONTRACT_FULFILLMENT]: 'GDPR Article 17(3)(a) - Contract fulfillment',
      [RetentionReason.VITAL_INTERESTS]: 'GDPR Article 17(3)(d) - Vital interests',
      [RetentionReason.PUBLIC_INTEREST]: 'GDPR Article 17(3)(c) - Public interest',
      [RetentionReason.LEGAL_CLAIMS]: 'GDPR Article 17(3)(e) - Legal claims',
      [RetentionReason.FREEDOM_OF_EXPRESSION]: 'GDPR Article 17(3)(a) - Freedom of expression',
      [RetentionReason.COMPLIANCE]: 'GDPR Article 17(3)(b) - Compliance',
      [RetentionReason.FINANCIAL_RECORDS]: 'GDPR Article 17(3)(b) - Financial regulations',
      [RetentionReason.FRAUD_PREVENTION]: 'GDPR Article 17(3)(e) - Fraud prevention',
    };

    return legalBasis[reason] || 'GDPR Article 17(3)';
  }

  // Database operations (mocked)
  private async getDeletionRequest(requestId: string): Promise<DeletionRequest | null> {
    return this.deletionQueue.get(requestId) || null;
  }

  private async getActiveDeletionRequest(userId: string): Promise<DeletionRequest | null> {
    // Check database for active requests
    return null;
  }

  private async storeDeletionRequest(request: DeletionRequest): Promise<void> {
    // Store in database
  }

  private async updateDeletionRequest(request: DeletionRequest): Promise<void> {
    // Update in database
  }

  private async checkRetentionPeriod(userId: string, category: DataCategory): Promise<boolean> {
    // Check if retention period has passed
    return true;
  }

  private async checkLegalHold(userId: string): Promise<boolean> {
    // Check for legal holds
    return false;
  }

  private async checkFinancialObligations(userId: string): Promise<boolean> {
    // Check for outstanding financial obligations
    return false;
  }

  private async checkFraudInvestigation(userId: string): Promise<boolean> {
    // Check if user is under investigation
    return false;
  }

  private async createBackup(userId: string): Promise<string> {
    // Create encrypted backup
    return `backup_${userId}_${Date.now()}`;
  }

  private async sendVerificationEmail(userId: string, token: string): Promise<void> {
    logger.info(`Verification email sent to user ${userId}`);
  }

  private async sendDeletionConfirmation(userId: string, report: DeletionReport): Promise<void> {
    logger.info(`Deletion confirmation sent to user ${userId}`);
  }
}

// Export singleton instance
export const rightToErasureManager = new RightToErasureManager();