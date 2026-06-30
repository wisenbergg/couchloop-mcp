import { Journey } from '../../types/journey.js';

/**
 * Sprint Retrospective — data-driven, runs locally.
 *
 * The agent reconstructs the sprint from real history (commit/PR velocity,
 * where the churn concentrated, reverts, CI health) and presents it, then asks
 * the human for the interpretation and decisions the data can't supply.
 */
export const sprintRetro: Journey = {
  slug: 'sprint-retro',
  name: 'Sprint Retrospective',
  description: 'Evidence-based retro: velocity, hot spots, reverts, and CI health pulled from the repo — then your read on what worked, what did not, and what changes next sprint.',
  estimatedMinutes: 8,
  tags: ['developer', 'weekly', 'data-driven'],
  executionMode: 'local',
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'data',
      content: {
        source: 'git_commits',
        params: { since: 'last_retro', fallback: '2 weeks' },
        checkpoint_key: 'velocity',
        instructions: 'Reconstruct the sprint: commit count, merged PRs, and contributors over the window (`git log --since=<last_retro> --oneline`, `git shortlog -sn --since=<window>`, `gh pr list --state merged --search "merged:>=<date>"`). Present velocity as facts, not a vibe.',
      },
      optional: false,
    },
    {
      id: 'step_2',
      order: 2,
      type: 'data',
      content: {
        source: 'changed_files',
        params: { since: 'last_retro' },
        checkpoint_key: 'hot_spots',
        instructions: 'Show where the work concentrated: most-churned files/dirs over the window (`git log --since=<window> --name-only` aggregated, or `git diff --stat <base>..HEAD`). Hot spots often explain where the pain was.',
      },
      optional: false,
    },
    {
      id: 'step_3',
      order: 3,
      type: 'data',
      content: {
        source: 'recent_reverts',
        params: { since: 'last_retro' },
        checkpoint_key: 'reverts',
        instructions: 'Find reverts/rollbacks and hotfixes in the window (`git log --since=<window> --grep="revert\\|hotfix\\|rollback" -i --oneline`). Each one is a concrete signal of something that went wrong. Skip gracefully if there are none.',
      },
      optional: true,
    },
    {
      id: 'step_4',
      order: 4,
      type: 'data',
      content: {
        source: 'ci_status',
        params: { since: 'last_retro' },
        checkpoint_key: 'ci_health',
        instructions: 'Summarize CI health over the window: failure rate and any repeatedly-failing (flaky) jobs (`gh run list --limit 50` and tally conclusions). Quantify reliability instead of guessing.',
      },
      optional: true,
    },
    {
      id: 'step_5',
      order: 5,
      type: 'prompt',
      content: {
        prompt: 'Looking at the velocity, hot spots, reverts, and CI health above — what actually went well this sprint?',
        checkpoint_key: 'went_well',
        instructions: 'Human judgment, anchored to the data just shown. Tie wins to evidence where possible.',
      },
      optional: false,
    },
    {
      id: 'step_6',
      order: 6,
      type: 'prompt',
      content: {
        prompt: 'What slowed you down or went poorly? Do the reverts / hot spots / CI failures point at a cause?',
        checkpoint_key: 'went_poorly',
        instructions: 'Connect pain points to the signals (a hot-spot file that kept breaking, a flaky job, a revert). Honest, no judgment.',
      },
      optional: false,
    },
    {
      id: 'step_7',
      order: 7,
      type: 'prompt',
      content: {
        prompt: 'What architectural or design decisions did you make, and what were the tradeoffs?',
        checkpoint_key: 'decisions',
        instructions: 'Use the changed-files data to jog memory (schema, deps, API, refactors). Offer to save each as a decision in memory so it persists across sessions.',
      },
      optional: true,
    },
    {
      id: 'step_8',
      order: 8,
      type: 'prompt',
      content: {
        prompt: 'What is the one concrete thing you will change next sprint?',
        checkpoint_key: 'action_item',
        instructions: 'A specific, actionable change — not an aspiration. Save as a decision if the user commits to it.',
      },
      optional: false,
    },
    {
      id: 'step_9',
      order: 9,
      type: 'summary',
      content: {
        instructions: 'Summarize: velocity + hot spots + reverts + CI (the evidence), then wins, pains, decisions, and the action item (the interpretation). Offer to save decisions and the action item to memory for cross-session recall.',
      },
      optional: false,
    },
  ],
};
