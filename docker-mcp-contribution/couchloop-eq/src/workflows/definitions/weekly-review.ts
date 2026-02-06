import { Journey } from '../../types/journey.js';

export const weeklyReview: Journey = {
  slug: 'weekly-review',
  name: 'Weekly Review',
  description: 'Look back on your week and set intentions for the next one.',
  estimatedMinutes: 10,
  tags: ['reflection', 'weekly', 'medium'],
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: {
        prompt: 'How would you describe this past week in a few words?',
        checkpoint_key: 'week_summary',
        instructions: 'Get a quick temperature read. Could be emotional tone, pace, theme. No right answer.'
      },
      optional: false
    },
    {
      id: 'step_2',
      order: 2,
      type: 'prompt',
      content: {
        prompt: 'What\'s one thing you accomplished that you want to acknowledge?',
        checkpoint_key: 'accomplishment',
        instructions: 'Help them find something - doesn\'t have to be big. Finishing something, showing up, making progress.'
      },
      optional: false
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'What challenged you this week? How did you respond?',
        checkpoint_key: 'challenge',
        instructions: 'Not looking for silver linings. Just noticing what was hard and how they navigated it.'
      },
      optional: false
    },
    {
      id: 'step_4',
      order: 4,
      type: 'prompt',
      content: {
        prompt: 'Is there anything left unfinished that\'s weighing on you?',
        checkpoint_key: 'unfinished',
        instructions: 'Open loops, incomplete tasks, things they\'re avoiding. Optional to answer but worth asking.'
      },
      optional: true
    },
    {
      id: 'step_5',
      order: 5,
      type: 'prompt',
      content: {
        prompt: 'What\'s one intention you want to carry into next week?',
        checkpoint_key: 'intention',
        instructions: 'Not a goal or task. An intention - how they want to show up, what they want to prioritize, a quality to embody.'
      },
      optional: false
    },
    {
      id: 'step_6',
      order: 6,
      type: 'summary',
      content: {
        instructions: 'Summarize the arc: how the week felt, what they accomplished, what challenged them, and their intention going forward. Keep it grounded.'
      },
      optional: false
    }
  ]
};