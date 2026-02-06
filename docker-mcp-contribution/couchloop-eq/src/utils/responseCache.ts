import { logger } from './logger.js';
import crypto from 'crypto';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  pattern: string;
  hits: number;
}

export interface CacheOptions {
  ttl?: number;           // Time to live in milliseconds
  maxSize?: number;        // Maximum cache entries
  enableStats?: boolean;   // Track cache statistics
}

/**
 * Response cache for crisis patterns with LRU eviction
 */
export class ResponseCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly options: Required<CacheOptions>;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    saves: 0,
  };

  constructor(options: CacheOptions = {}) {
    this.options = {
      ttl: options.ttl ?? 5 * 60 * 1000,        // 5 minutes default
      maxSize: options.maxSize ?? 100,          // 100 entries default
      enableStats: options.enableStats ?? true,
    };
  }

  /**
   * Extract pattern from crisis message for caching
   */
  private extractPattern(message: string): string {
    const normalized = message.toLowerCase().trim();

    // Define crisis pattern categories
    const patterns: { [key: string]: RegExp[] } = {
      'suicide_ideation': [
        /\b(thinking about|considering|planning) (suicide|killing myself)\b/i,
        /\bsuicidal thoughts?\b/i,
        /\bwant to (die|end it|kill myself)\b/i,
      ],
      'self_harm': [
        /\bself[- ]?harm/i,
        /\b(cutting|cut) myself\b/i,
        /\bhurt(ing)? myself\b/i,
      ],
      'suicide_intent': [
        /\b(going to|will|plan to) (kill myself|end my life|commit suicide)\b/i,
        /\bhave a plan to\b.*\b(die|suicide)\b/i,
      ],
      'overdose': [
        /\boverdos/i,
        /\btake all (the|my) (pills|medication)\b/i,
      ],
      'hopelessness': [
        /\bno point in living\b/i,
        /\bbetter off dead\b/i,
        /\bcan'?t go on\b/i,
      ],
    };

    // Check for exact pattern matches
    for (const [category, regexes] of Object.entries(patterns)) {
      for (const regex of regexes) {
        if (regex.test(normalized)) {
          return category;
        }
      }
    }

    // For non-matching patterns, create a hash of key phrases
    const keyPhrases = normalized
      .replace(/[^\w\s]/g, '')  // Remove punctuation
      .split(/\s+/)              // Split on whitespace
      .filter(word => word.length > 3)  // Keep meaningful words
      .sort()                    // Sort for consistency
      .slice(0, 10)             // Take first 10 words
      .join('_');

    // Create a short hash for the pattern
    return crypto
      .createHash('md5')
      .update(keyPhrases)
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * Get cached response for a message
   */
  get(message: string): T | null {
    const pattern = this.extractPattern(message);
    const entry = this.cache.get(pattern);

    if (!entry) {
      if (this.options.enableStats) {
        this.stats.misses++;
      }
      logger.debug(`Cache miss for pattern: ${pattern}`);
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.cache.delete(pattern);
      if (this.options.enableStats) {
        this.stats.misses++;
        this.stats.evictions++;
      }
      logger.debug(`Cache expired for pattern: ${pattern}`);
      return null;
    }

    // Update hit count and move to end (LRU)
    entry.hits++;
    this.cache.delete(pattern);
    this.cache.set(pattern, entry);

    if (this.options.enableStats) {
      this.stats.hits++;
    }

    logger.info(`Cache hit for pattern: ${pattern} (hits: ${entry.hits})`);
    return entry.data;
  }

  /**
   * Save response to cache
   */
  set(message: string, data: T): void {
    const pattern = this.extractPattern(message);

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.options.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        if (this.options.enableStats) {
          this.stats.evictions++;
        }
        logger.debug(`Evicted oldest cache entry: ${firstKey}`);
      }
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      pattern,
      hits: 0,
    };

    this.cache.set(pattern, entry);

    if (this.options.enableStats) {
      this.stats.saves++;
    }

    logger.debug(`Cached response for pattern: ${pattern}`);
  }

  /**
   * Check if a message would be cached
   */
  has(message: string): boolean {
    const pattern = this.extractPattern(message);
    const entry = this.cache.get(pattern);

    if (!entry) {
      return false;
    }

    // Check expiration
    return Date.now() - entry.timestamp <= this.options.ttl;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`Cleared ${size} cache entries`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    if (!this.options.enableStats) {
      return null;
    }

    const hitRate = this.stats.hits + this.stats.misses > 0
      ? this.stats.hits / (this.stats.hits + this.stats.misses)
      : 0;

    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100,
      size: this.cache.size,
      maxSize: this.options.maxSize,
    };
  }

  /**
   * Get detailed cache info
   */
  getInfo() {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      pattern: key,
      age: Date.now() - entry.timestamp,
      hits: entry.hits,
      expires: this.options.ttl - (Date.now() - entry.timestamp),
    }));

    return {
      stats: this.getStats(),
      entries: entries.sort((a, b) => b.hits - a.hits),  // Sort by hits
    };
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [pattern, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.options.ttl) {
        this.cache.delete(pattern);
        pruned++;
        if (this.options.enableStats) {
          this.stats.evictions++;
        }
      }
    }

    if (pruned > 0) {
      logger.debug(`Pruned ${pruned} expired cache entries`);
    }

    return pruned;
  }
}

/**
 * Specialized cache for crisis responses
 */
export class CrisisResponseCache extends ResponseCache {
  constructor() {
    super({
      ttl: parseInt(process.env.CRISIS_CACHE_TTL || '300000'),  // 5 minutes
      maxSize: parseInt(process.env.CRISIS_CACHE_SIZE || '50'),
      enableStats: true,
    });

    // Set up periodic pruning
    if (process.env.CRISIS_CACHE_ENABLED !== 'false') {
      setInterval(() => this.prune(), 60000);  // Prune every minute
    }
  }

  /**
   * Check if caching should be used for this message
   */
  shouldCache(message: string): boolean {
    // Don't cache if disabled
    if (process.env.CRISIS_CACHE_ENABLED === 'false') {
      return false;
    }

    // Only cache messages with clear crisis indicators
    const crisisKeywords = [
      'suicide', 'kill myself', 'self-harm', 'self harm',
      'end my life', 'overdose', 'cut myself', 'hurt myself',
      'want to die', 'better off dead'
    ];

    const normalized = message.toLowerCase();
    return crisisKeywords.some(keyword => normalized.includes(keyword));
  }
}

// Export singleton instance
export const crisisCache = new CrisisResponseCache();