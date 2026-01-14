import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';
import { getDb } from '../../db/client.js';

/**
 * Authentication request context
 */
export interface AuthRequest {
  userId?: string;
  clientId: string;
  ip: string;
  userAgent?: string;
  fingerprint?: string;
  timestamp: Date;
  method: 'login' | 'refresh' | 'logout' | 'register';
  success: boolean;
  metadata?: {
    country?: string;
    city?: string;
    asn?: string;
    isp?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
  };
}

/**
 * Anomaly score and action
 */
export interface AnomalyScore {
  composite: number;  // 0-1 scale
  details: {
    ip: number;
    geo: number;
    device: number;
    time: number;
    velocity: number;
    pattern: number;
  };
  action: 'allow' | 'challenge' | 'deny';
  reasons: string[];
}

/**
 * Risk factors configuration
 */
export interface RiskFactors {
  vpnWeight: number;
  torWeight: number;
  proxyWeight: number;
  newDeviceWeight: number;
  newLocationWeight: number;
  impossibleTravelWeight: number;
  bruteForceWeight: number;
  timeAnomalyWeight: number;
}

/**
 * User behavior profile
 */
interface UserProfile {
  userId: string;
  knownIps: Set<string>;
  knownDevices: Set<string>;
  knownLocations: Set<string>;
  loginTimes: number[];  // Hour of day (0-23)
  averageSessionDuration: number;
  lastLoginLocation?: { lat: number; lon: number; timestamp: Date };
  failedAttempts: number;
  lastFailedAttempt?: Date;
  riskScore: number;
}

/**
 * Anomaly Detection System
 * Detects suspicious authentication patterns and potential attacks
 */
export class AnomalyDetector {
  private userProfiles = new Map<string, UserProfile>();
  private ipReputation = new Map<string, number>();
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly IMPOSSIBLE_TRAVEL_SPEED = 900; // km/h
  private readonly TIME_WINDOW = 3600000; // 1 hour

  private readonly riskFactors: RiskFactors = {
    vpnWeight: 0.3,
    torWeight: 0.8,
    proxyWeight: 0.4,
    newDeviceWeight: 0.2,
    newLocationWeight: 0.25,
    impossibleTravelWeight: 0.9,
    bruteForceWeight: 0.7,
    timeAnomalyWeight: 0.15,
  };

  /**
   * Analyze authentication request for anomalies
   */
  async detectAnomalies(request: AuthRequest): Promise<AnomalyScore> {
    const scores: { [key: string]: number } = {};
    const reasons: string[] = [];

    // Check IP reputation
    scores.ip = await this.checkIPReputation(request.ip);
    if (scores.ip > 0.5) {
      reasons.push(`Suspicious IP: ${request.ip}`);
    }

    // Check geolocation anomaly
    if (request.userId) {
      scores.geo = await this.checkGeoAnomaly(request);
      if (scores.geo > 0.5) {
        reasons.push('Unusual location detected');
      }

      // Check device fingerprint
      scores.device = await this.checkDeviceAnomaly(request);
      if (scores.device > 0.3) {
        reasons.push('New or unknown device');
      }

      // Check time-based anomaly
      scores.time = await this.checkTimeAnomaly(request);
      if (scores.time > 0.3) {
        reasons.push('Unusual login time');
      }

      // Check velocity (rate of requests)
      scores.velocity = await this.checkVelocity(request);
      if (scores.velocity > 0.5) {
        reasons.push('High request rate detected');
      }

      // Check behavioral patterns
      scores.pattern = await this.checkBehavioralPattern(request);
      if (scores.pattern > 0.4) {
        reasons.push('Unusual behavior pattern');
      }
    } else {
      // For non-authenticated requests
      scores.geo = 0;
      scores.device = 0;
      scores.time = 0;
      scores.velocity = await this.checkVelocity(request);
      scores.pattern = 0;
    }

    // Calculate composite score
    const weights = [1, 1, 0.8, 0.5, 1.2, 0.9]; // Adjust weights for each factor
    const weightedScores = Object.values(scores).map((s, i) => s * (weights[i] || 1));
    const composite = weightedScores.reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0);

    // Determine action based on composite score
    const action = this.determineAction(composite, request);

    // Update user profile if authenticated
    if (request.userId && request.success) {
      await this.updateUserProfile(request);
    }

    // Log anomaly if detected
    if (composite > 0.3) {
      logger.warn(`Anomaly detected for ${request.userId || 'anonymous'}: score=${composite.toFixed(2)}, action=${action}`);
      await this.logAnomaly(request, composite, reasons);
    }

