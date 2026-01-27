/**
 * SQL Injection Detector
 * Scans code for SQL injection vulnerabilities including:
 * - String concatenation in queries
 * - Unparameterized queries
 * - Dynamic table/column names
 * - Direct user input in SQL
 */

export interface SqlVulnerability {
  type: 'SQL_INJECTION' | 'UNPARAMETERIZED_QUERY' | 'DYNAMIC_TABLE_NAME' | 'DYNAMIC_COLUMN_NAME';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  line: number;
  column: number;
  code: string;
  issue: string;
  cwe: string;
  fix: string;
}

export class SqlInjectionDetector {
  private vulnerabilities: SqlVulnerability[] = [];

  /**
   * Scan code for SQL injection vulnerabilities
   */
  scan(code: string): SqlVulnerability[] {
    this.vulnerabilities = [];
    const lines = code.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      this.checkStringConcatenation(line, lineNum);
      this.checkUnparameterizedQueries(line, lineNum);
      this.checkDynamicTableNames(line, lineNum);
      this.checkDynamicColumnNames(line, lineNum);
    });

    return this.vulnerabilities;
  }

  /**
   * Detect template literals with variables in SQL strings
   * Pattern: `SELECT * FROM users WHERE id = ${variable}`
   */
  private checkStringConcatenation(line: string, lineNum: number): void {
    // Template literal with SQL - check for variable interpolation
    const templatePattern = /`[^`]*\$\{[^}]+\}[^`]*`/g;
    const matches = Array.from(line.matchAll(templatePattern));

    for (const match of matches) {
      const code = match[0];
      // Check if it looks like SQL
      if (this.isSqlLike(code)) {
        const column = line.indexOf(code) + 1;

        // Extract the variable name
        const varMatch = code.match(/\$\{([^}]+)\}/);
        const varName = varMatch ? varMatch[1] : 'variable';

        this.vulnerabilities.push({
          type: 'SQL_INJECTION',
          severity: 'CRITICAL',
          line: lineNum,
          column: column,
          code: code,
          issue: `String interpolation in SQL query: ${code}. User input (${varName}) directly concatenated into SQL.`,
          cwe: 'CWE-89: Improper Neutralization of Special Elements used in an SQL Command',
          fix: `Use parameterized queries instead:\n  db.query('SELECT * FROM users WHERE id = ?', [${varName}])\n  Or with named parameters:\n  db.query('SELECT * FROM users WHERE id = $1', [${varName}])`
        });
      }
    }
  }

  /**
   * Detect unparameterized queries with + or concat()
   * Pattern: "SELECT * FROM users WHERE id = " + id
   */
  private checkUnparameterizedQueries(line: string, lineNum: number): void {
    // String concatenation patterns
    const concatenationPatterns = [
      // Double quotes with +
      /"[^"]*"\s*\+\s*[^;]+/g,
      // Single quotes with +
      /'[^']*'\s*\+\s*[^;]+/g,
      // concat() function
      /concat\s*\([^)]*\)/gi,
      // String.concat()
      /\.concat\s*\([^)]*\)/g,
    ];

    for (const pattern of concatenationPatterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isSqlLike(code) && !this.isCommentOrString(line, line.indexOf(code))) {
          const column = line.indexOf(code) + 1;

          this.vulnerabilities.push({
            type: 'UNPARAMETERIZED_QUERY',
            severity: 'CRITICAL',
            line: lineNum,
            column: column,
            code: code,
            issue: `Unparameterized SQL query with string concatenation: ${code}. Values should be passed as parameters, not concatenated.`,
            cwe: 'CWE-89: Improper Neutralization of Special Elements used in an SQL Command',
            fix: `Use parameterized query:\n  db.query('SELECT * FROM users WHERE id = ? AND name = ?', [id, name])\n  Instead of:\n  db.query("SELECT * FROM users WHERE id = " + id + " AND name = " + name)`
          });
        }
      }
    }
  }

  /**
   * Detect dynamic table names
   * Pattern: `SELECT * FROM ${tableName}`
   */
  private checkDynamicTableNames(line: string, lineNum: number): void {
    const patterns = [
      /FROM\s+`?[^;]*\$\{[^}]+\}[^;]*`?/gi,
      /FROM\s+\(?\s*[^;]*\$\{[^}]+\}[^;]*\)?/gi,
      /FROM\s+\(\s*?["']?[^)]*\$\{[^}]+\}[^)]*["']?\s*\)/gi,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        const column = line.indexOf(code) + 1;
        const varMatch = code.match(/\$\{([^}]+)\}/);
        const varName = varMatch ? varMatch[1] : 'variable';

        this.vulnerabilities.push({
          type: 'DYNAMIC_TABLE_NAME',
          severity: 'HIGH',
          line: lineNum,
          column: column,
          code: code,
          issue: `Dynamic table name in SQL: ${code}. Table name (${varName}) comes from user input, allowing table injection attacks.`,
          cwe: 'CWE-89: Improper Neutralization of Special Elements used in an SQL Command',
          fix: `Use identifier escaping or whitelist allowed tables:\n  const allowedTables = ['users', 'orders', 'products'];\n  if (!allowedTables.includes(tableName)) throw new Error('Invalid table');\n  const query = \`SELECT * FROM \\\"\${tableName}\\\"\`; // Quoted identifier\n  Or use an ORM that handles this safely.`
        });
      }
    }
  }

  /**
   * Detect dynamic column names
   * Pattern: `SELECT ${columnName} FROM users`
   */
  private checkDynamicColumnNames(line: string, lineNum: number): void {
    const patterns = [
      /SELECT\s+[^;]*\$\{[^}]+\}[^;]*/gi,
      /ORDER\s+BY\s+[^;]*\$\{[^}]+\}[^;]*/gi,
      /WHERE\s+[^;]*\$\{[^}]+\}[^;]*/gi,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];

        // Skip if it's in VALUES clause (less critical)
        if (code.includes('VALUES')) continue;

        // Skip if it looks like a parameter placeholder
        if (code.includes('?') || code.includes('$1')) continue;

        const column = line.indexOf(code) + 1;
        const varMatch = code.match(/\$\{([^}]+)\}/);
        const varName = varMatch ? varMatch[1] : 'variable';

        this.vulnerabilities.push({
          type: 'DYNAMIC_COLUMN_NAME',
          severity: 'MEDIUM',
          line: lineNum,
          column: column,
          code: code,
          issue: `Dynamic column name in SQL: ${code}. Column name (${varName}) from user input could allow column-based injection attacks.`,
          cwe: 'CWE-89: Improper Neutralization of Special Elements used in an SQL Command',
          fix: `Use identifier escaping or whitelist allowed columns:\n  const allowedColumns = ['id', 'name', 'email'];\n  if (!allowedColumns.includes(columnName)) throw new Error('Invalid column');\n  const query = \`SELECT \\\"\${columnName}\\\", * FROM users\`; // Quoted identifier\n  Or use an ORM's dynamic select methods.`
        });
      }
    }
  }

  /**
   * Check if code looks like SQL
   */
  private isSqlLike(code: string): boolean {
    const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'JOIN', 'ORDER', 'GROUP', 'UNION'];
    const upperCode = code.toUpperCase();
    return sqlKeywords.some(keyword => upperCode.includes(keyword));
  }

  /**
   * Check if position is inside a comment or string
   */
  private isCommentOrString(line: string, position: number): boolean {
    // Simple check - look for comment markers before position
    const beforePos = line.substring(0, position);
    return beforePos.includes('//') || beforePos.includes('/*');
  }
}
