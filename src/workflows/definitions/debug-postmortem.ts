import { Journey } from '../../types/journey.js';

/**
 * Debug Postmortem — data-driven, runs locally.
 *
 * The agent anchors the postmortem to the real artifacts (the failing test, the
 * fixing commit/diff) and then asks the human for the root cause and the
 * guardrail — the parts that live in their head, not the repo.
 */
export const debugPostmortem: Journey = {
  slug: 'debug-postmortem',
  name: 'Debug Postmortem',
  description: 'Anchor a postmortem to the real artifacts — the failing test and the fixing diff — then capture root cause and a guardrail so it never recurs.',
  estimatedMinutes: 5,
  tags: ['developer', 'debugging', 'data-driven'],
  executionMode: 'local',
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'data',
      content: {
        source: 'failing_tests',
        checkpoint_key: 'symptom',
        instructions: 'Recover the observable symptom: the failing test name(s) and error/stack output. If the bug is already fixed, pull it from the test that now covers it or the linked issue. Show the concrete symptom rather than asking the user to retype it.',
      },
      optional: true,
    },
    {
      id: 'step_2',
      order: 2,
      type: 'data',
      content: {
        source: 'git_commits',
        params: { grep: 'fix', limit: 10 },
        checkpoint_key: 'fix_commits',
        instructions: 'Identify the commit(s) that fixed the bug and what they touched (`git log --oneline -n 10`, then `git show <sha> --stat`). Present the fix diff scope so the conversation is grounded in the actual change.',
      },
      optional: false,
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'Given the symptom and the fix diff above — what was the actual root cause? Dig past the symptom.',
        checkpoint_key: 'root_cause',
        instructions: 'Human judgment. The diff shows WHAT changed; ask WHY it was wrong (logic error, bad assumption, race, stale cache, misconfig). Anchor the answer to specific lines in the fix.',
      },
      optional: false,
    },
    {
      id: 'step_4',
      order: 4,
      type: 'prompt',
      content: {
        prompt: 'What guardrail would have caught this — a test, a type, an assertion, a lint rule, a CI check?',
        checkpoint_key: 'prevention',
        instructions: 'Push for a concrete, mechanical guard rather than "be more careful". If it is a test, offer to confirm it now exists in the fix.',
      },
      optional: false,
    },
    {
      id: 'step_5',
      order: 5,
      type: 'summary',
      content: {
        instructions: 'Write a compact postmortem: Symptom (from tests) → Root cause (their answer) → Fix (from the diff) → Guardrail. Offer to save the root cause and guardrail to memory as a constraint so the same mistake is not repeated.',
      },
      optional: false,
    },
  ],
};
