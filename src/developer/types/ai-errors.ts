/**
 * AI Error Pattern Catalog
 * Common mistakes AI agents make when writing code
 */

export interface AIErrorPattern {
  id: string;
  name: string;
  category: 'build' | 'syntax' | 'logic' | 'security' | 'performance' | 'architecture';
  description: string;
  frequency: 'very-common' | 'common' | 'occasional' | 'rare';
  impact: 'critical' | 'high' | 'medium' | 'low';
  examples: string[];
  detection: string;
  prevention: string;
  autoFixable: boolean;
}

/**
 * Catalog of documented AI coding errors
 * Based on real-world observations of AI agent failures
 */
export const AI_ERROR_CATALOG: AIErrorPattern[] = [
  {
    id: 'build-context-blindness',
    name: 'Build Context Blindness',
    category: 'build',
    description: 'AI attempts to build/run code without understanding project configuration',
    frequency: 'very-common',
    impact: 'high',
    examples: [
      'Forgetting .js extensions in TypeScript ESM projects',
      'Using require() in ESM modules',
      'Using import in CommonJS without transpilation',
      'Assuming npm when project uses yarn/pnpm'
    ],
    detection: 'Check tsconfig.json moduleResolution and package.json type field',
    prevention: 'Run build context detection before any code generation',
    autoFixable: true
  },
  {
    id: 'package-hallucination',
    name: 'Package Hallucination',
    category: 'syntax',
    description: 'AI suggests packages that don\'t exist (24% of the time)',
    frequency: 'very-common',
    impact: 'high',
    examples: [
      'import { SuperChart } from "react-super-charts"  // doesn\'t exist',
      'import reqeusts  // typo of "requests"',
      'from beautifulsoup import BeautifulSoup  // should be beautifulsoup4'
    ],
    detection: 'Real-time package registry validation',
    prevention: 'Validate all package names against npm/pypi/maven registries',
    autoFixable: true
  },
  {
    id: 'async-await-confusion',
    name: 'Async/Await Confusion',
    category: 'logic',
    description: 'AI forgets to await async functions or marks sync functions as async',
    frequency: 'very-common',
    impact: 'high',
    examples: [
      'const data = fetch(url);  // Missing await',
      'async function getValue() { return 5; }  // Unnecessary async',
      'promises.forEach(async (p) => await p);  // Doesn\'t wait'
    ],
    detection: 'AST analysis for Promise-returning functions without await',
    prevention: 'Track async context and validate Promise handling',
    autoFixable: true
  },
  {
    id: 'sql-injection-prone',
    name: 'SQL Injection Vulnerability',
    category: 'security',
    description: 'AI generates SQL queries vulnerable to injection',
    frequency: 'common',
    impact: 'critical',
    examples: [
      'db.query(`SELECT * FROM users WHERE id = ${userId}`)',
      'connection.execute("DELETE FROM " + tableName)',
      'WHERE name = \'" + userName + "\'"'
    ],
    detection: 'Pattern matching for string concatenation in SQL',
    prevention: 'Force parameterized queries, block string concatenation',
    autoFixable: true
  },
  {
    id: 'hardcoded-secrets',
    name: 'Hardcoded Secrets',
    category: 'security',
    description: 'AI puts API keys, passwords, and secrets directly in code',
    frequency: 'common',
    impact: 'critical',
    examples: [
      'const API_KEY = "sk-1234567890abcdef"',
      'password: "admin123"',
      'mongodb://user:pass@localhost/db'
    ],
    detection: 'Regex patterns for common secret formats',
    prevention: 'Replace with environment variables automatically',
    autoFixable: true
  },
  {
    id: 'file-path-assumption',
    name: 'File Path Assumption',
    category: 'logic',
    description: 'AI assumes file paths that don\'t exist or uses wrong separators',
    frequency: 'very-common',
    impact: 'medium',
    examples: [
      'fs.readFile("C:\\\\Users\\\\data.txt")  // Windows path on Unix',
      'import data from "../../../config"  // Wrong relative depth',
      'require("./src/utils")  // Path doesn\'t exist'
    ],
    detection: 'File system validation before file operations',
    prevention: 'Use path.join() and validate paths exist',
    autoFixable: true
  },
  {
    id: 'infinite-loop-risk',
    name: 'Infinite Loop Risk',
    category: 'logic',
    description: 'AI creates loops without proper exit conditions',
    frequency: 'occasional',
    impact: 'high',
    examples: [
      'while (true) { if (condition) break; }  // Break might never occur',
      'for (let i = 0; i < arr.length; i--) // Wrong increment',
      'do { value = getValue(); } while (value);  // No guarantee of falsy'
    ],
    detection: 'Static analysis for loop termination conditions',
    prevention: 'Add maximum iteration limits and timeout checks',
    autoFixable: false
  },
  {
    id: 'type-mismatch-blindness',
    name: 'Type Mismatch Blindness',
    category: 'syntax',
    description: 'AI ignores TypeScript types or creates type errors',
    frequency: 'very-common',
    impact: 'medium',
    examples: [
      'function add(a: number, b: number) { return a + b; } add("1", "2")',
      'const user: User = { namn: "John" }  // Typo in property name',
      'return null;  // Function expects string, not null'
    ],
    detection: 'TypeScript compiler API for type checking',
    prevention: 'Run tsc --noEmit before suggesting code',
    autoFixable: true
  },
  {
    id: 'over-engineering',
    name: 'Over-Engineering Simple Tasks',
    category: 'architecture',
    description: 'AI creates unnecessarily complex solutions for simple problems',
    frequency: 'common',
    impact: 'low',
    examples: [
      '// To check if number is even:\nclass EvenChecker { constructor() {} check(n) { return n % 2 === 0; }}',
      'Creating 5 abstraction layers for a 10-line script',
      'Using design patterns where a simple function would suffice'
    ],
    detection: 'Complexity metrics vs problem scope analysis',
    prevention: 'Suggest simpler alternatives when complexity exceeds threshold',
    autoFixable: false
  },
  {
    id: 'api-version-mismatch',
    name: 'API Version Mismatch',
    category: 'syntax',
    description: 'AI uses deprecated or future API features',
    frequency: 'common',
    impact: 'medium',
    examples: [
      'React.createClass({})  // Deprecated in React 16+',
      'document.querySelector().showModal()  // Not in all browsers',
      'Python 2 print statement in Python 3 code'
    ],
    detection: 'Version-aware API compatibility checking',
    prevention: 'Check package.json versions and target environments',
    autoFixable: true
  },
  {
    id: 'resource-leak',
    name: 'Resource Leak',
    category: 'performance',
    description: 'AI forgets to close files, connections, or clean up resources',
    frequency: 'common',
    impact: 'high',
    examples: [
      'const file = fs.openSync(path);  // Never closed',
      'setInterval(() => {}, 1000);  // Never cleared',
      'eventEmitter.on("data", handler);  // Never removed'
    ],
    detection: 'Track resource allocation and disposal patterns',
    prevention: 'Auto-add cleanup code, use try-finally blocks',
    autoFixable: true
  },
  {
    id: 'mutation-of-immutable',
    name: 'Mutating Immutable Data',
    category: 'logic',
    description: 'AI modifies data that should be immutable',
    frequency: 'common',
    impact: 'medium',
    examples: [
      'props.user.name = "New Name"  // Mutating React props',
      'const frozen = Object.freeze({}); frozen.x = 1;',
      'Redux state.items.push(newItem)  // Direct state mutation'
    ],
    detection: 'Track immutable data patterns in framework context',
    prevention: 'Suggest immutable operations (spread, Object.assign)',
    autoFixable: true
  },
  {
    id: 'promise-anti-pattern',
    name: 'Promise Anti-Patterns',
    category: 'logic',
    description: 'AI creates promise anti-patterns like the pyramid of doom',
    frequency: 'common',
    impact: 'low',
    examples: [
      'return new Promise((resolve) => { resolve(asyncFunc()) })',
      'Nested .then() chains instead of async/await',
      'Not returning promises in .then() chains'
    ],
    detection: 'AST pattern matching for promise anti-patterns',
    prevention: 'Suggest async/await refactoring',
    autoFixable: true
  },
  {
    id: 'null-reference-error',
    name: 'Null/Undefined Reference',
    category: 'logic',
    description: 'AI doesn\'t check for null/undefined before accessing properties',
    frequency: 'very-common',
    impact: 'high',
    examples: [
      'const name = user.profile.name  // user or profile might be null',
      'array[0].value  // array might be empty',
      'response.data.items.length  // Multiple unchecked properties'
    ],
    detection: 'Static analysis for property access chains',
    prevention: 'Add optional chaining or null checks',
    autoFixable: true
  },
  {
    id: 'regex-catastrophic-backtrack',
    name: 'Regex Catastrophic Backtracking',
    category: 'performance',
    description: 'AI creates regex patterns vulnerable to ReDoS attacks',
    frequency: 'rare',
    impact: 'critical',
    examples: [
      '/(a+)+$/',
      '/(.*){1,32000}[bc]/',
      '/^((ab)*)+$/'
    ],
    detection: 'Regex complexity analysis for exponential patterns',
    prevention: 'Simplify regex or use alternative parsing methods',
    autoFixable: false
  }
];

/**
 * Get AI errors by category
 */
export function getErrorsByCategory(category: AIErrorPattern['category']): AIErrorPattern[] {
  return AI_ERROR_CATALOG.filter(error => error.category === category);
}

/**
 * Get high-impact errors that should be prevented first
 */
export function getCriticalErrors(): AIErrorPattern[] {
  return AI_ERROR_CATALOG.filter(
    error => error.impact === 'critical' ||
    (error.impact === 'high' && error.frequency === 'very-common')
  );
}

/**
 * Get auto-fixable errors
 */
export function getAutoFixableErrors(): AIErrorPattern[] {
  return AI_ERROR_CATALOG.filter(error => error.autoFixable);
}