    return {
      composite: Math.min(1, composite),
      details: scores as AnomalyScore['details'],
      action,
      reasons,
    };
  }

  /**
   * Check IP reputation
   */
  private async checkIPReputation(ip: string): Promise<number> {
    // Check cached reputation
    const cached = this.ipReputation.get(ip);
    if (cached !== undefined) {
      return cached;
    }

    let score = 0;

    // Check if IP is in threat lists
    const threats = await this.queryThreatIntelligence(ip);

    if (threats.tor) {
      score = Math.max(score, this.riskFactors.torWeight);
    }
    if (threats.vpn) {
      score = Math.max(score, this.riskFactors.vpnWeight);
    }
    if (threats.proxy) {
      score = Math.max(score, this.riskFactors.proxyWeight);
    }
    if (threats.botnet) {
      score = Math.max(score, 0.95);
    }
    if (threats.spam) {
      score = Math.max(score, 0.6);
    }

    // Cache the result
    this.ipReputation.set(ip, score);

    // Clean old cache entries periodically
    if (this.ipReputation.size > 10000) {
      const toDelete = Array.from(this.ipReputation.keys()).slice(0, 5000);
      toDelete.forEach(key => this.ipReputation.delete(key));
    }

    return score;
  }

  /**
   * Check geolocation anomaly
   */
  private async checkGeoAnomaly(request: AuthRequest): Promise<number> {
    const profile = this.getUserProfile(request.userId!);

    if (!request.metadata?.country) {
      return 0; // No geo data available
    }

    const location = `${request.metadata.country}:${request.metadata.city || 'unknown'}`;

    // Check if location is known
    if (profile.knownLocations.has(location)) {
      return 0;
    }

    // Check for impossible travel
    if (profile.lastLoginLocation && request.metadata) {
      const timeDiff = request.timestamp.getTime() - profile.lastLoginLocation.timestamp.getTime();
      const distance = this.calculateDistance(
        profile.lastLoginLocation.lat,
        profile.lastLoginLocation.lon,
        0, // Would need actual coordinates
        0
      );

      const speed = (distance / timeDiff) * 3600000; // km/h

      if (speed > this.IMPOSSIBLE_TRAVEL_SPEED) {
        logger.warn(`Impossible travel detected: ${speed.toFixed(0)} km/h`);
        return this.riskFactors.impossibleTravelWeight;
      }
    }

    // New location
    return this.riskFactors.newLocationWeight;
  }

  /**
   * Check device anomaly
   */
  private async checkDeviceAnomaly(request: AuthRequest): Promise<number> {
    if (!request.fingerprint) {
      return 0.1; // Slightly suspicious if no fingerprint
    }

    const profile = this.getUserProfile(request.userId!);

    if (profile.knownDevices.has(request.fingerprint)) {
      return 0;
    }

    // New device
    return this.riskFactors.newDeviceWeight;
  }

  /**
   * Check time-based anomaly
   */
  private async checkTimeAnomaly(request: AuthRequest): Promise<number> {
    const profile = this.getUserProfile(request.userId!);
    const hour = request.timestamp.getHours();

    if (profile.loginTimes.length < 10) {
      return 0; // Not enough data
    }

    // Calculate average login time
    const avgHour = profile.loginTimes.reduce((a, b) => a + b, 0) / profile.loginTimes.length;
    const deviation = Math.abs(hour - avgHour);

    // If login is more than 6 hours from average
    if (deviation > 6) {
      return this.riskFactors.timeAnomalyWeight;
    }

    return 0;
  }

  /**
   * Check request velocity
   */
  private async checkVelocity(request: AuthRequest): Promise<number> {
    const db = getDb();
    const oneMinuteAgo = new Date(Date.now() - 60000);

    // Count recent requests from this IP
    const recentRequests = await this.countRecentRequests(
      request.ip,
      oneMinuteAgo
    );

    if (recentRequests > 10) {
      return 0.8; // Very high rate
    }
    if (recentRequests > 5) {
      return 0.5; // High rate
    }
    if (recentRequests > 3) {
      return 0.2; // Moderate rate
    }

    return 0;
  }

  /**
   * Check behavioral patterns
   */
  private async checkBehavioralPattern(request: AuthRequest): Promise<number> {
    const profile = this.getUserProfile(request.userId!);

    // Check failed attempts (brute force)
    if (!request.success) {
      profile.failedAttempts++;
      profile.lastFailedAttempt = request.timestamp;

      if (profile.failedAttempts >= this.MAX_FAILED_ATTEMPTS) {
        return this.riskFactors.bruteForceWeight;
      }

      return profile.failedAttempts * 0.15; // Incremental risk
    }

    // Reset failed attempts on success
    if (request.success) {
      profile.failedAttempts = 0;
    }

    // Check for automated behavior patterns
    const entropy = this.calculateRequestEntropy(request);
    if (entropy < 0.3) {
      return 0.4; // Low entropy suggests automation
    }

    return 0;
  }

  /**
   * Determine action based on score and context
   */
  private determineAction(score: number, request: AuthRequest): 'allow' | 'challenge' | 'deny' {
    // Always deny if score is very high
    if (score > 0.8) {
      return 'deny';
    }

    // Challenge for moderate scores
    if (score > 0.4) {
      return 'challenge';
    }

    // Consider user history
    if (request.userId) {
      const profile = this.getUserProfile(request.userId);

      // Be more strict for users with high risk scores
      if (profile.riskScore > 0.5 && score > 0.3) {
        return 'challenge';
      }
    }

    return 'allow';
  }

  /**
   * Query threat intelligence feeds
   */
  private async queryThreatIntelligence(ip: string): Promise<{
    tor: boolean;
    vpn: boolean;
    proxy: boolean;
    botnet: boolean;
    spam: boolean;
  }> {
    // In production, this would query actual threat feeds
    // For now, use some heuristics

    // Check if IP is in private ranges (likely VPN/proxy)
    const isPrivate = this.isPrivateIP(ip);

    // Simulate threat detection
    const ipNum = ip.split('.').reduce((acc, octet) => acc * 256 + parseInt(octet), 0);
    const hash = createHash('sha256').update(ip).digest();
    const simulated = hash[0]! / 255;

    return {
      tor: simulated > 0.95,
      vpn: isPrivate || simulated > 0.7,
      proxy: simulated > 0.8,
      botnet: simulated > 0.98,
      spam: simulated > 0.85,
    };
  }

  /**
   * Check if IP is in private range
   */
  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(p => parseInt(p));

    return (
      parts[0] === 10 || // 10.0.0.0/8
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
      (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0/16
      parts[0] === 127 // 127.0.0.0/8 (loopback)
    );
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Calculate request entropy (randomness)
   */
  private calculateRequestEntropy(request: AuthRequest): number {
    const data = JSON.stringify(request);
    const freq: { [key: string]: number } = {};

    for (const char of data) {
      freq[char] = (freq[char] || 0) + 1;
    }

    let entropy = 0;
    const len = data.length;

    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy / 8; // Normalize
  }

  /**
   * Get or create user profile
   */
  private getUserProfile(userId: string): UserProfile {
    let profile = this.userProfiles.get(userId);

    if (!profile) {
      profile = {
        userId,
        knownIps: new Set(),
        knownDevices: new Set(),
        knownLocations: new Set(),
        loginTimes: [],
        averageSessionDuration: 0,
        failedAttempts: 0,
        riskScore: 0,
      };
      this.userProfiles.set(userId, profile);
    }

    return profile;
  }

  /**
   * Update user profile with successful authentication
   */
  private async updateUserProfile(request: AuthRequest): Promise<void> {
    if (!request.userId) return;

    const profile = this.getUserProfile(request.userId);

    // Update known attributes
    profile.knownIps.add(request.ip);

    if (request.fingerprint) {
      profile.knownDevices.add(request.fingerprint);
    }

    if (request.metadata?.country) {
      const location = `${request.metadata.country}:${request.metadata.city || 'unknown'}`;
      profile.knownLocations.add(location);
    }

    // Update login times
    profile.loginTimes.push(request.timestamp.getHours());
    if (profile.loginTimes.length > 100) {
      profile.loginTimes.shift(); // Keep last 100
    }

    // Update risk score (decay over time)
    profile.riskScore = Math.max(0, profile.riskScore * 0.95);
  }

  /**
   * Count recent requests from IP
   */
  private async countRecentRequests(ip: string, since: Date): Promise<number> {
    // In production, this would query the database
    // For now, return a simulated count
    return Math.floor(Math.random() * 3);
  }

  /**
   * Log anomaly to database
   */
  private async logAnomaly(
    request: AuthRequest,
    score: number,
    reasons: string[]
  ): Promise<void> {
    // TODO: Log to audit database
    logger.info(`Anomaly logged: user=${request.userId}, score=${score}, reasons=${reasons.join(', ')}`);
  }

  /**
   * Get risk score for a user
   */
  async getUserRiskScore(userId: string): Promise<number> {
    const profile = this.userProfiles.get(userId);
    return profile?.riskScore || 0;
  }

  /**
   * Reset user profile (after password reset, etc.)
   */
  resetUserProfile(userId: string): void {
    this.userProfiles.delete(userId);
    logger.info(`Reset profile for user ${userId}`);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalProfiles: number;
    totalIPs: number;
    highRiskUsers: number;
  } {
    const highRiskUsers = Array.from(this.userProfiles.values())
      .filter(p => p.riskScore > 0.5).length;

    return {
      totalProfiles: this.userProfiles.size,
      totalIPs: this.ipReputation.size,
      highRiskUsers,
    };
  }
}

// Export singleton instance
export const anomalyDetector = new AnomalyDetector();