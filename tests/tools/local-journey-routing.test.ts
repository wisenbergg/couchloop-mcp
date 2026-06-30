import { describe, expect, it } from 'vitest';
import { buildLocalJourneyDirective } from '../../src/tools/sendMessage.js';

const localJourney = {
  slug: 'daily-standup',
  execution_mode: 'local' as const,
  steps: [
    { id: 'step_1', type: 'data', content: { source: 'git_commits', checkpoint_key: 'shipped' } },
    { id: 'step_2', type: 'prompt', content: { prompt: 'today?' } },
  ],
};

describe('buildLocalJourneyDirective — keeps dev journeys off the therapeutic backend', () => {
  it('returns a local directive for an execution_mode=local journey', () => {
    const d = buildLocalJourneyDirective(localJourney, 'sess-1', 0);
    expect(d).not.toBeNull();
    expect(d!.local_execution).toBe(true);
    expect(d!.journey_slug).toBe('daily-standup');
    expect(d!.current_step).toBe(0);
    expect((d!.step as { id: string }).id).toBe('step_1');
    expect(d!.directive).toMatch(/Do NOT send it to the conversation backend/);
  });

  it('returns null for a backend journey (so it routes to shrink-chat as before)', () => {
    const backend = { slug: 'daily-reflection', execution_mode: 'backend' as const, steps: [{}] };
    expect(buildLocalJourneyDirective(backend, 'sess-1', 0)).toBeNull();
  });

  it('returns null when there is no journey', () => {
    expect(buildLocalJourneyDirective(null, 'sess-1', 0)).toBeNull();
    expect(buildLocalJourneyDirective(undefined, 'sess-1', 0)).toBeNull();
  });

  it('exposes the current step and tolerates out-of-range indices', () => {
    expect(buildLocalJourneyDirective(localJourney, 'sess-1', 1)!.step).toMatchObject({ id: 'step_2' });
    expect(buildLocalJourneyDirective(localJourney, 'sess-1', 99)!.step).toBeNull();
    expect(buildLocalJourneyDirective(localJourney, 'sess-1', -1)!.step).toBeNull();
  });
});
