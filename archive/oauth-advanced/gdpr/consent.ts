import { logger } from '../../../utils/logger.js';
import { getDb } from '../../../db/client.js';
import { createHash } from 'crypto';

/**
 * Consent types as per GDPR Article 6
 */
export enum ConsentType {
  // Lawful basis for processing
  NECESSARY = 'necessary',           // Contract fulfillment
  LEGITIMATE_INTEREST = 'legitimate', // Legitimate business interest
  CONSENT = 'consent',               // Explicit user consent
  LEGAL_OBLIGATION = 'legal',        // Legal requirement
  VITAL_INTERESTS = 'vital',         // Protect vital interests
  PUBLIC_TASK = 'public',            // Public interest task
}

/**
 * Processing purposes requiring consent
 */
export enum ProcessingPurpose {
  AUTHENTICATION = 'authentication',
  PROFILE_DATA = 'profile_data',
  ANALYTICS = 'analytics',
  MARKETING = 'marketing',
  THIRD_PARTY_SHARING = 'third_party',
  DATA_RETENTION = 'data_retention',
  COOKIES = 'cookies',
  LOCATION = 'location',
  BIOMETRIC = 'biometric',
  HEALTH_DATA = 'health_data', // Special category data
}

/**
 * Consent record structure
 */
export interface ConsentRecord {
  id: string;
  userId: string;
  purpose: ProcessingPurpose;
  lawfulBasis: ConsentType;
  granted: boolean;
  grantedAt?: Date;
  revokedAt?: Date;
  expiresAt?: Date;
  version: string;
  ipAddress?: string;
  userAgent?: string;
  parentalConsent?: boolean; // For users under 16 (EU) or 13 (US)
  metadata?: {
    consentText: string;
    privacyPolicyVersion: string;
    termsVersion: string;
    language: string;
    channel: 'web' | 'mobile' | 'api';
  };
}

/**
 * Consent preferences
 */
export interface ConsentPreferences {
  userId: string;
  consents: Map<ProcessingPurpose, ConsentRecord>;
  globalOptOut: boolean;
  communicationPreferences: {
    email: boolean;
    sms: boolean;
    push: boolean;
    phone: boolean;
  };
  dataRetentionPeriod?: number; // Days
  lastUpdated: Date;
}

/**
 * GDPR Consent Manager
 * Manages user consent per GDPR Articles 6, 7, and 8
 */
export class ConsentManager {
  private readonly CONSENT_VERSION = '2.0.0';
  private readonly PRIVACY_POLICY_VERSION = '1.5.0';
  private readonly MINIMUM_AGE_EU = 16;
  private readonly MINIMUM_AGE_US = 13;
  private readonly CONSENT_EXPIRY_DAYS = 365; // Re-consent annually

  // In-memory cache for frequently accessed consents
  private consentCache = new Map<string, ConsentPreferences>();
  private readonly CACHE_TTL = 300000; // 5 minutes

  /**
   * Record user consent
   */
  async recordConsent(
    userId: string,
    purpose: ProcessingPurpose,
    granted: boolean,
    options?: {
      ipAddress?: string;
      userAgent?: string;
      parentalConsent?: boolean;
      expiryDays?: number;
      metadata?: ConsentRecord['metadata'];
    }
  ): Promise<ConsentRecord> {
    const consentId = this.generateConsentId(userId, purpose);
    const now = new Date();

    const record: ConsentRecord = {
      id: consentId,
      userId,
      purpose,
      lawfulBasis: this.determineLawfulBasis(purpose),
      granted,
      grantedAt: granted ? now : undefined,
      revokedAt: !granted ? now : undefined,
      expiresAt: granted && options?.expiryDays
        ? new Date(now.getTime() + options.expiryDays * 86400000)
        : new Date(now.getTime() + this.CONSENT_EXPIRY_DAYS * 86400000),
      version: this.CONSENT_VERSION,
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
      parentalConsent: options?.parentalConsent,
      metadata: options?.metadata || {
        consentText: this.getConsentText(purpose),
        privacyPolicyVersion: this.PRIVACY_POLICY_VERSION,
        termsVersion: '1.0.0',
        language: 'en',
        channel: 'web',
      },
    };

    // Store in database
    await this.storeConsentRecord(record);

    // Invalidate cache
    this.consentCache.delete(userId);

    // Log consent event for audit
    logger.info(`Consent ${granted ? 'granted' : 'revoked'} for user ${userId}, purpose: ${purpose}`);

    // Send confirmation if required
    if (this.requiresConfirmation(purpose)) {
      await this.sendConsentConfirmation(userId, record);
    }

    return record;
  }

