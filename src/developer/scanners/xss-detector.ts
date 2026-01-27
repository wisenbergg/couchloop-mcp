/**
 * XSS (Cross-Site Scripting) Detector
 * Scans code for XSS vulnerabilities including:
 * - innerHTML usage with untrusted data
 * - Unescaped user input in DOM
 * - eval() and similar dangerous functions
 * - Dangerous DOM manipulation patterns
 */

export interface XssVulnerability {
  type: 'INNERHTML_XSS' | 'EVAL_XSS' | 'UNESCAPED_DOM' | 'DANGEROUS_DOM_METHOD' | 'REACT_DANGEROUSHTML';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  line: number;
  column: number;
  code: string;
  issue: string;
  cwe: string;
  fix: string;
}

export class XssDetector {
  private vulnerabilities: XssVulnerability[] = [];

  /**
   * Scan code for XSS vulnerabilities
   */
  scan(code: string): XssVulnerability[] {
    this.vulnerabilities = [];
    const lines = code.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      this.checkInnerHtmlUsage(line, lineNum);
      this.checkEvalUsage(line, lineNum);
      this.checkUnescapedDomManipulation(line, lineNum);
      this.checkDangerousDomMethods(line, lineNum);
      this.checkReactDangerousHtml(line, lineNum);
    });

    return this.vulnerabilities;
  }

  /**
   * Detect innerHTML usage with variables or user input
   * Pattern: element.innerHTML = userInput
   * Pattern: element.innerHTML = `content ${userVar}`
   */
  private checkInnerHtmlUsage(line: string, lineNum: number): void {
    const patterns = [
      /\.innerHTML\s*=\s*[^;]+/g,
      /\.innerHTML\s*\+=\s*[^;]+/g,
      /innerHTML\s*=\s*[^;]+/g,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isCommentOrString(line, line.indexOf(code))) continue;

        // Check if it's using a template literal or variable
        if (code.includes('${') || code.includes('"') || code.includes("'") || code.includes('`')) {
          const column = line.indexOf(code) + 1;

          // Extract what's being assigned
          const assignmentMatch = code.match(/=\s*(.+)/);
          const assignedValue = assignmentMatch?.[1]?.trim() || 'untrustedData';

          const severity = code.includes('$') ? 'CRITICAL' : 'HIGH';

          this.vulnerabilities.push({
            type: 'INNERHTML_XSS',
            severity: severity as 'CRITICAL' | 'HIGH',
            line: lineNum,
            column: column,
            code: code,
            issue: `Direct assignment to innerHTML: ${code}. This allows XSS attacks if ${assignedValue} contains user-controlled content.`,
            cwe: 'CWE-79: Improper Neutralization of Input During Web Page Generation',
            fix: `Use textContent for plain text:\n  element.textContent = userInput;\n\nOr sanitize HTML:\n  import DOMPurify from 'dompurify';\n  element.innerHTML = DOMPurify.sanitize(userInput);\n\nOr use safe methods:\n  element.appendChild(document.createTextNode(userInput));\n  element.insertAdjacentHTML('beforeend', sanitize(userInput));`
          });
        }
      }
    }
  }

  /**
   * Detect eval() and similar dangerous functions
   * Pattern: eval(userInput)
   * Pattern: Function(userInput)
   * Pattern: setTimeout(userInput)
   */
  private checkEvalUsage(line: string, lineNum: number): void {
    const patterns = [
      /\beval\s*\(/gi,
      /\bFunction\s*\(/gi,
      /\bsetTimeout\s*\(\s*[^,)]*\$\{/gi,
      /\bsetInterval\s*\(\s*[^,)]*\$\{/gi,
      /\bnew\s+Function\s*\(/gi,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isCommentOrString(line, line.indexOf(code))) continue;

        const column = line.indexOf(code) + 1;
        const isFunctionConstructor = code.toLowerCase().includes('function');
        const isSetTimeout = code.toLowerCase().includes('settimeout');

        let issue = '';
        let fix = '';

        if (code.toLowerCase().includes('eval')) {
          issue = `Direct use of eval(): ${code}. eval() is dangerous and allows arbitrary code execution.`;
          fix = `Never use eval(). If you need to parse JSON:\n  const data = JSON.parse(userInput);\n\nFor dynamic property access:\n  const value = obj[propertyName];\n\nFor expressions, use a safe expression evaluator library.`;
        } else if (isFunctionConstructor) {
          issue = `Function constructor usage: ${code}. Using Function() with user input allows arbitrary code execution.`;
          fix = `Use JSON.parse() for data:\n  const data = JSON.parse(userInput);\n\nFor callbacks, use predefined functions:\n  const callbacks = { action1: () => {}, action2: () => {} };\n  callbacks[actionName]?.();`;
        } else if (isSetTimeout) {
          issue = `setTimeout with dynamic code: ${code}. Passing code as string can lead to code injection.`;
          fix = `Use a function reference instead:\n  setTimeout(() => { handleAction(data); }, 1000);\n\nOr define callbacks:\n  const handlers = { notify: () => {}, update: () => {} };\n  setTimeout(handlers[actionType], 1000);`;
        }

        this.vulnerabilities.push({
          type: 'EVAL_XSS',
          severity: 'CRITICAL',
          line: lineNum,
          column: column,
          code: code,
          issue: issue,
          cwe: 'CWE-95: Improper Neutralization of Directives in Dynamically Evaluated Code',
          fix: fix
        });
      }
    }
  }

  /**
   * Detect unescaped DOM manipulation
   * Pattern: element.insertAdjacentHTML('beforeend', userInput)
   * Pattern: document.write(userInput)
   */
  private checkUnescapedDomManipulation(line: string, lineNum: number): void {
    const patterns = [
      /insertAdjacentHTML\s*\(/gi,
      /document\.write\s*\(/gi,
      /document\.writeln\s*\(/gi,
      /outerHTML\s*=\s*[^;]+/g,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isCommentOrString(line, line.indexOf(code))) continue;

        const column = line.indexOf(code) + 1;

        let issue = '';
        let fix = '';

        if (code.includes('insertAdjacentHTML')) {
          issue = `insertAdjacentHTML with untrusted data: ${code}. Can lead to XSS if data isn't sanitized.`;
          fix = `Use insertAdjacentElement instead:\n  const element = document.createElement('div');\n  element.textContent = userInput;\n  target.insertAdjacentElement('beforeend', element);\n\nOr sanitize the HTML:\n  target.insertAdjacentHTML('beforeend', DOMPurify.sanitize(userInput));`;
        } else if (code.includes('document.write') || code.includes('writeln')) {
          issue = `document.write() detected: ${code}. This is dangerous and can cause DOM issues and XSS vulnerabilities.`;
          fix = `Use DOM methods instead:\n  const div = document.createElement('div');\n  div.textContent = content;\n  document.body.appendChild(div);\n\nOr use:\n  document.getElementById('target').textContent = content;`;
        } else if (code.includes('outerHTML')) {
          issue = `Direct outerHTML assignment: ${code}. Allows XSS if assigned value contains user input.`;
          fix = `Use safer methods:\n  element.replaceWith(newElement);\n  Or sanitize before:\n  element.outerHTML = DOMPurify.sanitize(userInput);`;
        }

        this.vulnerabilities.push({
          type: 'UNESCAPED_DOM',
          severity: 'CRITICAL',
          line: lineNum,
          column: column,
          code: code,
          issue: issue,
          cwe: 'CWE-79: Improper Neutralization of Input During Web Page Generation',
          fix: fix
        });
      }
    }
  }

  /**
   * Detect dangerous DOM methods
   * Pattern: element.click(userEvent)
   * Pattern: element.setAttribute('onclick', userInput)
   */
  private checkDangerousDomMethods(line: string, lineNum: number): void {
    const patterns = [
      /setAttribute\s*\(\s*['"]on\w+['"][^)]*\)/gi,
      /\.on\w+\s*=\s*[^;]+\$\{/g,
      /\[['"]on\w+['"]\]\s*=\s*[^;]+/g,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(line.matchAll(pattern));

      for (const match of matches) {
        const code = match[0];
        if (this.isCommentOrString(line, line.indexOf(code))) continue;

        const column = line.indexOf(code) + 1;

        this.vulnerabilities.push({
          type: 'DANGEROUS_DOM_METHOD',
          severity: 'CRITICAL',
          line: lineNum,
          column: column,
          code: code,
          issue: `Setting event handler with user input: ${code}. This allows JavaScript injection through event handlers.`,
          cwe: 'CWE-79: Improper Neutralization of Input During Web Page Generation',
          fix: `Use addEventListener instead:\n  element.addEventListener('click', (e) => handleEvent(e, userData));\n\nOr use data attributes with safe event handlers:\n  element.setAttribute('data-action', actionName);\n  element.addEventListener('click', () => handler(element.dataset.action));`
        });
      }
    }
  }

  /**
   * Detect React dangerouslySetInnerHTML usage
   * Pattern: dangerouslySetInnerHTML={{ __html: userInput }}
   */
  private checkReactDangerousHtml(line: string, lineNum: number): void {
    if (!line.includes('dangerouslySetInnerHTML')) return;

    const pattern = /dangerouslySetInnerHTML\s*=\s*\{\s*__html\s*:\s*[^}]+\}/g;
    const matches = Array.from(line.matchAll(pattern));

    for (const match of matches) {
      const code = match[0];
      if (this.isCommentOrString(line, line.indexOf(code))) continue;

      const column = line.indexOf(code) + 1;

      // Extract what's being assigned
      const valueMatch = code.match(/__html\s*:\s*(.+)/);
      const value = valueMatch?.[1]?.trim() || 'value';

      this.vulnerabilities.push({
        type: 'REACT_DANGEROUSHTML',
        severity: code.includes('$') ? 'CRITICAL' : 'HIGH',
        line: lineNum,
        column: column,
        code: code,
        issue: `React dangerouslySetInnerHTML usage: ${code}. This is dangerous and can lead to XSS if ${value} contains user-controlled content.`,
        cwe: 'CWE-79: Improper Neutralization of Input During Web Page Generation',
        fix: `Use React's built-in escaping:\n  <div>{userInput}</div>\n\nFor safe HTML rendering, sanitize first:\n  import DOMPurify from 'dompurify';\n  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />\n\nOr use a React component library that handles sanitization.`
      });
    }
  }

  /**
   * Check if position is inside a comment or string
   */
  private isCommentOrString(line: string, position: number): boolean {
    const beforePos = line.substring(0, position);
    return beforePos.includes('//') || beforePos.includes('/*');
  }
}
