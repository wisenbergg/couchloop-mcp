/**
 * Package Evaluator - Pre-delivery evaluation of AI package recommendations
 */

import type { PackageValidationResult } from '../types/package.js';
import { RegistryManager } from '../validators/registry-manager.js';

export interface EvaluationContext {
  language: 'javascript' | 'typescript' | 'python' | 'java' | 'go' | 'rust' | 'csharp' | 'ruby' | 'unknown';
  existingPackages?: string[];
  projectType?: string;
}

export class PackageEvaluator {
  private registryManager: RegistryManager;
  private blockedPackages = new Set<string>();
  private trustedPackages = new Set<string>();

  constructor() {
    this.registryManager = new RegistryManager();
    this.initializeKnownPackages();
  }

  private initializeKnownPackages() {
    // Common typos and malicious packages to block
    this.blockedPackages.add('reqeusts'); // typo of 'requests'
    this.blockedPackages.add('beautifulsoup'); // should be 'beautifulsoup4'
    this.blockedPackages.add('django-rest'); // should be 'djangorestframework'
    this.blockedPackages.add('tensorflow-gpu'); // deprecated, use 'tensorflow'

    // Well-known trusted packages
    this.trustedPackages.add('react');
    this.trustedPackages.add('express');
    this.trustedPackages.add('django');
    this.trustedPackages.add('flask');
    this.trustedPackages.add('numpy');
    this.trustedPackages.add('pandas');
  }

  /**
   * Evaluate a package recommendation from AI
   */
  async evaluate(
    packageName: string,
    context: EvaluationContext,
    version?: string
  ): Promise<PackageValidationResult> {
    // Check if explicitly blocked
    if (this.blockedPackages.has(packageName)) {
      const registryLang = context.language === 'unknown' ? 'javascript' : context.language;
      return {
        package: {
          name: packageName,
          version,
          registry: this.detectRegistry(registryLang),
          exists: false,
          lastChecked: new Date()
        },
        blocked: true,
        reason: 'Package is known to be malicious or a common typo',
        suggestions: await this.getSuggestions(packageName, context)
      };
    }

    // Determine registry based on context
    const registryLang = context.language === 'unknown' ? 'javascript' : context.language;
    const registry = this.detectRegistry(registryLang);

    // Validate package existence
    const packageInfo = await this.registryManager.validate(
      packageName,
      registry,
      version
    );

    // If package doesn't exist, block it
    if (!packageInfo.exists) {
      const suggestions = await this.getSuggestions(packageName, context);

      return {
        package: packageInfo,
        blocked: true,
        reason: `Package "${packageName}" does not exist in ${registry} registry`,
        suggestions,
        warning: this.generateWarning(packageName, suggestions)
      };
    }

    // Check for security issues
    if (packageInfo.securityIssues?.some((issue: any) =>
      issue.severity === 'critical' || issue.severity === 'high'
    )) {
      return {
        package: packageInfo,
        blocked: true,
        reason: 'Package has known security vulnerabilities',
        warning: `Security issues found: ${packageInfo.securityIssues.map((i: any) => i.description).join(', ')}`,
        suggestions: version && packageInfo.securityIssues[0]?.fixedIn
          ? [`Update to version ${packageInfo.securityIssues[0].fixedIn}`]
          : []
      };
    }

    // Check if deprecated
    if (packageInfo.deprecated) {
      return {
        package: packageInfo,
        blocked: false, // Warning only, don't block
        warning: 'Package is deprecated. Consider using an alternative.',
        suggestions: await this.getSuggestions(packageName, context)
      };
    }

    // Package is valid
    return {
      package: packageInfo,
      blocked: false
    };
  }

  /**
   * Evaluate multiple packages in a code snippet
   */
  async evaluateBatch(
    packages: string[],
    context: EvaluationContext
  ): Promise<PackageValidationResult[]> {
    return Promise.all(
      packages.map(pkg => this.evaluate(pkg, context))
    );
  }