  /**
   * Bulk consent update
   */
  async updateBulkConsent(
    userId: string,
    consents: Map<ProcessingPurpose, boolean>,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<ConsentPreferences> {
    const records: ConsentRecord[] = [];

    for (const [purpose, granted] of consents) {
      const record = await this.recordConsent(userId, purpose, granted, context);
      records.push(record);
    }

    return this.getUserConsents(userId);
  }

  /**
   * Check if user has valid consent for purpose
   */
  async hasValidConsent(
    userId: string,
    purpose: ProcessingPurpose
  ): Promise<boolean> {
    // Check cache first
    const cached = this.consentCache.get(userId);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.CACHE_TTL) {
      const consent = cached.consents.get(purpose);
      if (consent) {
        return this.isConsentValid(consent);
      }
    }

    // Some purposes don't require explicit consent
    const lawfulBasis = this.determineLawfulBasis(purpose);
    if (lawfulBasis === ConsentType.NECESSARY ||
        lawfulBasis === ConsentType.LEGITIMATE_INTEREST) {
      return true; // These don't require explicit consent
    }

    // Load from database
    const consents = await this.getUserConsents(userId);
    const consent = consents.consents.get(purpose);

    if (!consent) {
      return false;
    }

    return this.isConsentValid(consent);
  }

  /**
   * Get all user consents
   */
  async getUserConsents(userId: string): Promise<ConsentPreferences> {
    // Check cache
    const cached = this.consentCache.get(userId);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.CACHE_TTL) {
      return cached;
    }

    // Load from database
    const records = await this.loadUserConsents(userId);

    const preferences: ConsentPreferences = {
      userId,
      consents: new Map(records.map(r => [r.purpose, r])),
      globalOptOut: false, // Would check database
      communicationPreferences: {
        email: true,
        sms: false,
        push: true,
        phone: false,
      },
      lastUpdated: new Date(),
    };

    // Cache the result
    this.consentCache.set(userId, preferences);

