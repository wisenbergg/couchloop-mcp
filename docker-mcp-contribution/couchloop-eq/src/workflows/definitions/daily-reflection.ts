import { Journey } from '../../types/journey.js';

export const dailyReflection: Journey = {
  slug: 'daily-reflection',
  name: 'Daily Reflection',
  description: 'A brief check-in to process your day and capture key moments.',
  estimatedMinutes: 5,
  tags: ['reflection', 'daily', 'short'],
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: {
        prompt: 'How are you feeling right now? Take a moment to notice.',
        checkpoint_key: 'initial_mood',
        instructions: 'Gently invite the user to check in with their current state. Accept any response - single words, emotions, physical sensations.'
      },
      optional: false
    },
    {
      id: 'step_2',
      order: 2,
      type: 'prompt',
      content: {
        prompt: 'What\'s one thing that happened today that you want to remember?',
        checkpoint_key: 'memorable_moment',
        instructions: 'Help the user identify something meaningful - positive or negative. The goal is noticing, not evaluating.'
      },
      optional: false
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'Is there anything you\'d like to let go of before tomorrow?',
        checkpoint_key: 'release',
        instructions: 'This is optional and can be skipped. No pressure to identify something.'
      },
      optional: true
    },
    {
      id: 'step_4',
      order: 4,
      type: 'summary',
      content: {
        instructions: 'Briefly summarize what was shared. Acknowledge their reflection without excessive praise. Offer to save any insights that emerged.'
      },
      optional: false
    }
  ]
};