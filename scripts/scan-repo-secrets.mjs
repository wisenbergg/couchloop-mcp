import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: process.cwd(),
  encoding: 'buffer',
})
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const textExtensions = new Set([
  '.cjs',
  '.cts',
  '.env',
  '.example',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.sql',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

const placeholderPattern = /(change[_ -]?me|placeholder|example|dummy|fake|test|demo|sample|your[_ -]|<[^>]+>|localhost|127\.0\.0\.1|0\.0\.0\.0|xxx\.supabase\.co)/i;
const allowedCredentialTokens = new Set([
  'db',
  'host',
  'password',
  'pass',
  'postgres',
  'project',
  'redis',
  'user',
  'username',
  'your_db_user',
  'your_db_password',
  'your_redis_password',
]);

const issues = [];

for (const file of trackedFiles) {
  const extension = path.extname(file);
  const basename = path.basename(file);
  const shouldRead = textExtensions.has(extension) || basename === '.env.example' || basename.endsWith('.log');

  if (!shouldRead) {
    continue;
  }

  const content = readFileSync(file, 'utf8');
  if (content.includes('\u0000')) {
    continue;
  }

  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    checkHighConfidencePatterns(file, line, lineNumber);
    checkSecretAssignments(file, line, lineNumber);
    checkConnectionStrings(file, line, lineNumber);
  });
}

if (issues.length > 0) {
  console.error('❌ Potential hardcoded sensitive data found in tracked files:');
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line} ${issue.message}`);
  }
  process.exit(1);
}

console.log('✅ No hardcoded sensitive data found in tracked files');

function checkHighConfidencePatterns(file, line, lineNumber) {
  if (isExampleContext(file, line)) {
    return;
  }

  const patterns = [
    { regex: /sk-[A-Za-z0-9_-]{20,}/g, message: 'OpenAI-style API key' },
    { regex: /ghp_[A-Za-z0-9_]{30,}/g, message: 'GitHub personal access token' },
    { regex: /github_pat_[A-Za-z0-9_]{20,}/g, message: 'GitHub fine-grained token' },
    { regex: /AKIA[0-9A-Z]{16}/g, message: 'AWS access key id' },
    { regex: /AIza[0-9A-Za-z_-]{35}/g, message: 'Google API key' },
    { regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, message: 'Private key material' },
    { regex: /['"]openai\/(?:subject|session)['"]\s*:\s*['"]v1\//g, message: 'Logged OpenAI request identifier' },
  ];

  for (const { regex, message } of patterns) {
    if (regex.test(line)) {
      issues.push({ file, line: lineNumber, message });
    }
  }
}

function checkSecretAssignments(file, line, lineNumber) {
  if (isExampleContext(file, line)) {
    return;
  }

  const match = line.match(/\b(?:[A-Z0-9_]*?(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|ACCESS_KEY)|(?:apiKey|token|secret|password|privateKey|serviceRoleKey|accessKey))\b\s*[:=]\s*(['"`])([^'"`\n]+)\1/);
  if (!match) {
    return;
  }

  const value = match[2].trim();
  if (isSafePlaceholder(value)) {
    return;
  }

  issues.push({
    file,
    line: lineNumber,
    message: `Secret-like assignment with non-placeholder value \"${redact(value)}\"`,
  });
}

function checkConnectionStrings(file, line, lineNumber) {
  if (isExampleContext(file, line)) {
    return;
  }

  const match = line.match(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/([^:\s\/]+)(?::([^@\s]+))?@/i);
  if (!match) {
    return;
  }

  const username = match[1];
  const password = match[2] ?? '';
  if (isAllowedCredentialToken(username) && isAllowedCredentialToken(password)) {
    return;
  }

  issues.push({
    file,
    line: lineNumber,
    message: `Connection string contains embedded credentials \"${redact(`${username}:${password}`)}\"`,
  });
}

function isAllowedCredentialToken(value) {
  if (!value) {
    return true;
  }

  return allowedCredentialTokens.has(value.toLowerCase()) || isSafePlaceholder(value);
}

function isSafePlaceholder(value) {
  return placeholderPattern.test(value) || /^\*+$/.test(value) || /^\[REDACTED\]$/i.test(value);
}

function isExampleContext(file, line) {
  const normalizedFile = file.replace(/\\/g, '/');
  const trimmed = line.trim();

  if (/^(tests|docs|archive)\//.test(normalizedFile)) {
    return true;
  }

  if (normalizedFile.endsWith('.md')) {
    return true;
  }

  if (/(^|\W)(example|examples|sample|mock|fixture|dummy|placeholder)(\W|$)/i.test(trimmed)) {
    return true;
  }

  if (trimmed.includes('e.g.')) {
    return true;
  }

  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
    return true;
  }

  return false;
}

function redact(value) {
  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 3)}...${value.slice(-2)}`;
}