    return preferences;
  }

  /**
   * Withdraw consent
   */
  async withdrawConsent(
    userId: string,
    purpose: ProcessingPurpose,
    reason?: string
  ): Promise<void> {
    await this.recordConsent(userId, purpose, false, {
      metadata: {
        consentText: `Consent withdrawn: ${reason || 'User request'}`,
        privacyPolicyVersion: this.PRIVACY_POLICY_VERSION,
        termsVersion: '1.0.0',
        language: 'en',
        channel: 'web',
      },
    });

    // Trigger data deletion if required
    if (this.requiresDataDeletion(purpose)) {
      await this.triggerDataDeletion(userId, purpose);
    }

    logger.info(`Consent withdrawn for user ${userId}, purpose: ${purpose}`);
  }

  /**
   * Withdraw all consents (global opt-out)
   */
  async withdrawAllConsents(userId: string): Promise<void> {
    const purposes = Object.values(ProcessingPurpose);

    for (const purpose of purposes) {
      // Skip necessary processing
      if (this.determineLawfulBasis(purpose) !== ConsentType.NECESSARY) {
        await this.withdrawConsent(userId, purpose, 'Global opt-out');
      }
    }

    logger.info(`All consents withdrawn for user ${userId}`);
  }

  /**
   * Check parental consent requirement
   */
  async requiresParentalConsent(
    birthDate: Date,
    country: string
  ): Promise<boolean> {
    const age = this.calculateAge(birthDate);

    // EU countries require parental consent under 16
    if (this.isEUCountry(country)) {
      return age < this.MINIMUM_AGE_EU;
    }

    // US requires parental consent under 13 (COPPA)
    if (country === 'US') {
      return age < this.MINIMUM_AGE_US;
    }

    // Default to EU standard
    return age < this.MINIMUM_AGE_EU;
  }

  /**
   * Verify parental consent
   */
  async verifyParentalConsent(
    childUserId: string,
    parentEmail: string,
    verificationCode: string
  ): Promise<boolean> {
    // In production, this would verify the parent's identity
    // and their authorization to consent for the child

    const verified = await this.checkParentalVerification(
      parentEmail,
      verificationCode
    );

    if (verified) {
      // Update all child's consents with parental approval
      const consents = await this.getUserConsents(childUserId);

      for (const [purpose, record] of consents.consents) {
        record.parentalConsent = true;
        await this.storeConsentRecord(record);
      }

      logger.info(`Parental consent verified for child user ${childUserId}`);
      return true;
    }

    return false;
  }

  /**
   * Generate consent request for special category data
   */
  async requestSpecialCategoryConsent(
    userId: string,
    dataTypes: string[],
    justification: string
  ): Promise<string> {
    // Special category data requires explicit consent
    // This includes: racial/ethnic origin, political opinions,
    // religious beliefs, trade union membership, genetic data,
    // biometric data, health data, sex life, sexual orientation

    const requestId = crypto.randomUUID();

    await this.storeSpecialConsentRequest({
      requestId,
      userId,
      dataTypes,
      justification,
      status: 'pending',
      createdAt: new Date(),
    });

    logger.info(`Special category consent requested for user ${userId}: ${dataTypes.join(', ')}`);

    return requestId;
  }

  /**
   * Export consent history for data portability
   */
  async exportConsentHistory(userId: string): Promise<{
    consents: ConsentRecord[];
    preferences: ConsentPreferences;
    exportDate: Date;
  }> {
    const consents = await this.loadAllUserConsentHistory(userId);
    const preferences = await this.getUserConsents(userId);

    return {
      consents,
      preferences,
      exportDate: new Date(),
    };
  }

  /**
   * Check consent validity
   */
  private isConsentValid(consent: ConsentRecord): boolean {
    if (!consent.granted) {
      return false;
    }

    if (consent.revokedAt) {
      return false;
    }

    if (consent.expiresAt && new Date() > consent.expiresAt) {
      return false;
    }

    return true;
  }

  /**
   * Determine lawful basis for processing purpose
   */
  private determineLawfulBasis(purpose: ProcessingPurpose): ConsentType {
    switch (purpose) {
      case ProcessingPurpose.AUTHENTICATION:
      case ProcessingPurpose.PROFILE_DATA:
        return ConsentType.NECESSARY; // Necessary for service

      case ProcessingPurpose.ANALYTICS:
        return ConsentType.LEGITIMATE_INTEREST;

      case ProcessingPurpose.MARKETING:
      case ProcessingPurpose.THIRD_PARTY_SHARING:
      case ProcessingPurpose.COOKIES:
      case ProcessingPurpose.LOCATION:
      case ProcessingPurpose.BIOMETRIC:
      case ProcessingPurpose.HEALTH_DATA:
        return ConsentType.CONSENT; // Requires explicit consent

      default:
        return ConsentType.CONSENT;
    }
  }

  /**
   * Get consent text for purpose
   */
  private getConsentText(purpose: ProcessingPurpose): string {
    const texts: Record<ProcessingPurpose, string> = {
      [ProcessingPurpose.AUTHENTICATION]: 'Process your data for authentication and security',
      [ProcessingPurpose.PROFILE_DATA]: 'Store and process your profile information',
      [ProcessingPurpose.ANALYTICS]: 'Analyze usage patterns to improve our service',
      [ProcessingPurpose.MARKETING]: 'Send you marketing communications and offers',
      [ProcessingPurpose.THIRD_PARTY_SHARING]: 'Share your data with third-party partners',
      [ProcessingPurpose.DATA_RETENTION]: 'Retain your data for the specified period',
      [ProcessingPurpose.COOKIES]: 'Use cookies and similar tracking technologies',
      [ProcessingPurpose.LOCATION]: 'Access and process your location data',
      [ProcessingPurpose.BIOMETRIC]: 'Process your biometric data for identification',
      [ProcessingPurpose.HEALTH_DATA]: 'Process health-related information',
    };

    return texts[purpose] || 'Process your data for the specified purpose';
  }

  /**
   * Check if purpose requires confirmation
   */
  private requiresConfirmation(purpose: ProcessingPurpose): boolean {
    return [
      ProcessingPurpose.MARKETING,
      ProcessingPurpose.THIRD_PARTY_SHARING,
      ProcessingPurpose.BIOMETRIC,
      ProcessingPurpose.HEALTH_DATA,
    ].includes(purpose);
  }

  /**
   * Check if withdrawal requires data deletion
   */
  private requiresDataDeletion(purpose: ProcessingPurpose): boolean {
    return [
      ProcessingPurpose.PROFILE_DATA,
      ProcessingPurpose.THIRD_PARTY_SHARING,
      ProcessingPurpose.BIOMETRIC,
      ProcessingPurpose.HEALTH_DATA,
    ].includes(purpose);
  }

  /**
   * Generate consent ID
   */
  private generateConsentId(userId: string, purpose: string): string {
    const hash = createHash('sha256')
      .update(`${userId}:${purpose}:${Date.now()}`)
      .digest('hex');
    return `consent_${hash.substring(0, 16)}`;
  }

  /**
   * Calculate age from birthdate
   */
  private calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  /**
   * Check if country is in EU
   */
  private isEUCountry(country: string): boolean {
    const euCountries = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    ];
    return euCountries.includes(country);
  }

  // Database operations (would be implemented with actual DB)
  private async storeConsentRecord(record: ConsentRecord): Promise<void> {
    // Store in database
    logger.debug(`Storing consent record: ${record.id}`);
  }

  private async loadUserConsents(userId: string): Promise<ConsentRecord[]> {
    // Load from database
    return [];
  }

  private async loadAllUserConsentHistory(userId: string): Promise<ConsentRecord[]> {
    // Load all historical records
    return [];
  }

  private async storeSpecialConsentRequest(request: any): Promise<void> {
    // Store special consent request
  }

  private async checkParentalVerification(email: string, code: string): Promise<boolean> {
    // Verify parent identity
    return true; // Mock
  }

  private async triggerDataDeletion(userId: string, purpose: ProcessingPurpose): Promise<void> {
    // Trigger data deletion workflow
    logger.info(`Data deletion triggered for user ${userId}, purpose: ${purpose}`);
  }

  private async sendConsentConfirmation(userId: string, record: ConsentRecord): Promise<void> {
    // Send email confirmation
    logger.info(`Consent confirmation sent to user ${userId}`);
  }
}

// Export singleton instance
export const consentManager = new ConsentManager();