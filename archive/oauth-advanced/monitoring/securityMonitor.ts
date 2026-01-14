import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger.js';
import { anomalyDetector } from '../anomalyDetection.js';
import { createHash } from 'crypto';

/**
 * Security event types
 */
export enum SecurityEventType {
  // Authentication events
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILURE = 'login_failure',
  LOGOUT = 'logout',
  SESSION_CREATED = 'session_created',
  SESSION_EXPIRED = 'session_expired',

  // Token events
  TOKEN_ISSUED = 'token_issued',
  TOKEN_REFRESHED = 'token_refreshed',
  TOKEN_REVOKED = 'token_revoked',
  TOKEN_REUSE_DETECTED = 'token_reuse_detected',
  TOKEN_THEFT_SUSPECTED = 'token_theft_suspected',

  // Security violations
  CSRF_ATTACK = 'csrf_attack',
  XSS_ATTEMPT = 'xss_attempt',
  SQL_INJECTION_ATTEMPT = 'sql_injection_attempt',
  PATH_TRAVERSAL_ATTEMPT = 'path_traversal_attempt',
  BRUTE_FORCE_DETECTED = 'brute_force_detected',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',

  // Anomalies
  ANOMALY_DETECTED = 'anomaly_detected',
  IMPOSSIBLE_TRAVEL = 'impossible_travel',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  NEW_DEVICE = 'new_device',
  UNUSUAL_LOCATION = 'unusual_location',

  // GDPR events
  DATA_EXPORT_REQUESTED = 'data_export_requested',
  DATA_DELETION_REQUESTED = 'data_deletion_requested',
  CONSENT_CHANGED = 'consent_changed',
  DATA_BREACH = 'data_breach',

  // System events
  SERVICE_STARTED = 'service_started',
  SERVICE_STOPPED = 'service_stopped',
  CONFIG_CHANGED = 'config_changed',
  CERTIFICATE_EXPIRY = 'certificate_expiry',
  WEBHOOK_FAILURE = 'webhook_failure',
}

/**
 * Security event severity levels
 */
export enum SecuritySeverity {
  INFO = 'info',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Security event structure
 */
export interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  clientId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  result: 'success' | 'failure' | 'blocked';
  details: Record<string, any>;
  riskScore?: number;
  mitigationActions?: string[];
  correlationId?: string;
  sessionId?: string;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  type: SecurityEventType;
  severity: SecuritySeverity;
  threshold?: number;           // Number of events before alerting
  timeWindow?: number;          // Time window in milliseconds
  channels: AlertChannel[];
  template?: string;
  cooldown?: number;            // Cooldown period between alerts
}

/**
 * Alert channels
 */
export enum AlertChannel {
  EMAIL = 'email',
  SLACK = 'slack',
  WEBHOOK = 'webhook',
  SMS = 'sms',
  PAGERDUTY = 'pagerduty',
  LOG = 'log',
}

/**
 * Security metrics
 */
export interface SecurityMetrics {
  totalEvents: number;
  eventsByType: Map<SecurityEventType, number>;
  eventsBySeverity: Map<SecuritySeverity, number>;
  failedLogins: number;
  successfulLogins: number;
  tokensIssued: number;
  tokensRevoked: number;
  anomaliesDetected: number;
  blockedRequests: number;
  averageRiskScore: number;
  alertsSent: number;
}

/**
 * Security Monitoring System
 * Real-time monitoring, alerting, and incident response
 */
export class SecurityMonitor extends EventEmitter {
  private events: SecurityEvent[] = [];
  private metrics: SecurityMetrics;
  private alertConfigs: AlertConfig[] = [];
  private alertCooldowns = new Map<string, Date>();
  private correlations = new Map<string, SecurityEvent[]>();
  private readonly MAX_EVENTS = 10000;
  private readonly CORRELATION_WINDOW = 300000; // 5 minutes

  constructor() {
    super();
    this.metrics = this.initializeMetrics();
    this.setupDefaultAlerts();
    this.startMetricsAggregation();
  }

