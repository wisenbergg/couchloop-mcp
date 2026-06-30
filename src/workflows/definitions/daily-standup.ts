import { Journey } from '../../types/journey.js';

/**
 * Developer Daily Standup — data-driven, runs locally.
 *
 * The agent gathers real signals from the codebase (git, CI, PRs) and leads
 * with facts. The human is only asked for the one thing the data can't know:
 * what they intend to prioritize today.
 */
export const dailyStandup: Journey = {
  slug: 'daily-standup',
  name: 'Developer Daily Standup',
  description: 'Fact-based standup: what actually shipped, what is in flight, CI/review state, and today\'s focus — gathered from the repo, not from memory.',
  estimatedMinutes: 3,
  tags: ['developer', 'daily', 'data-driven'],
  executionMode: 'local',
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'data',
      content: {
        source: 'git_commits',
        params: { since: 'last_session', author: 'current_user' },
        checkpoint_key: 'shipped',
        instructions: 'Gather commits and merged PRs since the user\'s last standup (fall back to the last 24h if no prior session). Run the equivalent of `git log --since=<last_session> --author=<me> --oneline` plus merged PRs via `gh pr list --author @me --state merged`. Present a concise bulleted list of what actually landed. Do not ask the user to recall this — show it.',
      },
      optional: false,
    },
    {
      id: 'step_2',
      order: 2,
      type: 'data',
      content: {
        source: 'git_status',
        checkpoint_key: 'in_progress',
        instructions: 'Show work in flight: `git status --short` for staged/unstaged/untracked, and unpushed commits via `git log @{push}.. --oneline`. Summarize what is mid-flight so the user does not have to describe it.',
      },
      optional: true,
    },
    {
      id: 'step_3',
      order: 3,
      type: 'data',
      content: {
        source: 'ci_status',
        checkpoint_key: 'ci_health',
        instructions: 'Check the latest CI conclusions for the current branch (e.g. `gh run list --branch <branch> --limit 5`). Flag any failing/required checks as blockers. If CI is green, say so in one line.',
      },
      optional: false,
    },
    {
      id: 'step_4',
      order: 4,
      type: 'data',
      content: {
        source: 'pr_review_state',
        checkpoint_key: 'blocked_on_review',
        instructions: 'List the user\'s open PRs and their review state (`gh pr list --author @me`; check for CHANGES_REQUESTED or waiting-on-review). Surface anything blocked on a human. Skip gracefully if there are no open PRs.',
      },
      optional: true,
    },
    {
      id: 'step_5',
      order: 5,
      type: 'prompt',
      content: {
        prompt: 'Given what shipped, what is in flight, and what is blocked above — what is the one thing you want to finish today?',
        checkpoint_key: 'today_goal',
        instructions: 'This is the human-judgment step. The data showed the state; now ask for intent. Push for a single concrete deliverable. Offer to save it as a checkpoint so it can be recalled at the next standup.',
      },
      optional: false,
    },
    {
      id: 'step_6',
      order: 6,
      type: 'summary',
      content: {
        instructions: 'Produce a tight standup: Shipped (from git), In flight (from status), Blocked (CI + review), Today (their goal). Keep it to a few lines. If there are blockers, offer to save them to memory as constraints.',
      },
      optional: false,
    },
  ],
};
