# MCP Performance Optimizations

> **Created**: January 8, 2026
> **Purpose**: Address performance bottlenecks discovered during integration testing

## Current Performance Issues

### 1. Crisis Detection Timeout (Critical)
- **Issue**: Crisis messages taking 25+ seconds, causing timeouts
- **Current timeout**: 30 seconds (barely sufficient)
- **Impact**: Poor user experience during critical moments

### 2. Configuration Issues
- Single timeout for all request types
- No differentiation between regular and crisis messages
- Circuit breaker triggers too quickly for legitimate long requests

### 3. Response Handling
- Empty content in responses ("...")
- No streaming support for long responses
- No caching for repeated patterns

## Proposed Optimizations

### 1. Differentiated Timeouts

```typescript
// src/clients/shrinkChatClient.ts
const TIMEOUT_CONFIG = {
  regular: 15000,      // 15s for regular messages
  crisis: 45000,       // 45s for crisis detection (complex AI processing)
  stream: 60000,       // 60s for streaming
  health: 5000,        // 5s for health checks
};
```

### 2. Intelligent Retry Strategy

```typescript
// src/utils/retryStrategy.ts
export class RetryStrategy {
  private readonly maxRetries = 3;
  private readonly backoffMultiplier = 1.5;

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      initialDelay?: number;
      shouldRetry?: (error: Error) => boolean;
    }
  ): Promise<T> {
    let lastError: Error;
    let delay = options.initialDelay || 1000;

    for (let attempt = 0; attempt < (options.maxRetries || this.maxRetries); attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error.message?.includes('400') || error.message?.includes('401')) {
          throw error;
        }

        // Check if we should retry
        if (options.shouldRetry && !options.shouldRetry(error)) {
          throw error;
        }

        // Exponential backoff
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= this.backoffMultiplier;
        }
      }
    }

    throw lastError!;
  }
}
```

### 3. Response Caching for Crisis Patterns

```typescript
// src/utils/responseCache.ts
export class CrisisResponseCache {
  private cache = new Map<string, {
    response: any;
    timestamp: number;
    pattern: string;
  }>();

  private readonly TTL = 5 * 60 * 1000; // 5 minutes

  getCachedResponse(message: string): any | null {
    // Normalize and check for similar patterns
    const pattern = this.extractPattern(message);
    const cached = this.cache.get(pattern);

    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.response;
    }

    return null;
  }

  private extractPattern(message: string): string {
    // Extract key crisis indicators
    const patterns = [
      /self[- ]harm/i,
      /suicid/i,
      /kill myself/i,
      /end it all/i,
    ];

    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return pattern.source;
      }
    }

    return message.toLowerCase().substring(0, 50);
  }
}
```

### 4. Performance Monitoring

```typescript
// src/utils/performanceMonitor.ts
export class PerformanceMonitor {
  private metrics: Map<string, {
    count: number;
    totalTime: number;
    errors: number;
    p95: number[];
  }> = new Map();

  async measure<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    let error = false;

    try {
      return await fn();
    } catch (e) {
      error = true;
      throw e;
    } finally {
      const duration = performance.now() - start;
      this.record(operation, duration, error);
    }
  }

  private record(operation: string, duration: number, error: boolean) {
    const metric = this.metrics.get(operation) || {
      count: 0,
      totalTime: 0,
      errors: 0,
      p95: [],
    };

    metric.count++;
    metric.totalTime += duration;
    if (error) metric.errors++;

    // Keep last 100 for P95 calculation
    metric.p95.push(duration);
    if (metric.p95.length > 100) {
      metric.p95.shift();
    }

    this.metrics.set(operation, metric);
  }

  getMetrics() {
    const report: any = {};

    for (const [op, metric] of this.metrics) {
      const p95Value = this.calculateP95(metric.p95);
      report[op] = {
        avgTime: metric.totalTime / metric.count,
        errorRate: metric.errors / metric.count,
        p95: p95Value,
        count: metric.count,
      };
    }

    return report;
  }

  private calculateP95(times: number[]): number {
    if (times.length === 0) return 0;
    const sorted = [...times].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index];
  }
}
```

### 5. Optimized Message Batching

```typescript
// For multiple messages in quick succession
export class MessageBatcher {
  private queue: Array<{
    message: string;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  private batchTimer?: NodeJS.Timeout;
  private readonly batchDelay = 100; // 100ms window
  private readonly maxBatchSize = 5;

  async add(message: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, resolve, reject });

      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flush(), this.batchDelay);
      }
    });
  }

  private async flush() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    const batch = this.queue.splice(0, this.maxBatchSize);
    if (batch.length === 0) return;

    try {
      // Send batch to API
      const responses = await this.sendBatch(batch.map(b => b.message));

      // Resolve individual promises
      batch.forEach((item, i) => {
        item.resolve(responses[i]);
      });
    } catch (error) {
      batch.forEach(item => item.reject(error));
    }
  }
}
```

## Implementation Priority

1. **Immediate** (Fix timeouts)
   - Increase crisis message timeout to 45s
   - Add message-type detection for dynamic timeouts

2. **High** (Improve reliability)
   - Add retry logic with exponential backoff
   - Implement crisis response caching

3. **Medium** (Monitoring)
   - Add performance monitoring
   - Create dashboard for metrics

4. **Low** (Optimization)
   - Message batching for bulk operations
   - Response streaming for long content

## Configuration Updates

### Updated .env.local
```bash
# Timeouts (ms)
SHRINK_CHAT_TIMEOUT_REGULAR=15000
SHRINK_CHAT_TIMEOUT_CRISIS=45000
SHRINK_CHAT_TIMEOUT_STREAM=60000

# Retry Configuration
RETRY_MAX_ATTEMPTS=3
RETRY_INITIAL_DELAY=1000
RETRY_BACKOFF_MULTIPLIER=1.5

# Cache Configuration
CRISIS_CACHE_TTL=300000  # 5 minutes
CRISIS_CACHE_ENABLED=true

# Performance Monitoring
ENABLE_PERFORMANCE_MONITORING=true
PERFORMANCE_LOG_INTERVAL=60000  # Log metrics every minute
```

## Expected Improvements

- **Crisis detection success rate**: 60% → 95%
- **Average response time**: 13s → 3s (regular), 25s → 20s (crisis)
- **Timeout errors**: 40% → <5%
- **User experience**: Significant improvement during critical interventions

## Testing Strategy

1. Load test with concurrent crisis messages
2. Measure P95 response times
3. Validate cache hit rates
4. Monitor circuit breaker patterns
5. Test retry logic with simulated failures

## Monitoring Dashboard

Create real-time dashboard showing:
- Response time percentiles (P50, P95, P99)
- Error rates by message type
- Cache hit rates
- Circuit breaker state
- Queue depths (if batching enabled)