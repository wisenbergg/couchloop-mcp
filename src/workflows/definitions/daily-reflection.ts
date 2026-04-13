import { Journey } from '../../types/journey.js';

export const dailyReflection: Journey = {
  slug: 'daily-standup',
  name: 'Developer Daily Standup',
  description: 'Quick self-check: what you shipped, what is blocking you, and what is next.',
  estimatedMinutes: 3,
  tags: ['developer', 'daily', 'short'],
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: {
        prompt: 'What did you ship or make progress on since last check-in?',
        checkpoint_key: 'shipped',
        instructions: 'Accept anything: a PR, a fix, a design decision, even research. If they did not ship, that is fine too.'
      },
      optional: false
    },
    {
      id: 'step_2',
      order: 2,
      type: 'prompt',
      content: {
        prompt: 'Is anything blocking you right now?',
        checkpoint_key: 'blockers',
        instructions: 'Could be technical (failing CI, unclear API), human (waiting on review), or personal (energy, context switching). Offer to save blockers as constraints.'
      },
      optional: false
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'What is the one thing you want to finish today?',
        checkpoint_key: 'today_goal',
        instructions: 'Encourage a single, concrete deliverable. Save it as a checkpoint so they can recall it later.'
      },
      optional: false
    },
    {
      id: 'step_4',
      order: 4,
      type: 'summary',
      content: {
        instructions: 'Recap shipped work, blockers, and today\'s goal. If blockers were mentioned, suggest saving them to memory. Keep it brief and actionable.'
      },
      optional: false
    }
  ]
};