  /**
   * Extract package references from code
   */
  extractPackages(code: string, language: 'javascript' | 'typescript' | 'python' | 'java' | 'go' | 'rust' | 'csharp' | 'ruby' | 'unknown'): string[] {
    const packages: string[] = [];

    switch (language) {
      case 'javascript':
      case 'typescript': {
        // Match import/require statements
        const jsImports = code.matchAll(
          /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"])|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
        );
        for (const match of jsImports) {
          const pkg = match[1] || match[2];
          if (pkg) packages.push(pkg);
        }
        break;
      }

      case 'python': {
        // Match import and from...import statements
        const pyImports = code.matchAll(
          /(?:^|\n)\s*(?:import\s+(\S+))|(?:from\s+(\S+)\s+import)/gm
        );
        for (const match of pyImports) {
          const pkgMatch = match[1] || match[2];
          if (pkgMatch) {
            const pkg = pkgMatch.split('.')[0];
            if (pkg) packages.push(pkg);
          }
        }
        break;
      }

      case 'java': {
        // Match Maven dependencies in comments or actual imports
        const mvnDeps = code.matchAll(
          /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g
        );
        for (const match of mvnDeps) {
          packages.push(`${match[1]}:${match[2]}`);
        }
        break;
      }

      case 'go': {
        // Match Go import statements
        const goImports = code.matchAll(
          /import\s+(?:"([^"]+)"|`([^`]+)`)/gm
        );
        for (const match of goImports) {
          const pkg = match[1] || match[2];
          if (pkg && !pkg.startsWith('./') && !pkg.startsWith('../')) {
            packages.push(pkg);
          }
        }
        // Also match go.mod require statements
        const goModRequires = code.matchAll(
          /require\s+(\S+)\s+v[\d.]+/gm
        );
        for (const match of goModRequires) {
          if (match[1]) packages.push(match[1]);
        }
        break;
      }

      case 'rust': {
        // Match Cargo.toml dependencies
        const cargoDeps = code.matchAll(
          /(\w[\w-]*)\s*=\s*(?:"[\d.]+"|{[^}]*version[^}]*})/g
        );
        for (const match of cargoDeps) {
          if (match[1] && !['version', 'edition', 'name'].includes(match[1])) {
            packages.push(match[1]);
          }
        }
        // Also match use statements
        const useStatements = code.matchAll(
          /use\s+(\w+)(?:::|;)/g
        );
        for (const match of useStatements) {
          if (match[1] && match[1] !== 'std' && match[1] !== 'self' && match[1] !== 'super') {
            packages.push(match[1]);
          }
        }
        break;
      }

      case 'csharp': {
        // Match using statements and NuGet PackageReference
        const usingStatements = code.matchAll(
          /using\s+(\w+(?:\.\w+)*);/g
        );
        for (const match of usingStatements) {
          const namespace = match[1];
          // Filter out System namespaces
          if (namespace && !namespace.startsWith('System')) {
            const firstPart = namespace.split('.')[0];
            if (firstPart) packages.push(firstPart);
          }
        }
        // Match PackageReference in csproj
        const packageRefs = code.matchAll(
          /<PackageReference\s+Include="([^"]+)"/g
        );
        for (const match of packageRefs) {
          if (match[1]) packages.push(match[1]);
        }
        break;
      }

      case 'ruby': {
        // Match gem statements and require statements
        const gemStatements = code.matchAll(
          /gem\s+['"]([^'"]+)['"]/g
        );
        for (const match of gemStatements) {
          if (match[1]) packages.push(match[1]);
        }
        const requireStatements = code.matchAll(
          /require\s+['"]([^'"]+)['"]/g
        );
        for (const match of requireStatements) {
          const gem = match[1];
          // Filter out relative requires and standard library
          if (gem && !gem.startsWith('./') && !gem.startsWith('../')) {
            packages.push(gem);
          }
        }
        break;
      }
    }

    // Filter out relative paths and built-in modules
    return packages.filter(pkg =>
      !pkg.startsWith('.') &&
      !pkg.startsWith('/') &&
      !this.isBuiltinModule(pkg, language)
    );
  }

  private isBuiltinModule(module: string, language: 'javascript' | 'typescript' | 'python' | 'java' | 'go' | 'rust' | 'csharp' | 'ruby' | 'unknown'): boolean {
    const builtins: Record<string, Set<string>> = {
      javascript: new Set(['fs', 'path', 'http', 'https', 'crypto', 'os', 'util', 'stream', 'buffer']),
      python: new Set(['os', 'sys', 'json', 'math', 'random', 'datetime', 're', 'io', 'collections']),
      java: new Set(['java', 'javax', 'com.sun']),
      go: new Set(['fmt', 'os', 'io', 'net', 'strings', 'time', 'encoding', 'crypto', 'math']),
      rust: new Set(['std', 'core', 'alloc', 'proc_macro']),
      csharp: new Set(['System', 'Microsoft']),
      ruby: new Set(['json', 'yaml', 'erb', 'logger', 'date', 'time', 'uri', 'net'])
    };

    const languageBuiltins = language === 'typescript' ? builtins.javascript : builtins[language];
    const moduleName = module.split('/')[0];
    return moduleName ? (languageBuiltins?.has(moduleName) || false) : false;
  }

  private detectRegistry(language: string): 'npm' | 'pypi' | 'maven' | 'cargo' | 'gem' | 'nuget' | 'go' {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return 'npm';
      case 'python':
        return 'pypi';
      case 'java':
        return 'maven';
      case 'go':
        return 'go';
      case 'rust':
        return 'cargo';
      case 'csharp':
        return 'nuget';
      case 'ruby':
        return 'gem';
      default:
        return 'npm';
    }
  }

  private async getSuggestions(
    packageName: string,
    context: EvaluationContext
  ): Promise<string[]> {
    const registryLang = context.language === 'unknown' ? 'javascript' : context.language;
    const registry = this.detectRegistry(registryLang);

    // Look for similar packages
    const similar = await this.registryManager.findSimilar(packageName, registry);

    // Add known corrections
    const corrections: Record<string, string> = {
      'reqeusts': 'requests',
      'beautifulsoup': 'beautifulsoup4',
      'django-rest': 'djangorestframework',
      'tensorflow-gpu': 'tensorflow',
      'PIL': 'Pillow',
      'cv2': 'opencv-python'
    };

    if (corrections[packageName]) {
      similar.unshift(corrections[packageName]);
    }

    return [...new Set(similar)].slice(0, 3);
  }

  private generateWarning(packageName: string, suggestions: string[]): string {
    if (suggestions.length > 0) {
      return `Package "${packageName}" not found. Did you mean: ${suggestions.join(', ')}?`;
    }
    return `Package "${packageName}" does not exist. This may be a hallucination.`;
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.registryManager.clearCaches();
  }
}