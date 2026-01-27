/**
 * Package Blocker - Intercepts and blocks AI package recommendations
 * This is the enforcement layer that prevents bad packages from being installed
 */

import { PackageEvaluator, EvaluationContext } from '../evaluators/package-evaluator.js';

export interface BlockerResult {
  allowed: boolean;
  original: string;
  modified?: string;
  warnings: string[];
  blockedPackages: string[];
  suggestions: Record<string, string[]>;
}

export class PackageBlocker {
  private evaluator: PackageEvaluator;
  private autoFix: boolean;

  constructor(autoFix = true) {
    this.evaluator = new PackageEvaluator();
    this.autoFix = autoFix;
  }

  /**
   * Intercept and validate code with package installations
   */
  async interceptCode(
    code: string,
    language: 'javascript' | 'typescript' | 'python' | 'java' | 'go' | 'rust' | 'csharp' | 'ruby' | 'unknown'
  ): Promise<BlockerResult> {
    const context: EvaluationContext = { language };
    const result: BlockerResult = {
      allowed: true,
      original: code,
      warnings: [],
      blockedPackages: [],
      suggestions: {}
    };

    // Extract packages from code
    const packages = this.evaluator.extractPackages(code, language);

    if (packages.length === 0) {
      return result;
    }

    // Evaluate all packages
    const evaluations = await this.evaluator.evaluateBatch(packages, context);

    // Process evaluation results
    let modifiedCode = code;

    for (const evaluation of evaluations) {
      if (evaluation.blocked) {
        result.allowed = false;
        result.blockedPackages.push(evaluation.package.name);

        if (evaluation.warning) {
          result.warnings.push(evaluation.warning);
        }

        if (evaluation.suggestions && evaluation.suggestions.length > 0) {
          result.suggestions[evaluation.package.name] = evaluation.suggestions;

          // Auto-fix if enabled and we have a clear suggestion
          if (this.autoFix && evaluation.suggestions.length === 1) {
            if (evaluation.suggestions[0]) {
              modifiedCode = this.replacePackage(
                modifiedCode,
                evaluation.package.name,
                evaluation.suggestions[0],
                language
              );
            }
          }
        }
      } else if (evaluation.warning) {
        result.warnings.push(evaluation.warning);
      }
    }

    // If we modified the code, include it
    if (modifiedCode !== code) {
      result.modified = modifiedCode;
    }

    return result;
  }

  /**
   * Intercept package manager commands (npm install, pip install, etc.)
   */
  async interceptCommand(command: string): Promise<BlockerResult> {
    const result: BlockerResult = {
      allowed: true,
      original: command,
      warnings: [],
      blockedPackages: [],
      suggestions: {}
    };

    // Detect package manager and extract packages
    const { manager, packages, language } = this.parseCommand(command);

    if (!manager || packages.length === 0) {
      return result;
    }

    const context: EvaluationContext = { language };

    // Evaluate each package
    for (const pkg of packages) {
      const evaluation = await this.evaluator.evaluate(pkg.name, context, pkg.version);

      if (evaluation.blocked) {
        result.allowed = false;
        result.blockedPackages.push(pkg.name);

        if (evaluation.warning) {
          result.warnings.push(evaluation.warning);
        }

        if (evaluation.suggestions) {
          result.suggestions[pkg.name] = evaluation.suggestions;
        }
      } else if (evaluation.warning) {
        result.warnings.push(evaluation.warning);
      }
    }

    // Generate modified command if blocked
    if (!result.allowed && this.autoFix) {
      const validPackages = packages.filter(
        pkg => !result.blockedPackages.includes(pkg.name)
      );

      if (validPackages.length > 0) {
        result.modified = this.buildCommand(manager, validPackages);
      }
    }

    return result;
  }

