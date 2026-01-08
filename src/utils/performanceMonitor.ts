import { logger } from './logger.js';
import { EventEmitter } from 'events';

export interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface PerformanceStats {
  count: number;
  successCount: number;
  errorCount: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  throughput: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    responseTime: boolean;
    errorRate: boolean;
    throughput: boolean;
  };
  metrics: {
    avgResponseTime: number;
    errorRate: number;
    requestsPerMinute: number;
  };
}

/**
 * Performance monitoring with real-time metrics and alerting
 */
export class PerformanceMonitor extends EventEmitter {
  private metrics = new Map<string, PerformanceMetric[]>();
  private readonly maxMetricsPerOperation = 1000;
  private readonly metricsWindow = 5 * 60 * 1000; // 5 minutes
  private startTime = Date.now();

  // Thresholds for health monitoring
  private readonly thresholds = {
    responseTime: parseInt(process.env.PERF_THRESHOLD_RESPONSE_TIME || '5000'),
    errorRate: parseFloat(process.env.PERF_THRESHOLD_ERROR_RATE || '0.05'),
    throughput: parseInt(process.env.PERF_THRESHOLD_THROUGHPUT || '10'),
  };

  constructor() {
    super();

    // Start periodic cleanup
    if (process.env.ENABLE_PERFORMANCE_MONITORING !== 'false') {
      this.startPeriodicCleanup();
      this.startPeriodicLogging();
    }
  }

