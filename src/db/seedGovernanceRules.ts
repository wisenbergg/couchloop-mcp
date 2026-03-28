/**
 * Seed default governance rules into the database
 *
 * Run with: npx tsx src/db/seedGovernanceRules.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { initDatabase } from './client.js';
import { getSupabaseClient, throwOnError } from './supabase-helpers.js';
import { logger } from '../utils/logger.js';

const DEFAULT_RULES = [
  // === PRE-EXECUTION RULES ===
  {
    rule_type: 'package_validation',
    criteria: {
      description: 'Detect typosquatting and suspicious package names',
      patterns: ['lodas', 'expresss', 'reacct', 'axois', 'requets', 'momment'],
      checkNpmRegistry: true,
    },
    thresholds: {
      minDownloads: 1000,
      minAge: 30, // days
      maxSimilarityScore: 0.85,
    },
    action: 'block',
    priority: 100,
    metadata: {
      category: 'security',
      layer: 'pre-execution',
    },
  },
  {
    rule_type: 'security_scan',
    criteria: {
      description: 'Block dangerous code patterns',
      patterns: [
        { regex: 'eval\\s*\\(', severity: 'critical' },
        { regex: 'Function\\s*\\(', severity: 'high' },
        { regex: 'innerHTML\\s*=', severity: 'medium' },
        { regex: 'document\\.write', severity: 'medium' },
        { regex: '(api[_-]?key|secret|password)\\s*[=:]\\s*["\'][^"\']{8,}', severity: 'critical' },
      ],
    },
    thresholds: {
      blockOnCritical: true,
      warnOnHigh: true,
      logOnMedium: true,
    },
    action: 'block',
    priority: 90,
    metadata: {
      category: 'security',
      layer: 'pre-execution',
    },
  },
  {
    rule_type: 'path_traversal',
    criteria: {
      description: 'Prevent path traversal attacks',
      patterns: ['../', '..\\\\', '%2e%2e', '..%2f'],
      allowedPaths: ['/src', '/tests', '/docs'],
    },
    thresholds: {
      strictMode: true,
    },
    action: 'block',
    priority: 95,
    metadata: {
      category: 'security',
      layer: 'pre-execution',
    },
  },

  // === POST-EXECUTION RULES ===
  {
    rule_type: 'code_quality',
    criteria: {
      description: 'Review generated code for quality issues',
      patterns: [
        { regex: 'console\\.log', severity: 'low', message: 'Debug logging found' },
        { regex: 'TODO|FIXME|HACK', severity: 'low', message: 'Unresolved marker' },
        { regex: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}', severity: 'medium', message: 'Empty catch block' },
        { regex: 'any(?![a-zA-Z])', severity: 'low', message: 'TypeScript any usage' },
      ],
    },
    thresholds: {
      maxIssuesWarning: 3,
      maxIssuesBlock: 10,
    },
    action: 'warn',
    priority: 50,
    metadata: {
      category: 'quality',
      layer: 'post-execution',
    },
  },
  {
    rule_type: 'code_smell',
    criteria: {
      description: 'Detect code bloat and over-engineering',
      metrics: {
        maxFunctionLength: 50,
        maxCyclomaticComplexity: 10,
        maxNestedDepth: 4,
        maxParameters: 5,
      },
    },
    thresholds: {
      warnRatio: 0.8,
      blockRatio: 1.2,
    },
    action: 'warn',
    priority: 40,
    metadata: {
      category: 'quality',
      layer: 'post-execution',
    },
  },

  // === BEHAVIORAL RULES (Therapeutic) ===
  {
    rule_type: 'hallucination_detection',
    criteria: {
      description: 'Detect potentially hallucinated medical/safety claims',
      patterns: [
        'studies show',
        'research indicates',
        'according to experts',
        'FDA approved',
        'clinically proven',
      ],
      requiresCitation: true,
    },
    thresholds: {
      confidenceThreshold: 0.7,
    },
    action: 'warn',
    priority: 80,
    metadata: {
      category: 'behavioral',
      layer: 'post-execution',
      domain: 'therapeutic',
    },
  },
  {
    rule_type: 'tone_drift',
    criteria: {
      description: 'Monitor for inappropriate tone shifts',
      baselineTone: ['supportive', 'empathetic', 'professional'],
      problematicTones: ['dismissive', 'condescending', 'clinical'],
    },
    thresholds: {
      driftThreshold: 0.3,
    },
    action: 'warn',
    priority: 70,
    metadata: {
      category: 'behavioral',
      layer: 'post-execution',
      domain: 'therapeutic',
    },
  },
  {
    rule_type: 'crisis_detection',
    criteria: {
      description: 'Detect crisis indicators for immediate intervention',
      patterns: [
        { regex: 'kill myself|end my life|suicide', severity: 'critical' },
        { regex: 'harm myself|hurt myself|self.?harm', severity: 'high' },
        { regex: 'don\'t want to live|no point in living', severity: 'high' },
      ],
    },
    thresholds: {
      immediateEscalation: true,
    },
    action: 'modify',
    priority: 100,
    metadata: {
      category: 'safety',
      layer: 'behavioral',
      domain: 'therapeutic',
      escalationPath: 'crisis_response',
    },
  },
];

async function seedGovernanceRules() {
  try {
    await initDatabase();
    const supabase = getSupabaseClient();

    logger.info('Seeding governance rules...');

    // Clear existing rules (Supabase requires a filter on delete)
    throwOnError(
      await supabase
        .from('governance_rules')
        .delete()
        .not('id', 'is', null),
    );
    logger.info('Cleared existing rules');

    // Insert new rules
    for (const rule of DEFAULT_RULES) {
      throwOnError(
        await supabase.from('governance_rules').insert(rule).select(),
      );
      logger.info(`Added rule: ${rule.rule_type}`);
    }

    logger.info(`Successfully seeded ${DEFAULT_RULES.length} governance rules`);

    // Display summary
    const rules = throwOnError(
      await supabase.from('governance_rules').select('*'),
    ) ?? [];
    console.log('\n=== Governance Rules Summary ===');
    console.table(rules.map((r: Record<string, unknown>) => ({
      type: r.rule_type,
      action: r.action,
      priority: r.priority,
      category: (r.metadata as Record<string, unknown>)?.category,
      layer: (r.metadata as Record<string, unknown>)?.layer,
    })));

    process.exit(0);
  } catch (error) {
    logger.error('Failed to seed governance rules:', error);
    process.exit(1);
  }
}

seedGovernanceRules();