  private parseCommand(command: string): {
    manager: string | null;
    packages: Array<{ name: string; version?: string }>;
    language: 'javascript' | 'python' | 'java' | 'unknown';
  } {
    const result = {
      manager: null as string | null,
      packages: [] as Array<{ name: string; version?: string }>,
      language: 'unknown' as 'javascript' | 'python' | 'java' | 'unknown'
    };

    // npm/yarn/pnpm patterns
    const npmMatch = command.match(
      /^(npm|yarn|pnpm)\s+(install|add|i)\s+(.+)$/i
    );
    if (npmMatch) {
      result.manager = npmMatch[1] || null;
      result.language = 'javascript';
      const packageStrings = (npmMatch[3] || '').split(/\s+/);

      for (const pkgStr of packageStrings) {
        if (pkgStr.startsWith('-')) continue; // Skip flags

        const [name, version] = pkgStr.split('@').filter(Boolean);
        if (name) {
          result.packages.push({ name, version });
        }
      }
      return result;
    }

    // pip patterns
    const pipMatch = command.match(
      /^pip3?\s+install\s+(.+)$/i
    );
    if (pipMatch) {
      result.manager = 'pip';
      result.language = 'python';
      const packageStrings = (pipMatch[1] || '').split(/\s+/);

      for (const pkgStr of packageStrings) {
        if (pkgStr.startsWith('-')) continue; // Skip flags

        const [name, version] = pkgStr.split('==');
        if (name) {
          result.packages.push({ name, version });
        }
      }
      return result;
    }

    // Maven patterns (in pom.xml context)
    const mvnMatch = command.match(
      /mvn\s+dependency:get\s+-Dartifact=(.+)/i
    );
    if (mvnMatch) {
      result.manager = 'mvn';
      result.language = 'java';
      const [groupId, artifactId, version] = (mvnMatch[1] || '').split(':');
      if (groupId && artifactId) {
        result.packages.push({
          name: `${groupId}:${artifactId}`,
          version
        });
      }
      return result;
    }

    return result;
  }

  private buildCommand(
    manager: string,
    packages: Array<{ name: string; version?: string }>
  ): string {
    const packageStrings = packages.map(pkg =>
      pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name
    );

    switch (manager) {
      case 'npm':
        return `npm install ${packageStrings.join(' ')}`;
      case 'yarn':
        return `yarn add ${packageStrings.join(' ')}`;
      case 'pnpm':
        return `pnpm add ${packageStrings.join(' ')}`;
      case 'pip':
        return `pip install ${packageStrings.join(' ')}`;
      default:
        return '';
    }
  }

  private replacePackage(
    code: string,
    oldPkg: string,
    newPkg: string,
    language: 'javascript' | 'typescript' | 'python' | 'java' | 'go' | 'rust' | 'csharp' | 'ruby' | 'unknown'
  ): string {
    switch (language) {
      case 'javascript':
      case 'typescript':
        // Replace in import statements
        code = code.replace(
          new RegExp(`(import\\s+.*?\\s+from\\s+['"])${oldPkg}(['"])`, 'g'),
          `$1${newPkg}$2`
        );
        // Replace in require statements
        code = code.replace(
          new RegExp(`(require\\s*\\(\\s*['"])${oldPkg}(['"]\\s*\\))`, 'g'),
          `$1${newPkg}$2`
        );
        break;

      case 'python':
        // Replace in import statements
        code = code.replace(
          new RegExp(`(^|\\n)(\\s*import\\s+)${oldPkg}(\\s|$)`, 'gm'),
          `$1$2${newPkg}$3`
        );
        // Replace in from...import statements
        code = code.replace(
          new RegExp(`(^|\\n)(\\s*from\\s+)${oldPkg}(\\s+import)`, 'gm'),
          `$1$2${newPkg}$3`
        );
        break;
    }

    return code;
  }

  /**
   * Generate a report of blocked packages
   */
  generateReport(results: BlockerResult[]): string {
    const totalBlocked = results.reduce(
      (sum, r) => sum + r.blockedPackages.length,
      0
    );

    const report = [
      `Package Validation Report`,
      `========================`,
      `Total commands analyzed: ${results.length}`,
      `Blocked packages: ${totalBlocked}`,
      ``
    ];

    if (totalBlocked > 0) {
      report.push(`Blocked Packages:`);
      for (const result of results) {
        for (const pkg of result.blockedPackages) {
          const suggestions = result.suggestions[pkg];
          report.push(`  ❌ ${pkg}`);
          if (suggestions && suggestions.length > 0) {
            report.push(`     Suggestions: ${suggestions.join(', ')}`);
          }
        }
      }
    }

    const warnings = results.flatMap(r => r.warnings);
    if (warnings.length > 0) {
      report.push(``);
      report.push(`Warnings:`);
      warnings.forEach(w => report.push(`  ⚠️  ${w}`));
    }

    return report.join('\n');
  }
}