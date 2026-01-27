import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../../utils/logger.js';
import {
  ContextEntry,
  ContextCategoryType,
  ContextMetadata,
  PreserveContextResponse,
} from '../../types/context.js';

const CONTEXT_STORE_PATH = path.join(process.cwd(), 'src', 'db', 'context-store.json');
const MAX_CONTEXT_WINDOW_TOKENS = 200000; // Approximate token limit
const AVG_CHARS_PER_TOKEN = 4; // Average characters per token

interface ContextStore {
  version: string;
  entries: ContextEntry[];
  metadata: {
    created_at: string;
    last_updated: string;
  };
}

export class ContextManager {
  private store: ContextStore;
  private isInitialized = false;

  constructor() {
    this.store = {
      version: '1.0.0',
      entries: [],
      metadata: {
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
    };
  }

  /**
   * Initialize the context store from disk
   */
  async initialize(): Promise<void> {
    try {
      // Create parent directory if it doesn't exist
      const dir = path.dirname(CONTEXT_STORE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Load existing store or create new one
      if (fs.existsSync(CONTEXT_STORE_PATH)) {
        const data = fs.readFileSync(CONTEXT_STORE_PATH, 'utf-8');
        this.store = JSON.parse(data);
        logger.info(`Loaded context store with ${this.store.entries.length} entries`);
      } else {
        this.createDefaultStore();
        this.save();
        logger.info('Created new context store');
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize context manager:', error);
      throw new Error(`Context manager initialization failed: ${error}`);
    }
  }

  /**
   * Store a context entry
   */
  async storeEntry(
    category: ContextCategoryType,
    content: string,
  ): Promise<PreserveContextResponse> {
    this.ensureInitialized();

    try {
      const entry: ContextEntry = {
        id: nanoid(),
        category,
        content,
        timestamp: new Date(),
        usage_count: 0,
        last_retrieved: null,
      };

      this.store.entries.push(entry);
      this.store.metadata.last_updated = new Date().toISOString();
      this.save();

      logger.info(`Stored context entry: ${entry.id} in category: ${category}`);

      return {
        success: true,
        action: 'store',
        message: `Successfully stored context in "${category}" category`,
        data: [entry],
      };
    } catch (error) {
      logger.error('Error storing context:', error);
      throw new Error(`Failed to store context: ${error}`);
    }
  }

  /**
   * Retrieve context entries by category or search term
   */
  async retrieve(
    category?: ContextCategoryType,
    searchTerm?: string,
  ): Promise<PreserveContextResponse> {
    this.ensureInitialized();

    try {
      let results = this.store.entries;

      // Filter by category if provided
      if (category) {
        results = results.filter((e) => e.category === category);
      }

      // Filter by search term if provided
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        results = results.filter((e) => e.content.toLowerCase().includes(term));
      }

      // Update usage count and last retrieved timestamp
      results.forEach((entry) => {
        entry.usage_count += 1;
        entry.last_retrieved = new Date();
      });

      this.store.metadata.last_updated = new Date().toISOString();
      this.save();

      if (results.length === 0) {
        return {
          success: true,
          action: 'retrieve',
          message: `No context found${category ? ` in category "${category}"` : ''}${
            searchTerm ? ` matching "${searchTerm}"` : ''
          }`,
          data: null,
        };
      }

      logger.info(`Retrieved ${results.length} context entries`);

      return {
        success: true,
        action: 'retrieve',
        message: `Retrieved ${results.length} context entries`,
        data: results,
      };
    } catch (error) {
      logger.error('Error retrieving context:', error);
      throw new Error(`Failed to retrieve context: ${error}`);
    }
  }

  /**
   * Check context window status and provide warnings if needed
   */
  async check(includeMetadata: boolean = false): Promise<PreserveContextResponse> {
    this.ensureInitialized();

    try {
      const metadata = this.getMetadata();

      let warning: string | undefined;
      if (metadata.context_window_usage_percent > 80) {
        warning = `Context window is ${metadata.context_window_usage_percent.toFixed(
          1,
        )}% full. Consider archiving or cleaning up old context entries.`;
      } else if (metadata.context_window_usage_percent > 60) {
        warning = `Context window is ${metadata.context_window_usage_percent.toFixed(
          1,
        )}% full. You may want to monitor usage.`;
      }

      const response: PreserveContextResponse = {
        success: true,
        action: 'check',
        message: `Context store contains ${metadata.total_entries} entries`,
        warning,
      };

      if (includeMetadata) {
        response.data = metadata;
      }

      return response;
    } catch (error) {
      logger.error('Error checking context:', error);
      throw new Error(`Failed to check context: ${error}`);
    }
  }

  /**
   * Get metadata about the context store
   */
  private getMetadata(): ContextMetadata {
    const entriesByCategory: Record<ContextCategoryType, number> = {
      architecture: 0,
      requirements: 0,
      constraints: 0,
      decisions: 0,
      'technical-patterns': 0,
      'project-metadata': 0,
    };

    let totalBytes = 0;

    this.store.entries.forEach((entry) => {
      entriesByCategory[entry.category]++;
      totalBytes += entry.content.length;
    });

    const estimatedTokens = totalBytes / AVG_CHARS_PER_TOKEN;
    const usagePercent = (estimatedTokens / MAX_CONTEXT_WINDOW_TOKENS) * 100;

    return {
      total_entries: this.store.entries.length,
      entries_by_category: entriesByCategory,
      total_stored_bytes: totalBytes,
      last_updated: new Date(this.store.metadata.last_updated),
      context_window_usage_percent: Math.min(usagePercent, 100),
    };
  }

  /**
   * Clear old or unused context entries (cleanup)
   */
  async cleanup(daysOld: number = 30): Promise<PreserveContextResponse> {
    this.ensureInitialized();

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const beforeCount = this.store.entries.length;
      this.store.entries = this.store.entries.filter((entry) => {
        const entryDate = new Date(entry.timestamp);
        return entryDate > cutoffDate;
      });

      const removedCount = beforeCount - this.store.entries.length;
      this.store.metadata.last_updated = new Date().toISOString();
      this.save();

      logger.info(`Cleaned up ${removedCount} context entries older than ${daysOld} days`);

      return {
        success: true,
        action: 'retrieve',
        message: `Removed ${removedCount} entries older than ${daysOld} days`,
      };
    } catch (error) {
      logger.error('Error cleaning context:', error);
      throw new Error(`Failed to cleanup context: ${error}`);
    }
  }

  /**
   * Export all context for backup
   */
  async export(): Promise<ContextStore> {
    this.ensureInitialized();
    return JSON.parse(JSON.stringify(this.store));
  }

  /**
   * Import context from backup
   */
  async import(store: ContextStore): Promise<void> {
    try {
      this.store = store;
      this.store.metadata.last_updated = new Date().toISOString();
      this.save();
      logger.info('Imported context store');
    } catch (error) {
      logger.error('Error importing context:', error);
      throw new Error(`Failed to import context: ${error}`);
    }
  }

  /**
   * Create default context store
   */
  private createDefaultStore(): void {
    this.store = {
      version: '1.0.0',
      entries: [
        {
          id: nanoid(),
          category: 'project-metadata',
          content: 'CouchLoop MCP Server - Model Context Protocol server for stateful conversation management',
          timestamp: new Date(),
          usage_count: 0,
          last_retrieved: null,
        },
        {
          id: nanoid(),
          category: 'architecture',
          content:
            'CouchLoop uses PostgreSQL via Supabase with Drizzle ORM. MCP protocol via stdio for communication. Session/journey/checkpoint management.',
          timestamp: new Date(),
          usage_count: 0,
          last_retrieved: null,
        },
        {
          id: nanoid(),
          category: 'requirements',
          content:
            'Must support multi-turn conversations, session persistence across interruptions, guided journeys, crisis detection via shrink-chat integration',
          timestamp: new Date(),
          usage_count: 0,
          last_retrieved: null,
        },
      ],
      metadata: {
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
    };
  }

  /**
   * Save store to disk
   */
  private save(): void {
    try {
      const dir = path.dirname(CONTEXT_STORE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONTEXT_STORE_PATH, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Failed to save context store:', error);
      throw new Error(`Failed to persist context: ${error}`);
    }
  }

  /**
   * Ensure manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(
        'ContextManager not initialized. Call initialize() before using other methods.',
      );
    }
  }
}

// Singleton instance
let instance: ContextManager | null = null;

export async function getContextManager(): Promise<ContextManager> {
  if (!instance) {
    instance = new ContextManager();
    await instance.initialize();
  }
  return instance;
}
