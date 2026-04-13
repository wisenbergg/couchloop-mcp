import { Journey } from '../../types/journey.js';

export const gratitudePractice: Journey = {
  slug: 'debug-postmortem',
  name: 'Debug Postmortem',
  description: 'Just fixed a tricky bug? Capture what happened and what you learned so you never hit it again.',
  estimatedMinutes: 5,
  tags: ['developer', 'debugging', 'short'],
  steps: [
    {
      id: 'step_1',
      order: 1,
      type: 'prompt',
      content: {
        prompt: 'What was the bug or issue? Describe the symptoms you saw.',
        checkpoint_key: 'bug_symptoms',
        instructions: 'Error messages, wrong behavior, failing test. Get the observable facts first.'
      },
      optional: false
    },
    {
      id: 'step_2',
      order: 2,
      type: 'prompt',
      content: {
        prompt: 'What was the root cause?',
        checkpoint_key: 'root_cause',
        instructions: 'The actual underlying problem. Could be a logic error, wrong assumption, stale cache, race condition, misconfiguration. Dig past the symptom.'
      },
      optional: false
    },
    {
      id: 'step_3',
      order: 3,
      type: 'prompt',
      content: {
        prompt: 'How did you find it? What debugging steps led you to the fix?',
        checkpoint_key: 'debug_path',
        instructions: 'The process matters as much as the fix. Logging, bisect, reading source, rubber ducking, checking Stack Overflow. Capture the technique.'
      },
      optional: false
    },
    {
      id: 'step_4',
      order: 4,
      type: 'summary',
      content: {
        instructions: 'Write a compact postmortem: symptom, root cause, fix, and lesson learned. Offer to save the root cause and lesson as a decision or constraint in memory so the AI (and the user) does not repeat this mistake.'
      },
      optional: false
    }
  ]
};