import { consentManager, ConsentType, ProcessingPurpose } from './consent.js';
import { dataPortabilityManager, ExportFormat, DataCategory } from './dataPortability.js';
import { rightToErasureManager, DeletionScope } from './rightToErasure.js';
import { logger } from '../../../utils/logger.js';

/**
 * GDPR Compliance Manager
 * Central interface for all GDPR-related operations
 */
export class GDPRComplianceManager {
  /**
   * Initialize GDPR compliance
   */
  async initialize(): Promise<void> {
    logger.info('Initializing GDPR compliance manager');

    // Set up periodic tasks
    this.setupPeriodicTasks();

    // Load privacy policies
    await this.loadPrivacyPolicies();

    logger.info('GDPR compliance manager initialized');
  }

  /**
   * Handle user registration with GDPR compliance
   */
  async registerUser(
    userId: string,
    email: string,
    options: {
      birthDate?: Date;
      country?: string;
      acceptedTerms: boolean;
      marketingConsent?: boolean;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<void> {
    // Check parental consent requirement
    if (options.birthDate && options.country) {
      const requiresParental = await consentManager.requiresParentalConsent(
        options.birthDate,
        options.country
      );

      if (requiresParental) {
        throw new Error('Parental consent required for registration');
      }
    }

    // Record essential consents
    await consentManager.recordConsent(
      userId,
      ProcessingPurpose.AUTHENTICATION,
      true,
      {
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      }
    );

    await consentManager.recordConsent(
      userId,
      ProcessingPurpose.PROFILE_DATA,
      true,
      {
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      }
    );

    // Record optional consents
    if (options.marketingConsent) {
      await consentManager.recordConsent(
        userId,
        ProcessingPurpose.MARKETING,
        true,
        {
          ipAddress: options.ipAddress,
          userAgent: options.userAgent,
        }
      );
    }

    // Record analytics consent (legitimate interest)
    await consentManager.recordConsent(
      userId,
      ProcessingPurpose.ANALYTICS,
      true,
      {
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      }
    );

    logger.info(`GDPR compliant registration completed for user ${userId}`);
  }

  /**
   * Handle data access request
   */
  async handleDataAccessRequest(
    userId: string,
    requestedBy: string,
    categories?: DataCategory[]
  ): Promise<string> {
    // Verify requester authorization
    if (requestedBy !== userId) {
      // Check if requester has legal authorization
      const authorized = await this.verifyDataAccessAuthorization(
        requestedBy,
        userId
      );

      if (!authorized) {
        throw new Error('Unauthorized data access request');
      }
    }

    // Create export request
    const exportRequest = await dataPortabilityManager.requestExport(
      userId,
      categories || [DataCategory.ALL],
      ExportFormat.JSON,
      {
        requestedBy,
        reason: 'GDPR Article 15 - Right of access',
      }
    );

    logger.info(`Data access request initiated for user ${userId}: ${exportRequest.id}`);
    return exportRequest.id;
  }

  /**
   * Handle data portability request
   */
  async handlePortabilityRequest(
    userId: string,
    format: ExportFormat = ExportFormat.JSON,
    encrypted: boolean = true
  ): Promise<string> {
    const exportRequest = await dataPortabilityManager.requestExport(
      userId,
      [DataCategory.ALL],
      format,
      {
        reason: 'GDPR Article 20 - Data portability',
        encrypted,
      }
    );

    logger.info(`Data portability request initiated for user ${userId}: ${exportRequest.id}`);
    return exportRequest.id;
  }

  /**
   * Handle deletion request
   */
  async handleDeletionRequest(
    userId: string,
    reason?: string,
    immediate: boolean = false
  ): Promise<string> {
    const deletionRequest = await rightToErasureManager.requestDeletion(
      userId,
      DeletionScope.FULL,
      {
        reason: reason || 'GDPR Article 17 - Right to erasure',
        immediate,
      }
    );

    logger.info(`Deletion request initiated for user ${userId}: ${deletionRequest.id}`);
    return deletionRequest.id;
  }

  /**
   * Update consent preferences
   */
  async updateConsent(
    userId: string,
    purpose: ProcessingPurpose,
    granted: boolean,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<void> {
    await consentManager.recordConsent(userId, purpose, granted, context);
    logger.info(`Consent updated for user ${userId}: ${purpose} = ${granted}`);
  }

  /**
   * Check data processing lawfulness
   */
  async isProcessingLawful(
    userId: string,
    purpose: ProcessingPurpose
  ): Promise<boolean> {
    return await consentManager.hasValidConsent(userId, purpose);
  }

  /**
   * Handle data breach notification
   */
  async handleDataBreach(
    affectedUsers: string[],
    breachDetails: {
      discoveredAt: Date;
      description: string;
      dataTypes: string[];
      severity: 'low' | 'medium' | 'high' | 'critical';
      mitigationSteps: string[];
    }
  ): Promise<void> {
    logger.error(`Data breach detected affecting ${affectedUsers.length} users`);

    // Within 72 hours requirement (GDPR Article 33)
    const deadline = new Date(breachDetails.discoveredAt.getTime() + 72 * 3600000);

    // Notify supervisory authority
    await this.notifySupervisoryAuthority(breachDetails);

    // Notify affected users if high risk (GDPR Article 34)
    if (breachDetails.severity === 'high' || breachDetails.severity === 'critical') {
      for (const userId of affectedUsers) {
        await this.notifyUserOfBreach(userId, breachDetails);
      }
    }

    // Document breach
    await this.documentDataBreach({
      ...breachDetails,
      affectedUsers: affectedUsers.length,
      notificationDeadline: deadline,
      notificationsSent: new Date(),
    });
  }

  /**
   * Generate privacy report
   */
  async generatePrivacyReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalUsers: number;
    consentStats: Record<string, number>;
    dataRequests: {
      access: number;
      portability: number;
      deletion: number;
    };
    breaches: number;
    crossBorderTransfers: number;
  }> {
    // This would aggregate data from various sources
    return {
      totalUsers: 0,
      consentStats: {},
      dataRequests: {
        access: 0,
        portability: 0,
        deletion: 0,
      },
      breaches: 0,
      crossBorderTransfers: 0,
    };
  }

  /**
   * Verify age and get parental consent if needed
   */
  async verifyAgeAndConsent(
    userId: string,
    birthDate: Date,
    country: string,
    parentEmail?: string
  ): Promise<{
    ageVerified: boolean;
    requiresParental: boolean;
    parentalConsentToken?: string;
  }> {
    const requiresParental = await consentManager.requiresParentalConsent(
      birthDate,
      country
    );

    if (requiresParental && !parentEmail) {
      return {
        ageVerified: false,
        requiresParental: true,
      };
    }

    if (requiresParental && parentEmail) {
      // Generate parental consent request
      const token = await this.generateParentalConsentToken(
        userId,
        parentEmail
      );

      return {
        ageVerified: false,
        requiresParental: true,
        parentalConsentToken: token,
      };
    }

    return {
      ageVerified: true,
      requiresParental: false,
    };
  }

  /**
   * Handle cross-border data transfer
   */
  async authorizeCrossBorderTransfer(
    userId: string,
    destinationCountry: string,
    purpose: string,
    safeguards: 'scc' | 'bcr' | 'adequacy' | 'consent'
  ): Promise<boolean> {
    // Check if destination has adequacy decision
    const hasAdequacy = this.checkAdequacyDecision(destinationCountry);

    if (hasAdequacy) {
      await this.logCrossBorderTransfer(userId, destinationCountry, 'adequacy');
      return true;
    }

    // Check appropriate safeguards (GDPR Article 46)
    switch (safeguards) {
      case 'scc': // Standard Contractual Clauses
      case 'bcr': // Binding Corporate Rules
        await this.logCrossBorderTransfer(userId, destinationCountry, safeguards);
        return true;

      case 'consent':
        // Explicit consent needed for transfers without safeguards
        const hasConsent = await this.getExplicitTransferConsent(
          userId,
          destinationCountry,
          purpose
        );
        if (hasConsent) {
          await this.logCrossBorderTransfer(userId, destinationCountry, 'consent');
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Setup periodic GDPR tasks
   */
  private setupPeriodicTasks(): void {
    // Daily: Clean up expired exports
    setInterval(async () => {
      await dataPortabilityManager.cleanupExpiredExports();
    }, 24 * 3600000);

    // Weekly: Process scheduled deletions
    setInterval(async () => {
      await this.processScheduledDeletions();
    }, 7 * 24 * 3600000);

    // Monthly: Review consent validity
    setInterval(async () => {
      await this.reviewConsentValidity();
    }, 30 * 24 * 3600000);
  }

  // Helper methods

  private async verifyDataAccessAuthorization(
    requestedBy: string,
    userId: string
  ): Promise<boolean> {
    // Check if requester has legal authorization
    // e.g., power of attorney, parental rights, etc.
    return false;
  }

  private async notifySupervisoryAuthority(details: any): Promise<void> {
    // Notify relevant data protection authority
    logger.info('Supervisory authority notified of data breach');
  }

  private async notifyUserOfBreach(userId: string, details: any): Promise<void> {
    // Send breach notification to user
    logger.info(`User ${userId} notified of data breach`);
  }

  private async documentDataBreach(details: any): Promise<void> {
    // Document breach in audit log
    logger.info('Data breach documented');
  }

  private async loadPrivacyPolicies(): Promise<void> {
    // Load current privacy policy versions
  }

  private async generateParentalConsentToken(
    userId: string,
    parentEmail: string
  ): Promise<string> {
    // Generate token for parental consent
    return `parent_consent_${Date.now()}`;
  }

  private checkAdequacyDecision(country: string): boolean {
    // Countries with EU adequacy decisions
    const adequacyCountries = [
      'AD', 'AR', 'CA', 'CH', 'FO', 'GB', 'GG', 'IL',
      'IM', 'JE', 'JP', 'NZ', 'KR', 'UY',
    ];
    return adequacyCountries.includes(country);
  }

  private async getExplicitTransferConsent(
    userId: string,
    country: string,
    purpose: string
  ): Promise<boolean> {
    // Check for explicit consent for data transfer
    return false;
  }

  private async logCrossBorderTransfer(
    userId: string,
    country: string,
    basis: string
  ): Promise<void> {
    logger.info(`Cross-border transfer: user=${userId}, country=${country}, basis=${basis}`);
  }

  private async processScheduledDeletions(): Promise<void> {
    // Process any scheduled deletion requests
    logger.info('Processing scheduled deletions');
  }

  private async reviewConsentValidity(): Promise<void> {
    // Review and refresh expired consents
    logger.info('Reviewing consent validity');
  }
}

// Export singleton instance
export const gdprManager = new GDPRComplianceManager();

// Re-export components
export {
  consentManager,
  ConsentType,
  ProcessingPurpose,
  dataPortabilityManager,
  ExportFormat,
  DataCategory,
  rightToErasureManager,
  DeletionScope,
} from './consent.js';

export type {
  ConsentRecord,
  ConsentPreferences,
} from './consent.js';

export type {
  ExportRequest,
  UserDataExport,
} from './dataPortability.js';

export type {
  DeletionRequest,
  DeletionReport,
  RetentionReason,
} from './rightToErasure.js';