/**
 * Build Context Detector - Prevents "Build Context Blindness" errors
 * Detects project configuration to prevent AI agents from making incorrect assumptions
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface BuildContext {
  language: 'javascript' | 'typescript' | 'python' | 'java' | 'unknown';
  moduleSystem?: 'commonjs' | 'esm' | 'umd' | 'amd';
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'pip' | 'maven' | 'gradle';
  buildTool?: string;
  tsConfig?: {
    moduleResolution?: string;
    module?: string;
    target?: string;
    strict?: boolean;
    esModuleInterop?: boolean;
  };
  pythonVersion?: string;
  nodeVersion?: string;
  hasTypeScript: boolean;
  requiresJsExtensions: boolean;
  errors: string[];
  warnings: string[];
  aiGuidance: string[];
}

export class BuildContextDetector {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Detect full build context to prevent AI errors
   */
  async detect(): Promise<BuildContext> {
    const context: BuildContext = {
      language: 'unknown',
      hasTypeScript: false,
      requiresJsExtensions: false,
      errors: [],
      warnings: [],
      aiGuidance: []
    };

    // Check for package.json (Node.js projects)
    await this.detectNodeContext(context);

    // Check for TypeScript
    await this.detectTypeScriptContext(context);

    // Check for Python
    await this.detectPythonContext(context);

    // Check for Java
    await this.detectJavaContext(context);

    // Generate AI guidance based on detected context
    this.generateAIGuidance(context);

    return context;
  }

  private async detectNodeContext(context: BuildContext): Promise<void> {
    try {
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      context.language = 'javascript';

      // Detect module system
      if (pkg.type === 'module') {
        context.moduleSystem = 'esm';
        context.requiresJsExtensions = true;
        context.aiGuidance.push('⚠️ ESM project: Use .js extensions in imports, even for TypeScript files');
      } else {
        context.moduleSystem = 'commonjs';
      }

      // Detect package manager
      const hasYarnLock = await this.fileExists('yarn.lock');
      const hasPnpmLock = await this.fileExists('pnpm-lock.yaml');

      if (hasPnpmLock) {
        context.packageManager = 'pnpm';
      } else if (hasYarnLock) {
        context.packageManager = 'yarn';
      } else {
        context.packageManager = 'npm';
      }

      // Check for TypeScript dependency
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        context.hasTypeScript = true;
        context.language = 'typescript';
      }

      // Detect build tools
      if (pkg.scripts?.build) {
        const buildScript = pkg.scripts.build;
        if (buildScript.includes('tsc')) {
          context.buildTool = 'tsc';
        } else if (buildScript.includes('webpack')) {
          context.buildTool = 'webpack';
        } else if (buildScript.includes('vite')) {
          context.buildTool = 'vite';
        } else if (buildScript.includes('rollup')) {
          context.buildTool = 'rollup';
        }
      }

      // Extract Node version requirement
      if (pkg.engines?.node) {
        context.nodeVersion = pkg.engines.node;
        context.aiGuidance.push(`Node version requirement: ${pkg.engines.node}`);
      }

    } catch (error) {
      // Not a Node.js project
    }
  }

  private async detectTypeScriptContext(context: BuildContext): Promise<void> {
    try {
      const tsconfigPath = path.join(this.projectRoot, 'tsconfig.json');
      const content = await fs.readFile(tsconfigPath, 'utf-8');

      // Remove comments for parsing
      const jsonString = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      const tsconfig = JSON.parse(jsonString);

      context.hasTypeScript = true;
      context.language = 'typescript';

      const compilerOptions = tsconfig.compilerOptions || {};
      context.tsConfig = {
        moduleResolution: compilerOptions.moduleResolution,
        module: compilerOptions.module,
        target: compilerOptions.target,
        strict: compilerOptions.strict,
        esModuleInterop: compilerOptions.esModuleInterop
      };

      // Critical: Check if .js extensions are required
      if (compilerOptions.moduleResolution === 'node16' ||
          compilerOptions.moduleResolution === 'nodenext' ||
          compilerOptions.module === 'node16' ||
          compilerOptions.module === 'nodenext') {
        context.requiresJsExtensions = true;
        context.warnings.push('TypeScript requires .js extensions in imports (ESM mode)');
        context.aiGuidance.push('🚨 CRITICAL: Import all local modules with .js extension, not .ts!');
        context.aiGuidance.push('Example: import { foo } from "./bar.js" (NOT "./bar" or "./bar.ts")');
      }

      // Check for strict mode
      if (compilerOptions.strict) {
        context.aiGuidance.push('Strict mode enabled: Type all variables and handle null/undefined');
      }

    } catch (error) {
      // No TypeScript config
    }
  }

  private async detectPythonContext(context: BuildContext): Promise<void> {
    try {
      // Check for Python project files
      const hasRequirements = await this.fileExists('requirements.txt');
      const hasPipfile = await this.fileExists('Pipfile');
      const hasSetupPy = await this.fileExists('setup.py');
      const hasPyproject = await this.fileExists('pyproject.toml');

      if (hasRequirements || hasPipfile || hasSetupPy || hasPyproject) {
        context.language = 'python';
        context.packageManager = 'pip';

        if (hasPipfile) {
          context.aiGuidance.push('Uses Pipenv for dependency management');
        }

        if (hasPyproject) {
          const content = await fs.readFile(path.join(this.projectRoot, 'pyproject.toml'), 'utf-8');
          if (content.includes('[tool.poetry]')) {
            context.packageManager = 'pip'; // Could be poetry
            context.aiGuidance.push('Uses Poetry for dependency management');
          }
        }

        // Try to detect Python version from .python-version or runtime.txt
        const versionFile = await this.findFirstExisting(['.python-version', 'runtime.txt']);
        if (versionFile) {
          const version = await fs.readFile(path.join(this.projectRoot, versionFile), 'utf-8');
          context.pythonVersion = version.trim();
          context.aiGuidance.push(`Python version: ${context.pythonVersion}`);
        }
      }
    } catch (error) {
      // Not a Python project
    }
  }

  private async detectJavaContext(context: BuildContext): Promise<void> {
    try {
      const hasPom = await this.fileExists('pom.xml');
      const hasGradle = await this.fileExists('build.gradle') || await this.fileExists('build.gradle.kts');

      if (hasPom || hasGradle) {
        context.language = 'java';

        if (hasPom) {
          context.packageManager = 'maven';
          context.buildTool = 'maven';
          context.aiGuidance.push('Maven project: Use mvn commands for building');
        } else if (hasGradle) {
          context.packageManager = 'gradle';
          context.buildTool = 'gradle';
          context.aiGuidance.push('Gradle project: Use gradle or ./gradlew commands');
        }
      }
    } catch (error) {
      // Not a Java project
    }
  }

  private generateAIGuidance(context: BuildContext): void {
    // Add guidance to prevent common AI errors
    if (context.requiresJsExtensions) {
      context.errors.push('AI COMMON ERROR: Forgetting .js extensions in TypeScript ESM projects');
    }

    if (context.hasTypeScript && !context.tsConfig?.strict) {
      context.warnings.push('TypeScript without strict mode - AI may generate unsafe code');
    }

    if (context.moduleSystem === 'esm') {
      context.aiGuidance.push('Use "import" syntax, not "require"');
      context.aiGuidance.push('Add "type": "module" in package.json if missing');
    }

    if (context.moduleSystem === 'commonjs') {
      context.aiGuidance.push('Use "require" for CommonJS, or configure for ESM if needed');
    }

    // Package manager specific guidance
    if (context.packageManager) {
      const commands: Record<string, string> = {
        npm: 'npm install',
        yarn: 'yarn add',
        pnpm: 'pnpm add',
        pip: 'pip install',
        maven: 'mvn dependency:get',
        gradle: 'gradle dependencies'
      };
      context.aiGuidance.push(`Use "${commands[context.packageManager]}" for installing packages`);
    }
  }

  private async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.projectRoot, filename));
      return true;
    } catch {
      return false;
    }
  }

  private async findFirstExisting(filenames: string[]): Promise<string | null> {
    for (const filename of filenames) {
      if (await this.fileExists(filename)) {
        return filename;
      }
    }
    return null;
  }

  /**
   * Generate a build command based on detected context
   */
  generateBuildCommand(context: BuildContext): string {
    if (context.buildTool === 'tsc') {
      return 'npx tsc';
    } else if (context.packageManager === 'npm' && context.language === 'typescript') {
      return 'npm run build';
    } else if (context.packageManager === 'yarn') {
      return 'yarn build';
    } else if (context.packageManager === 'pnpm') {
      return 'pnpm build';
    } else if (context.packageManager === 'maven') {
      return 'mvn compile';
    } else if (context.packageManager === 'gradle') {
      return './gradlew build';
    } else if (context.language === 'python') {
      return 'python -m py_compile ./**/*.py';
    }
    return 'echo "No build step detected"';
  }
}