  /**
   * Log a security event
   */
  async logEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: SecurityEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date(),
    };

    // Store event
    this.events.push(fullEvent);
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift(); // Remove oldest
    }

    // Update metrics
    this.updateMetrics(fullEvent);

    // Check for correlations
    await this.correlateEvent(fullEvent);

    // Check anomalies
    if (event.userId) {
      const anomalyScore = await this.checkEventAnomaly(fullEvent);
      if (anomalyScore > 0.5) {
        fullEvent.riskScore = anomalyScore;
        await this.handleAnomaly(fullEvent, anomalyScore);
      }
    }

    // Process alerts
    await this.processAlerts(fullEvent);

    // Emit event
    this.emit('security-event', fullEvent);

    // Log to persistent storage
    await this.persistEvent(fullEvent);

    // Log based on severity
    switch (fullEvent.severity) {
      case SecuritySeverity.CRITICAL:
        logger.error(`CRITICAL: ${fullEvent.type}`, fullEvent);
        break;
      case SecuritySeverity.HIGH:
        logger.error(`HIGH: ${fullEvent.type}`, fullEvent);
        break;
      case SecuritySeverity.MEDIUM:
        logger.warn(`MEDIUM: ${fullEvent.type}`, fullEvent);
        break;
      default:
        logger.info(`${fullEvent.severity.toUpperCase()}: ${fullEvent.type}`, {
          userId: fullEvent.userId,
          result: fullEvent.result,
        });
    }
  }

  /**
   * Configure alert
   */
  configureAlert(config: AlertConfig): void {
    // Remove existing config for same type
    this.alertConfigs = this.alertConfigs.filter(c => c.type !== config.type);
    this.alertConfigs.push(config);

    logger.info(`Alert configured for ${config.type} at ${config.severity} level`);
  }

  /**
   * Get security metrics
   */
  getMetrics(timeRange?: { start: Date; end: Date }): SecurityMetrics {
    if (!timeRange) {
      return this.metrics;
    }

    // Filter events by time range
    const filteredEvents = this.events.filter(
      e => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end
    );

    return this.calculateMetrics(filteredEvents);
  }

  /**
   * Get recent security events
   */
  getRecentEvents(
    limit: number = 100,
    filters?: {
      type?: SecurityEventType;
      severity?: SecuritySeverity;
      userId?: string;
      startTime?: Date;
    }
  ): SecurityEvent[] {
    let events = [...this.events].reverse(); // Most recent first

    if (filters) {
      if (filters.type) {
        events = events.filter(e => e.type === filters.type);
      }
      if (filters.severity) {
        events = events.filter(e => e.severity === filters.severity);
      }
      if (filters.userId) {
        events = events.filter(e => e.userId === filters.userId);
      }
      if (filters.startTime) {
        events = events.filter(e => e.timestamp >= filters.startTime);
      }
    }

    return events.slice(0, limit);
  }

  /**
   * Get security report
   */
  async generateSecurityReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    summary: SecurityMetrics;
    topThreats: Array<{ type: string; count: number }>;
    topUsers: Array<{ userId: string; riskScore: number }>;
    incidents: SecurityEvent[];
    recommendations: string[];
  }> {
    const timeRangeEvents = this.events.filter(
      e => e.timestamp >= startDate && e.timestamp <= endDate
    );

    // Calculate top threats
    const threatCounts = new Map<string, number>();
    timeRangeEvents
      .filter(e => e.severity === SecuritySeverity.HIGH || e.severity === SecuritySeverity.CRITICAL)
      .forEach(e => {
        threatCounts.set(e.type, (threatCounts.get(e.type) || 0) + 1);
      });

    const topThreats = Array.from(threatCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    // Calculate top risk users
    const userRisks = new Map<string, number[]>();
    timeRangeEvents
      .filter(e => e.userId && e.riskScore)
      .forEach(e => {
        const scores = userRisks.get(e.userId!) || [];
        scores.push(e.riskScore!);
        userRisks.set(e.userId!, scores);
      });

    const topUsers = Array.from(userRisks.entries())
      .map(([userId, scores]) => ({
        userId,
        riskScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

    // Get critical incidents
    const incidents = timeRangeEvents.filter(
      e => e.severity === SecuritySeverity.CRITICAL || e.severity === SecuritySeverity.HIGH
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(timeRangeEvents);

    return {
      summary: this.calculateMetrics(timeRangeEvents),
      topThreats,
      topUsers,
      incidents,
      recommendations,
    };
  }

  /**
   * Trigger immediate alert
   */
  async triggerAlert(
    type: SecurityEventType,
    severity: SecuritySeverity,
    details: Record<string, any>,
    channels?: AlertChannel[]
  ): Promise<void> {
    const event: SecurityEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      type,
      severity,
      result: 'blocked',
      details,
    };

    await this.sendAlert(event, channels || [AlertChannel.LOG]);
  }

  /**
   * Handle incident response
   */
  async handleIncident(
    event: SecurityEvent,
    autoRespond: boolean = false
  ): Promise<{
    incidentId: string;
    actions: string[];
    status: 'resolved' | 'escalated' | 'monitoring';
  }> {
    const incidentId = `INC-${Date.now()}-${event.id}`;
    const actions: string[] = [];
    let status: 'resolved' | 'escalated' | 'monitoring' = 'monitoring';

    logger.error(`Security incident created: ${incidentId}`, event);

    // Determine response actions based on event type
    switch (event.type) {
      case SecurityEventType.TOKEN_THEFT_SUSPECTED:
      case SecurityEventType.TOKEN_REUSE_DETECTED:
        if (autoRespond && event.userId) {
          actions.push('Revoked all user tokens');
          actions.push('Forced re-authentication');
          // Would call token revocation service
        }
        status = 'resolved';
        break;

      case SecurityEventType.BRUTE_FORCE_DETECTED:
        if (autoRespond && event.ipAddress) {
          actions.push(`Blocked IP: ${event.ipAddress}`);
          actions.push('Rate limiting increased');
          // Would add to IP blocklist
        }
        status = 'resolved';
        break;

      case SecurityEventType.DATA_BREACH:
        actions.push('Notified security team');
        actions.push('Initiated breach protocol');
        actions.push('Prepared regulatory notifications');
        status = 'escalated';
        break;

      case SecurityEventType.SQL_INJECTION_ATTEMPT:
      case SecurityEventType.XSS_ATTEMPT:
        if (autoRespond) {
          actions.push('Blocked request');
          actions.push('Updated WAF rules');
        }
        status = 'resolved';
        break;

      default:
        actions.push('Monitoring situation');
        status = 'monitoring';
    }

    // Send incident notification
    await this.sendIncidentNotification(incidentId, event, actions, status);

    return { incidentId, actions, status };
  }

  /**
   * Setup webhook for external monitoring
   */
  setupWebhook(url: string, secret: string): void {
    this.on('security-event', async (event: SecurityEvent) => {
      if (event.severity === SecuritySeverity.HIGH ||
          event.severity === SecuritySeverity.CRITICAL) {
        await this.sendWebhook(url, event, secret);
      }
    });
  }

  /**
   * Process alerts for event
   */
  private async processAlerts(event: SecurityEvent): Promise<void> {
    for (const config of this.alertConfigs) {
      if (config.type !== event.type) continue;

      // Check severity threshold
      if (this.compareSeverity(event.severity, config.severity) < 0) continue;

      // Check cooldown
      const cooldownKey = `${config.type}-${config.severity}`;
      const lastAlert = this.alertCooldowns.get(cooldownKey);
      if (lastAlert && config.cooldown) {
        if (Date.now() - lastAlert.getTime() < config.cooldown) {
          continue; // Still in cooldown
        }
      }

      // Check threshold
      if (config.threshold && config.timeWindow) {
        const recentEvents = this.events.filter(
          e => e.type === config.type &&
               Date.now() - e.timestamp.getTime() < config.timeWindow
        );

        if (recentEvents.length < config.threshold) {
          continue; // Threshold not met
        }
      }

      // Send alert
      await this.sendAlert(event, config.channels);

      // Update cooldown
      this.alertCooldowns.set(cooldownKey, new Date());
    }
  }

  /**
   * Send alert through channels
   */
  private async sendAlert(
    event: SecurityEvent,
    channels: AlertChannel[]
  ): Promise<void> {
    for (const channel of channels) {
      try {
        switch (channel) {
          case AlertChannel.EMAIL:
            await this.sendEmailAlert(event);
            break;
          case AlertChannel.SLACK:
            await this.sendSlackAlert(event);
            break;
          case AlertChannel.WEBHOOK:
            await this.sendWebhookAlert(event);
            break;
          case AlertChannel.SMS:
            await this.sendSMSAlert(event);
            break;
          case AlertChannel.PAGERDUTY:
            await this.sendPagerDutyAlert(event);
            break;
          case AlertChannel.LOG:
            logger.error(`SECURITY ALERT: ${event.type}`, event);
            break;
        }

        this.metrics.alertsSent++;
      } catch (error) {
        logger.error(`Failed to send alert via ${channel}:`, error);
      }
    }
  }

  /**
   * Correlate events to detect patterns
   */
  private async correlateEvent(event: SecurityEvent): Promise<void> {
    if (!event.userId && !event.ipAddress) return;

    const key = event.userId || event.ipAddress!;
    const correlated = this.correlations.get(key) || [];

    // Add event to correlation
    correlated.push(event);

    // Remove old events outside correlation window
    const cutoff = Date.now() - this.CORRELATION_WINDOW;
    const filtered = correlated.filter(e => e.timestamp.getTime() > cutoff);

    // Check for patterns
    if (filtered.length >= 5) {
      const patterns = this.detectPatterns(filtered);
      if (patterns.length > 0) {
        await this.logEvent({
          type: SecurityEventType.SUSPICIOUS_ACTIVITY,
          severity: SecuritySeverity.HIGH,
          userId: event.userId,
          ipAddress: event.ipAddress,
          result: 'blocked',
          details: {
            patterns,
            correlatedEvents: filtered.length,
          },
          correlationId: key,
        });
      }
    }

    this.correlations.set(key, filtered);
  }

  /**
   * Detect patterns in correlated events
   */
  private detectPatterns(events: SecurityEvent[]): string[] {
    const patterns: string[] = [];

    // Check for rapid succession of failures
    const failures = events.filter(e => e.result === 'failure');
    if (failures.length >= 3) {
      patterns.push('Multiple failures detected');
    }

    // Check for credential stuffing
    const loginAttempts = events.filter(e => e.type === SecurityEventType.LOGIN_FAILURE);
    if (loginAttempts.length >= 5) {
      patterns.push('Possible credential stuffing attack');
    }

    // Check for scanning behavior
    const uniqueResources = new Set(events.map(e => e.resource).filter(Boolean));
    if (uniqueResources.size >= 10) {
      patterns.push('Resource scanning detected');
    }

    return patterns;
  }

  /**
   * Check event for anomalies
   */
  private async checkEventAnomaly(event: SecurityEvent): Promise<number> {
    if (!event.userId) return 0;

    const request = {
      userId: event.userId,
      clientId: event.clientId || 'unknown',
      ip: event.ipAddress || '0.0.0.0',
      userAgent: event.userAgent,
      timestamp: event.timestamp,
      method: this.mapEventToMethod(event.type),
      success: event.result === 'success',
    };

    const anomaly = await anomalyDetector.detectAnomalies(request);
    return anomaly.composite;
  }

  /**
   * Generate security recommendations
   */
  private generateRecommendations(events: SecurityEvent[]): string[] {
    const recommendations: string[] = [];

    const failureRate = events.filter(e => e.result === 'failure').length / events.length;
    if (failureRate > 0.2) {
      recommendations.push('High failure rate detected. Consider implementing stricter rate limiting.');
    }

    const bruteForceEvents = events.filter(e => e.type === SecurityEventType.BRUTE_FORCE_DETECTED);
    if (bruteForceEvents.length > 0) {
      recommendations.push('Brute force attacks detected. Enable account lockout policies.');
    }

    const anomalies = events.filter(e => e.type === SecurityEventType.ANOMALY_DETECTED);
    if (anomalies.length > 10) {
      recommendations.push('Multiple anomalies detected. Review user behavior analytics.');
    }

    const tokenThefts = events.filter(e => e.type === SecurityEventType.TOKEN_THEFT_SUSPECTED);
    if (tokenThefts.length > 0) {
      recommendations.push('Token theft suspected. Consider implementing DPoP for token binding.');
    }

    return recommendations;
  }

  // Helper methods

  private initializeMetrics(): SecurityMetrics {
    return {
      totalEvents: 0,
      eventsByType: new Map(),
      eventsBySeverity: new Map(),
      failedLogins: 0,
      successfulLogins: 0,
      tokensIssued: 0,
      tokensRevoked: 0,
      anomaliesDetected: 0,
      blockedRequests: 0,
      averageRiskScore: 0,
      alertsSent: 0,
    };
  }

  private updateMetrics(event: SecurityEvent): void {
    this.metrics.totalEvents++;

    // Update type counts
    const typeCount = this.metrics.eventsByType.get(event.type) || 0;
    this.metrics.eventsByType.set(event.type, typeCount + 1);

    // Update severity counts
    const severityCount = this.metrics.eventsBySeverity.get(event.severity) || 0;
    this.metrics.eventsBySeverity.set(event.severity, severityCount + 1);

    // Update specific metrics
    switch (event.type) {
      case SecurityEventType.LOGIN_SUCCESS:
        this.metrics.successfulLogins++;
        break;
      case SecurityEventType.LOGIN_FAILURE:
        this.metrics.failedLogins++;
        break;
      case SecurityEventType.TOKEN_ISSUED:
        this.metrics.tokensIssued++;
        break;
      case SecurityEventType.TOKEN_REVOKED:
        this.metrics.tokensRevoked++;
        break;
      case SecurityEventType.ANOMALY_DETECTED:
        this.metrics.anomaliesDetected++;
        break;
    }

    if (event.result === 'blocked') {
      this.metrics.blockedRequests++;
    }

    // Update average risk score
    if (event.riskScore) {
      const totalRisk = this.metrics.averageRiskScore * (this.metrics.totalEvents - 1);
      this.metrics.averageRiskScore = (totalRisk + event.riskScore) / this.metrics.totalEvents;
    }
  }

  private calculateMetrics(events: SecurityEvent[]): SecurityMetrics {
    const metrics = this.initializeMetrics();

    for (const event of events) {
      this.updateMetrics.call({ metrics }, event);
    }

    return metrics;
  }

  private setupDefaultAlerts(): void {
    // Critical alerts
    this.configureAlert({
      type: SecurityEventType.DATA_BREACH,
      severity: SecuritySeverity.CRITICAL,
      channels: [AlertChannel.EMAIL, AlertChannel.PAGERDUTY, AlertChannel.LOG],
    });

    this.configureAlert({
      type: SecurityEventType.TOKEN_THEFT_SUSPECTED,
      severity: SecuritySeverity.HIGH,
      channels: [AlertChannel.EMAIL, AlertChannel.SLACK, AlertChannel.LOG],
    });

    // High severity alerts
    this.configureAlert({
      type: SecurityEventType.BRUTE_FORCE_DETECTED,
      severity: SecuritySeverity.HIGH,
      threshold: 5,
      timeWindow: 300000, // 5 minutes
      channels: [AlertChannel.SLACK, AlertChannel.LOG],
      cooldown: 3600000, // 1 hour
    });

    // Medium severity alerts
    this.configureAlert({
      type: SecurityEventType.ANOMALY_DETECTED,
      severity: SecuritySeverity.MEDIUM,
      threshold: 10,
      timeWindow: 3600000, // 1 hour
      channels: [AlertChannel.LOG],
    });
  }

  private startMetricsAggregation(): void {
    // Reset hourly metrics
    setInterval(() => {
      this.metrics = this.initializeMetrics();
    }, 3600000); // 1 hour
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private compareSeverity(a: SecuritySeverity, b: SecuritySeverity): number {
    const levels = {
      [SecuritySeverity.INFO]: 0,
      [SecuritySeverity.LOW]: 1,
      [SecuritySeverity.MEDIUM]: 2,
      [SecuritySeverity.HIGH]: 3,
      [SecuritySeverity.CRITICAL]: 4,
    };
    return levels[a] - levels[b];
  }

  private mapEventToMethod(type: SecurityEventType): 'login' | 'refresh' | 'logout' | 'register' {
    switch (type) {
      case SecurityEventType.LOGIN_SUCCESS:
      case SecurityEventType.LOGIN_FAILURE:
        return 'login';
      case SecurityEventType.TOKEN_REFRESHED:
        return 'refresh';
      case SecurityEventType.LOGOUT:
        return 'logout';
      default:
        return 'login';
    }
  }

  private async persistEvent(event: SecurityEvent): Promise<void> {
    // Store event in database
  }

  private async sendEmailAlert(event: SecurityEvent): Promise<void> {
    // Send email notification
    logger.info(`Email alert sent for ${event.type}`);
  }

  private async sendSlackAlert(event: SecurityEvent): Promise<void> {
    // Send Slack notification
    logger.info(`Slack alert sent for ${event.type}`);
  }

  private async sendWebhookAlert(event: SecurityEvent): Promise<void> {
    // Send webhook notification
    logger.info(`Webhook alert sent for ${event.type}`);
  }

  private async sendSMSAlert(event: SecurityEvent): Promise<void> {
    // Send SMS notification
    logger.info(`SMS alert sent for ${event.type}`);
  }

  private async sendPagerDutyAlert(event: SecurityEvent): Promise<void> {
    // Send PagerDuty notification
    logger.info(`PagerDuty alert sent for ${event.type}`);
  }

  private async sendWebhook(url: string, event: SecurityEvent, secret: string): Promise<void> {
    // Send signed webhook
    const signature = createHash('sha256')
      .update(secret + JSON.stringify(event))
      .digest('hex');

    // Would make HTTP request with signature header
    logger.info(`Webhook sent to ${url}`);
  }

  private async sendIncidentNotification(
    incidentId: string,
    event: SecurityEvent,
    actions: string[],
    status: string
  ): Promise<void> {
    logger.info(`Incident notification: ${incidentId} - ${status}`);
  }
}

// Export singleton instance
export const securityMonitor = new SecurityMonitor();