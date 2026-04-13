import { Journey } from '../../types/journey.js';

export const weeklyReview: Journey = {
  slug: 'sprint-retro',
  name: 'Sprint Retrospective',
  description: 'Reflect on what worked, what did not, and capture decisions for next sprint.',
  estimatedMinutes: 8,
  tags: ['developer', 'weekly', 'medium'],
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: {
        prompt: 'What went well this sprint? What are you proud of?',
        checkpoint_key: 'went_well',
        instructions: 'Shipped features, solved tricky bugs, good team dynamics, learned something new. Anything positive.'
      },
      optional: false
    },
    {
      id: 'step_2',
      order: 2,
      type: 'prompt',
      content: {
        prompt: 'What did not go well? What slowed you down?',
        checkpoint_key: 'went_poorly',
        instructions: 'Flaky tests, unclear requirements, scope creep, burnout, bad estimates. Be honest, no judgment.'
      },
      optional: false
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'Did you make any architectural or design decisions this sprint? What were the tradeoffs?',
        checkpoint_key: 'decisions',
        instructions: 'DB schema choices, library picks, API design, refactor strategies. Offer to save these as decisions in memory so they persist.'
      },
      optional: false
    },
    {
      id: 'step_4',
      order: 4,
      type: 'prompt',
      content: {
        prompt: 'Any recurring mistakes or patterns you want to stop repeating?',
        checkpoint_key: 'anti_patterns',
        instructions: 'Forgetting to add tests, skipping error handling, over-engineering. Offer to save these as constraints (tagged "ai-mistake" if AI-related).'
      },
      optional: true
    },
    {
      id: 'step_5',
      order: 5,
      type: 'prompt',
      content: {
        prompt: 'What is one thing you want to do differently next sprint?',
        checkpoint_key: 'action_item',
        instructions: 'A concrete, actionable change. Not a vague aspiration. Save as a decision if the user is committed.'
      },
      optional: false
    },
    {
      id: 'step_6',
      order: 6,
      type: 'summary',
      content: {
        instructions: 'Summarize wins, pain points, key decisions, and the action item. Offer to save decisions and anti-patterns to memory for cross-session recall. Keep it structured and developer-friendly.'
      },
      optional: false
    }
  ]
};