import { describe, expect, it } from 'vitest';
import {
  JourneySchema,
  JourneyStepSchema,
  JourneyDataSourceSchema,
} from '../../src/types/journey.js';
import { journeyDefinitions, journeysBySlug } from '../../src/workflows/index.js';

const DEV_SLUGS = ['daily-standup', 'sprint-retro', 'debug-postmortem'];
const WELLNESS_SLUGS = ['daily-reflection', 'gratitude-practice', 'weekly-review'];

describe('Journey schema — data steps & execution mode', () => {
  it('accepts a valid data step that declares a source', () => {
    const result = JourneyStepSchema.safeParse({
      id: 'step_1',
      order: 1,
      type: 'data',
      content: { source: 'git_commits', checkpoint_key: 'shipped' },
      optional: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a data step with no source', () => {
    const result = JourneyStepSchema.safeParse({
      id: 'step_1',
      order: 1,
      type: 'data',
      content: { instructions: 'do something' },
      optional: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a data step with an unknown source', () => {
    const result = JourneyStepSchema.safeParse({
      id: 'step_1',
      order: 1,
      type: 'data',
      content: { source: 'rm_rf_slash' },
      optional: false,
    });
    expect(result.success).toBe(false);
  });

  it('still accepts a plain prompt step without a source', () => {
    const result = JourneyStepSchema.safeParse({
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: { prompt: 'How are you?' },
      optional: false,
    });
    expect(result.success).toBe(true);
  });

  it('defaults executionMode to "backend" when omitted', () => {
    const parsed = JourneySchema.parse({
      slug: 'x',
      name: 'X',
      description: 'd',
      estimatedMinutes: 1,
      tags: [],
      steps: [
        { id: 's1', order: 1, type: 'prompt', content: { prompt: 'hi' }, optional: false },
      ],
    });
    expect(parsed.executionMode).toBe('backend');
  });

  it('exposes exactly the vetted data sources (no shell commands)', () => {
    // Guards against anyone slipping a raw-command escape hatch into the enum.
    expect(JourneyDataSourceSchema.options).toEqual([
      'git_commits',
      'git_status',
      'git_diff_stat',
      'changed_files',
      'recent_reverts',
      'open_prs',
      'pr_review_state',
      'ci_status',
      'failing_tests',
      'todo_comments',
    ]);
  });
});

describe('Journey definitions registry', () => {
  it('registers all 6 journeys (3 dev + 3 wellness)', () => {
    expect(journeyDefinitions).toHaveLength(6);
    for (const slug of [...DEV_SLUGS, ...WELLNESS_SLUGS]) {
      expect(journeysBySlug.has(slug)).toBe(true);
    }
  });

  it('every definition is schema-valid', () => {
    for (const journey of journeyDefinitions) {
      const result = JourneySchema.safeParse(journey);
      expect(result.success, `${journey.slug} failed schema validation`).toBe(true);
    }
  });

  it('dev journeys run locally and lead with real data', () => {
    for (const slug of DEV_SLUGS) {
      const j = journeysBySlug.get(slug)!;
      expect(j.executionMode, `${slug} should be local`).toBe('local');
      const dataSteps = j.steps.filter((s) => s.type === 'data');
      expect(dataSteps.length, `${slug} should have data steps`).toBeGreaterThan(0);
      for (const s of dataSteps) {
        expect(s.content.source, `${slug} data step missing source`).toBeTruthy();
      }
      // The first step should be data, not an introspective prompt.
      expect(j.steps[0].type, `${slug} should open with data`).toBe('data');
    }
  });

  it('wellness journeys stay on the therapeutic backend with no data steps', () => {
    for (const slug of WELLNESS_SLUGS) {
      const j = journeysBySlug.get(slug)!;
      expect(j.executionMode, `${slug} should be backend`).toBe('backend');
      expect(j.steps.some((s) => s.type === 'data'), `${slug} should not gather codebase data`).toBe(false);
    }
  });
});