  /**
   * Measure operation performance
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const start = performance.now();
    let success = true;

    try {
      const result = await fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = performance.now() - start;
      this.record(operation, duration, success, metadata);
    }
  }

  /**
   * Measure sync operation performance
   */
  measureSync<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, any>
  ): T {
    const start = performance.now();
    let success = true;

    try {
      const result = fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = performance.now() - start;
      this.record(operation, duration, success, metadata);
    }
  }

  /**
   * Record a metric
   */
  record(
    operation: string,
    duration: number,
    success: boolean = true,
    metadata?: Record<string, any>
  ): void {
    const metric: PerformanceMetric = {
      operation,
      duration,
      success,
      timestamp: new Date(),
      metadata,
    };

    // Get or create metrics array for this operation
    let operationMetrics = this.metrics.get(operation);
    if (!operationMetrics) {
      operationMetrics = [];
      this.metrics.set(operation, operationMetrics);
    }

    // Add new metric
    operationMetrics.push(metric);

    // Limit array size
    if (operationMetrics.length > this.maxMetricsPerOperation) {
      operationMetrics.shift();
    }

    // Check for performance degradation
    this.checkPerformance(operation, metric);

    // Emit metric event for real-time monitoring
    this.emit('metric', metric);
  }

  /**
   * Get statistics for an operation
   */
  getStats(operation: string): PerformanceStats | null {
    const metrics = this.getRecentMetrics(operation);
    if (metrics.length === 0) {
      return null;
    }

    const successMetrics = metrics.filter(m => m.success);
    const errorMetrics = metrics.filter(m => !m.success);
    const durations = successMetrics.map(m => m.duration).sort((a, b) => a - b);

    if (durations.length === 0) {
      return {
        count: metrics.length,
        successCount: 0,
        errorCount: errorMetrics.length,
        totalTime: 0,
        avgTime: 0,
        minTime: 0,
        maxTime: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        errorRate: 1,
        throughput: 0,
      };
    }

    const totalTime = durations.reduce((sum, d) => sum + d, 0);
    const timeRange = Date.now() - metrics[0].timestamp.getTime();
    const throughput = (metrics.length / timeRange) * 60000; // per minute

    return {
      count: metrics.length,
      successCount: successMetrics.length,
      errorCount: errorMetrics.length,
      totalTime,
      avgTime: totalTime / durations.length,
      minTime: durations[0],
      maxTime: durations[durations.length - 1],
      p50: this.percentile(durations, 0.5),
      p95: this.percentile(durations, 0.95),
      p99: this.percentile(durations, 0.99),
      errorRate: errorMetrics.length / metrics.length,
      throughput,
    };
  }

  /**
   * Get all statistics
   */
  getAllStats(): Record<string, PerformanceStats> {
    const allStats: Record<string, PerformanceStats> = {};

    for (const operation of this.metrics.keys()) {
      const stats = this.getStats(operation);
      if (stats) {
        allStats[operation] = stats;
      }
    }

    return allStats;
  }

  /**
   * Get health status
   */
  getHealthStatus(): HealthStatus {
    const allStats = this.getAllStats();
    const operations = Object.values(allStats);

    if (operations.length === 0) {
      return {
        status: 'healthy',
        checks: {
          responseTime: true,
          errorRate: true,
          throughput: true,
        },
        metrics: {
          avgResponseTime: 0,
          errorRate: 0,
          requestsPerMinute: 0,
        },
      };
    }

    // Calculate overall metrics
    const totalRequests = operations.reduce((sum, op) => sum + op.count, 0);
    const totalErrors = operations.reduce((sum, op) => sum + op.errorCount, 0);
    const avgResponseTime = operations.reduce((sum, op) => sum + op.avgTime, 0) / operations.length;
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
    const requestsPerMinute = operations.reduce((sum, op) => sum + op.throughput, 0);

    // Check health criteria
    const checks = {
      responseTime: avgResponseTime < this.thresholds.responseTime,
      errorRate: errorRate < this.thresholds.errorRate,
      throughput: requestsPerMinute > this.thresholds.throughput,
    };

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const failedChecks = Object.values(checks).filter(c => !c).length;

    if (failedChecks >= 2) {
      status = 'unhealthy';
    } else if (failedChecks === 1) {
      status = 'degraded';
    }

    return {
      status,
      checks,
      metrics: {
        avgResponseTime,
        errorRate,
        requestsPerMinute,
      },
    };
  }

  /**
   * Get recent metrics for an operation
   */
  private getRecentMetrics(operation: string): PerformanceMetric[] {
    const metrics = this.metrics.get(operation) || [];
    const cutoff = Date.now() - this.metricsWindow;

    return metrics.filter(m => m.timestamp.getTime() > cutoff);
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedArray: number[], percentile: number): number {
    const index = Math.floor(sortedArray.length * percentile);
    return sortedArray[Math.min(index, sortedArray.length - 1)];
  }

  /**
   * Check for performance issues
   */
  private checkPerformance(operation: string, metric: PerformanceMetric): void {
    // Check for slow operations
    if (metric.duration > this.thresholds.responseTime) {
      logger.warn(`Slow operation detected: ${operation} took ${metric.duration.toFixed(2)}ms`);
      this.emit('slow-operation', { operation, duration: metric.duration });
    }

    // Check for errors
    if (!metric.success) {
      const stats = this.getStats(operation);
      if (stats && stats.errorRate > this.thresholds.errorRate) {
        logger.error(`High error rate for ${operation}: ${(stats.errorRate * 100).toFixed(2)}%`);
        this.emit('high-error-rate', { operation, errorRate: stats.errorRate });
      }
    }
  }

  /**
   * Start periodic cleanup of old metrics
   */
  private startPeriodicCleanup(): void {
    setInterval(() => {
      for (const [operation, metrics] of this.metrics.entries()) {
        const cutoff = Date.now() - this.metricsWindow;
        const recentMetrics = metrics.filter(m => m.timestamp.getTime() > cutoff);

        if (recentMetrics.length === 0) {
          this.metrics.delete(operation);
        } else {
          this.metrics.set(operation, recentMetrics);
        }
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Start periodic logging of metrics
   */
  private startPeriodicLogging(): void {
    const interval = parseInt(process.env.PERFORMANCE_LOG_INTERVAL || '60000');

    setInterval(() => {
      const stats = this.getAllStats();
      const health = this.getHealthStatus();

      if (Object.keys(stats).length > 0) {
        logger.info('Performance metrics:', {
          health: health.status,
          metrics: health.metrics,
          operations: Object.entries(stats).map(([op, stat]) => ({
            operation: op,
            avgTime: Math.round(stat.avgTime),
            p95: Math.round(stat.p95),
            errorRate: Math.round(stat.errorRate * 100) / 100,
            throughput: Math.round(stat.throughput),
          })),
        });
      }
    }, interval);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.startTime = Date.now();
    logger.info('Performance metrics reset');
  }

  /**
   * Get uptime
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Export metrics for external monitoring
   */
  export(): any {
    return {
      uptime: this.getUptime(),
      health: this.getHealthStatus(),
      stats: this.getAllStats(),
      timestamp: new Date().toISOString(),
    };
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Convenience functions
export async function measure<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  return performanceMonitor.measure(operation, fn, metadata);
}

export function recordMetric(
  operation: string,
  duration: number,
  success: boolean = true,
  metadata?: Record<string, any>
): void {
  performanceMonitor.record(operation, duration, success, metadata);
}