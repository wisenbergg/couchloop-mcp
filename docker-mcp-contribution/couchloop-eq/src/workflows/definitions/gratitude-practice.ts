import { Journey } from '../../types/journey.js';

export const gratitudePractice: Journey = {
  slug: 'gratitude-practice',
  name: 'Gratitude Practice',
  description: 'Notice and name three things you appreciate right now.',
  estimatedMinutes: 3,
  tags: ['gratitude', 'daily', 'short'],
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: {
        prompt: 'What\'s something small that made today a little better?',
        checkpoint_key: 'gratitude_1',
        instructions: 'Start with something easy and concrete. A cup of coffee, a text from a friend, a moment of quiet. Small is good.'
      },
      optional: false
    },
    {
      id: 'step_2',
      order: 2,
      type: 'prompt',
      content: {
        prompt: 'What\'s something about yourself you\'re grateful for today?',
        checkpoint_key: 'gratitude_2',
        instructions: 'This can be harder. A quality, a decision they made, something they didn\'t do. Self-directed gratitude.'
      },
      optional: false
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'Who is someone you appreciate, even if you haven\'t told them?',
        checkpoint_key: 'gratitude_3',
        instructions: 'A person - named or described. Can be someone present in their life or from their past.'
      },
      optional: false
    },
    {
      id: 'step_4',
      order: 4,
      type: 'summary',
      content: {
        instructions: 'Reflect back the three gratitudes simply. Note any patterns if obvious. Don\'t over-praise or make it performative.'
      },
      optional: false
    }
  ]
};