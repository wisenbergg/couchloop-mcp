/**
 * Secret Scanner
 * Detects hardcoded secrets in code including:
 * - API keys (AWS, OpenAI, Stripe, etc.)
 * - Passwords
 * - Private keys
 * - Connection strings with credentials
 * - Tokens and tokens
 */

export interface SecretVulnerability {
  type: 'HARDCODED_API_KEY' | 'HARDCODED_PASSWORD' | 'PRIVATE_KEY' | 'CONNECTION_STRING' | 'JWT_TOKEN' | 'GENERIC_SECRET';
  severity: 'CRITICAL' | 'HIGH';
  line: number;
  column: number;
  code: string;
  issue: string;
  cwe: string;
  fix: string;
  secretType?: string;
  secretPreview?: string;
}

export class SecretScanner {
  private vulnerabilities: SecretVulnerability[] = [];

  // Regex patterns for detecting different types of secrets
  private readonly patterns = {
    // AWS
    awsAccessKey: /(?:aws_access_key_id|AKIA)[A-Z0-9]{16,}/gi,
    awsSecretKey: /(?:aws_secret_access_key|aws_key)['\s=]*[A-Za-z0-9/+=]{40,}/gi,

    // API Keys
    openaiKey: /sk-[A-Za-z0-9\-_]{20,}/g,
    stripeKey: /(?:sk_live|pk_live)_[A-Za-z0-9]{20,}/gi,
    googleApiKey: /AIza[0-9A-Za-z\-_]{35}/g,
    githubToken: /ghp_[A-Za-z0-9_]{36,255}/g,
    digitalOceanToken: /dop_v1_[A-Za-z0-9_]{40,}/g,

    // Connection Strings
    mongodbUri: /mongodb\+?srv?:\/\/.+?:.+?@/gi,
    postgresUri: /postgres(ql)?:\/\/.+?:.+?@/gi,
    mysqlUri: /mysql:\/\/.+?:.+?@/gi,

    // Private Keys
    rsaPrivateKey: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    opensshPrivateKey: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/gi,
    pgpPrivateKey: /-----BEGIN\s+PGP\s+PRIVATE\s+KEY-----/gi,

    // JWT
    jwtToken: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,

    // Basic Passwords
    passwordAssignment: /(?:password|passwd|pwd|secret)\s*[:=]\s*['\"`]([^'\"`;]+)['\"`]/gi,
    hardcodedAdmin: /(?:password|passwd)\s*=\s*['\"](?:admin|Admin123|password|123456|password123)['\"]|\b(?:admin|root|sa|user)\s*=\s*['\"](?:admin|password|123456)['\"]|\b(?:password|secret)\s*=\s*['\"][^'\"]*(?:test|temp|demo|pass|secret)[^'\"]*['\"]/gi,
  };

  /**
   * Scan code for hardcoded secrets
   */
  scan(code: string): SecretVulnerability[] {
    this.vulnerabilities = [];
    const lines = code.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // Skip common safe patterns
      if (this.isSafeIgnore(line)) return;

      this.checkAwsKeys(line, lineNum);
      this.checkApiKeys(line, lineNum);
      this.checkConnectionStrings(line, lineNum);
      this.checkPrivateKeys(line, lineNum);
      this.checkPasswords(line, lineNum);
      this.checkJwtTokens(line, lineNum);
    });

    return this.vulnerabilities;
  }

  /**
   * Check if line should be ignored (comments, examples, etc.)
   */
  private isSafeIgnore(line: string): boolean {
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      return true;
    }

    // Skip type definitions and interfaces (they describe shape, not values)
    if (/^\s*(type|interface|export\s+type|export\s+interface)\b/.test(trimmed)) {
      return true;
    }

    // Skip validation schemas (Zod, Joi, etc.) that are purely schema definitions
    // but NOT if they contain .default() with a real-looking value
    if (/z\.(string|number|object|enum|boolean)/.test(trimmed) && !(/\.default\s*\(\s*['"][^'"]{8,}['"]/.test(trimmed))) {
      return true;
    }

    // Skip lines referencing environment variables (they're doing the right thing)
    if (trimmed.includes('process.env') || trimmed.includes('import.meta.env') || trimmed.includes('os.getenv')) {
      return true;
    }

    // Skip placeholder and example values
    if (trimmed.includes('YOUR_') || trimmed.includes('your_') || trimmed.includes('YOUR-') || 
        trimmed.includes('xxxx') || trimmed.includes('changeme') || trimmed.includes('placeholder')) {
      return true;
    }

    // Skip .describe() or documentation patterns
    if (trimmed.includes('.describe(') || trimmed.includes('.description')) {
      return true;
    }

    // Skip test/example/mock files with common patterns
    if (line.includes('example') || line.includes('test') || line.includes('mock') || line.includes('fixture')) {
      // Unless they contain actual assignment of real-looking secrets
      if (!/(?:sk-|pk_live|AKIA|ghp_)[A-Za-z0-9]{15,}/.test(trimmed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for AWS keys
   */
  private checkAwsKeys(line: string, lineNum: number): void {
    // AWS Access Key
    const accessMatches = Array.from(line.matchAll(this.patterns.awsAccessKey));
    for (const match of accessMatches) {
      const code = match[0];
      if (this.isCommentOrString(line, line.indexOf(code))) continue;

      const column = line.indexOf(code) + 1;
      this.vulnerabilities.push({
        type: 'HARDCODED_API_KEY',
        severity: 'CRITICAL',
        line: lineNum,
        column: column,
        code: code,
        secretType: 'AWS Access Key ID',
        secretPreview: code.substring(0, 8) + '...' + code.substring(code.length - 4),
        issue: `Hardcoded AWS Access Key ID found: ${this.redact(code)}. This grants access to AWS resources.`,
        cwe: 'CWE-798: Use of Hard-Coded Credentials',
        fix: `Use AWS IAM roles or credentials from environment:\n  import { AWS_SDK } from 'aws-sdk';\n  // Let AWS SDK load from env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY\n  // Or use IAM role in Lambda/EC2\n  const credentials = new AWS_SDK.Credentials(process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY);\n\nOr use AWS CLI config file:\n  ~/.aws/credentials or ~/.aws/config`
      });
    }

    // AWS Secret Key
    const secretMatches = Array.from(line.matchAll(this.patterns.awsSecretKey));
    for (const match of secretMatches) {
      const code = match[0];
      if (this.isCommentOrString(line, line.indexOf(code))) continue;

      const column = line.indexOf(code) + 1;
      this.vulnerabilities.push({
        type: 'HARDCODED_API_KEY',
        severity: 'CRITICAL',
        line: lineNum,
        column: column,
        code: code,
        secretType: 'AWS Secret Access Key',
        secretPreview: code.substring(0, 8) + '...' + code.substring(code.length - 4),
        issue: `Hardcoded AWS Secret Access Key found: ${this.redact(code)}. This grants full access to AWS resources.`,
        cwe: 'CWE-798: Use of Hard-Coded Credentials',
        fix: `Use environment variables:\n  const awsSecret = process.env.AWS_SECRET_ACCESS_KEY;\n  if (!awsSecret) throw new Error('Missing AWS_SECRET_ACCESS_KEY');\n\nStore in .env (add .env to .gitignore):\n  AWS_ACCESS_KEY_ID=...\n  AWS_SECRET_ACCESS_KEY=...\n\nOr use AWS IAM roles (recommended for production).`
      });
    }
  }

  /**
   * Check for API keys (OpenAI, Stripe, GitHub, etc.)
   */
  private checkApiKeys(line: string, lineNum: number): void {
    const keyPatterns = [
      { pattern: this.patterns.openaiKey, type: 'OpenAI API Key', name: 'OpenAI' },
      { pattern: this.patterns.stripeKey, type: 'Stripe API Key', name: 'Stripe' },
      { pattern: this.patterns.googleApiKey, type: 'Google API Key', name: 'Google' },
      { pattern: this.patterns.githubToken, type: 'GitHub Personal Access Token', name: 'GitHub' },
      { pattern: this.patterns.digitalOceanToken, type: 'DigitalOcean Token', name: 'DigitalOcean' },
    ];

    for (const { pattern, type, name } of keyPatterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isCommentOrString(line, line.indexOf(code))) continue;

        const column = line.indexOf(code) + 1;

        this.vulnerabilities.push({
          type: 'HARDCODED_API_KEY',
          severity: 'CRITICAL',
          line: lineNum,
          column: column,
          code: code,
          secretType: type,
          secretPreview: code.substring(0, 8) + '...' + code.substring(code.length - 4),
          issue: `Hardcoded ${type} found: ${this.redact(code)}. This allows unauthorized API access.`,
          cwe: 'CWE-798: Use of Hard-Coded Credentials',
          fix: `Use environment variables:\n  const apiKey = process.env.${name.toUpperCase()}_API_KEY;\n  if (!apiKey) throw new Error('Missing ${name.toUpperCase()}_API_KEY');\n  const client = new ${name}Client({ apiKey });\n\nStore in .env file (add to .gitignore):\n  ${name.toUpperCase()}_API_KEY=sk-...\n\nFor deployment, use secrets management:\n  - GitHub Secrets (for CI/CD)\n  - AWS Secrets Manager\n  - Vercel Environment Variables\n  - HashiCorp Vault`
        });
      }
    }
  }

  /**
   * Check for connection strings with embedded credentials
   */
  private checkConnectionStrings(line: string, lineNum: number): void {
    const connPatterns = [
      { pattern: this.patterns.mongodbUri, type: 'MongoDB Connection String', name: 'MongoDB' },
      { pattern: this.patterns.postgresUri, type: 'PostgreSQL Connection String', name: 'PostgreSQL' },
      { pattern: this.patterns.mysqlUri, type: 'MySQL Connection String', name: 'MySQL' },
    ];

    for (const { pattern, type, name } of connPatterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isCommentOrString(line, line.indexOf(code))) continue;

        const column = line.indexOf(code) + 1;

        this.vulnerabilities.push({
          type: 'CONNECTION_STRING',
          severity: 'HIGH',
          line: lineNum,
          column: column,
          code: code,
          secretType: type,
          secretPreview: this.redact(code),
          issue: `Hardcoded ${type} with credentials: ${this.redact(code)}. Database credentials should never be in code.`,
          cwe: 'CWE-798: Use of Hard-Coded Credentials',
          fix: `Use environment variables:\n  const dbUrl = process.env.DATABASE_URL;\n  if (!dbUrl) throw new Error('Missing DATABASE_URL');\n  const client = await new ${name}Client({ url: dbUrl });\n\nFormat for .env:\n  DATABASE_URL=${name.toLowerCase()}://user:password@host:port/database\n\nFor production, use:\n  - Vercel Environment Variables\n  - AWS RDS proxy with IAM auth\n  - Cloud provider secret managers`
        });
      }
    }
  }

  /**
   * Check for private keys in code
   */
  private checkPrivateKeys(line: string, lineNum: number): void {
    if (line.includes('BEGIN PRIVATE KEY') || line.includes('BEGIN RSA PRIVATE KEY') ||
        line.includes('BEGIN OPENSSH PRIVATE KEY') || line.includes('BEGIN PGP PRIVATE KEY')) {

      const column = line.indexOf('BEGIN') + 1;

      this.vulnerabilities.push({
        type: 'PRIVATE_KEY',
        severity: 'CRITICAL',
        line: lineNum,
        column: column,
        code: line.substring(0, Math.min(line.length, 80)),
        secretType: 'Private Key',
        issue: `Private key found in code: ${line.substring(0, 40)}... This is a critical security issue.`,
        cwe: 'CWE-798: Use of Hard-Coded Credentials',
        fix: `Never commit private keys. Instead:\n  1. Generate key pair\n  2. Store private key in secure location (e.g., ~/.ssh/id_rsa with 600 permissions)\n  3. Store public key or certificate in code\n  4. Load private key at runtime from secure location\n  5. Use key management services:\n     - AWS Secrets Manager\n     - HashiCorp Vault\n     - Azure Key Vault\n     - GitHub encrypted secrets\n  6. Use SSH agent for authentication\n\nIf accidentally committed:\n  1. Revoke the key immediately\n  2. git filter-branch or BFG to remove from history\n  3. Generate new key`
      });
    }
  }

  /**
   * Check for hardcoded passwords
   */
  private checkPasswords(line: string, lineNum: number): void {
    // Skip if it's a password field definition, type, schema, or validation
    if (/password\s*[?]?:\s*(string|String|z\.)/.test(line)) return;
    // Skip bcrypt/hash comparisons (they're handling passwords correctly)
    if (line.includes('bcrypt') || line.includes('hash') || line.includes('compare')) return;
    // Skip field name references in objects/destructuring
    if (/['"]password['"]\s*[,}\]]/.test(line)) return;
    // Skip HTML input type="password" patterns
    if (/type\s*=\s*['"]password['"]/.test(line)) return;

    const matches = Array.from(line.matchAll(this.patterns.passwordAssignment));

    for (const match of matches) {
      const code = match[0];
      if (this.isCommentOrString(line, line.indexOf(code))) continue;

      const column = line.indexOf(code) + 1;
      const passwordValue = match[1];

      this.vulnerabilities.push({
        type: 'HARDCODED_PASSWORD',
        severity: 'CRITICAL',
        line: lineNum,
        column: column,
        code: code,
        secretType: 'Hardcoded Password',
        secretPreview: this.redact(passwordValue || ''),
        issue: `Hardcoded password found: ${code}. Passwords should never be in source code.`,
        cwe: 'CWE-798: Use of Hard-Coded Credentials',
        fix: `Use environment variables:\n  const password = process.env.DB_PASSWORD;\n  if (!password) throw new Error('Missing DB_PASSWORD');\n  await db.connect({ username: 'user', password });\n\nFor authentication, use bcrypt for hashing:\n  import bcrypt from 'bcrypt';\n  const hashedPassword = await bcrypt.hash(password, 10);\n  await db.saveUser({ username, passwordHash: hashedPassword });\n\nFor verification:\n  const isValid = await bcrypt.compare(inputPassword, storedHash);`
      });
    }
  }

  /**
   * Check for JWT tokens
   */
  private checkJwtTokens(line: string, lineNum: number): void {
    // Skip if it's in a comment explaining JWT format
    if (line.includes('//') && line.indexOf('//') < line.indexOf('eyJ')) {
      return;
    }

    const matches = Array.from(line.matchAll(this.patterns.jwtToken));

    for (const match of matches) {
      const code = match[0];
      if (this.isCommentOrString(line, line.indexOf(code))) continue;

      const column = line.indexOf(code) + 1;

      this.vulnerabilities.push({
        type: 'JWT_TOKEN',
        severity: 'HIGH',
        line: lineNum,
        column: column,
        code: code,
        secretType: 'JWT Token',
        secretPreview: code.substring(0, 20) + '...',
        issue: `JWT token found in code: ${code.substring(0, 30)}... Token may contain sensitive information.`,
        cwe: 'CWE-798: Use of Hard-Coded Credentials',
        fix: `Never hardcode JWT tokens. Instead:\n  1. Generate tokens at runtime:\n     import jwt from 'jsonwebtoken';\n     const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });\n  2. Store JWT_SECRET in environment variable (never in code):\n     const secret = process.env.JWT_SECRET;\n  3. Return token to client (not in code)\n  4. Client stores token (usually in secure httpOnly cookie)\n  5. Token expires and requires refresh`
      });
    }
  }

  /**
   * Redact secret for safe display
   */
  private redact(secret: string): string {
    if (secret.length <= 8) return '***';
    return secret.substring(0, 4) + '...' + secret.substring(secret.length - 4);
  }

  /**
   * Check if position is inside a comment
   */
  private isCommentOrString(line: string, position: number): boolean {
    const beforePos = line.substring(0, position);

    // Simple heuristic: if there's a // before this position and no quotes after //, it's a comment
    const commentIdx = beforePos.lastIndexOf('//');
    if (commentIdx !== -1) {
      return true;
    }

    return false;
  }
}
