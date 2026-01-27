/**
 * Version Checker - Validates library versions against latest and detects deprecated APIs
 * Supports npm, pypi, maven, cargo, gem, nuget, and go registries
 */

import { NpmValidator } from './npm.js';
import { PyPiValidator } from './pypi.js';
import { MavenValidator } from './maven.js';
import { CargoValidator } from './cargo.js';
import { GemValidator } from './gem.js';
import { NuGetValidator } from './nuget.js';
import { GoValidator } from './go.js';

export interface VersionInfo {
  packageName: string;
  currentVersion?: string;
  latestVersion?: string;
  isOutdated: boolean;
  isDeprecated: boolean;
  majorVersionsBehind?: number;
  minorVersionsBehind?: number;
  securityVulnerabilities: SecurityVulnerability[];
  breakingChanges?: BreakingChange[];
  deprecationNotice?: DeprecationNotice;
  updateComplexity: 'low' | 'medium' | 'high';
  migrationPath?: string[];
  lastChecked: Date;
  registry: string;
}

export interface SecurityVulnerability {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  fixedIn: string;
  cve?: string;
  affectedVersions: string[];
}

export interface BreakingChange {
  fromVersion: string;
  toVersion: string;
  description: string;
  impact: string;
  migrationGuide?: string;
}

export interface DeprecationNotice {
  deprecatedSince: string;
  removedIn?: string;
  replacement?: string;
  reason: string;
  timeline: 'immediate' | 'soon' | 'planned';
}

export interface DeprecatedAPIPattern {
  pattern: string;
  regex: RegExp;
  replacement: string;
  library: string;
  deprecatedSince: string;
  removedIn?: string;
  reason: string;
}

export class VersionChecker {
  private npmValidator: NpmValidator;
  private pypiValidator: PyPiValidator;
  private mavenValidator: MavenValidator;
  private cargoValidator: CargoValidator;
  private gemValidator: GemValidator;
  private nugetValidator: NuGetValidator;
  private goValidator: GoValidator;

  private versionCache = new Map<string, { data: VersionInfo; timestamp: number }>();
  private readonly cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours

  private deprecatedAPIs: DeprecatedAPIPattern[] = [];

  constructor() {
    this.npmValidator = new NpmValidator();
    this.pypiValidator = new PyPiValidator();
    this.mavenValidator = new MavenValidator();
    this.cargoValidator = new CargoValidator();
    this.gemValidator = new GemValidator();
    this.nugetValidator = new NuGetValidator();
    this.goValidator = new GoValidator();

    this.initializeDeprecatedAPIs();
  }

  /**
   * Check version information for a package
   */
  async checkVersion(
    packageName: string,
    currentVersion?: string,
    registry?: 'npm' | 'pypi' | 'maven' | 'cargo' | 'gem' | 'nuget' | 'go'
  ): Promise<VersionInfo> {
    const cacheKey = `${packageName}@${currentVersion || 'latest'}:${registry || 'auto'}`;
    const cached = this.versionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Determine registry if not specified
      const targetRegistry = registry || this.detectRegistry(packageName);

      const versionInfo = await this.fetchVersionInfo(
        packageName,
        currentVersion,
        targetRegistry
      );

      this.versionCache.set(cacheKey, { data: versionInfo, timestamp: Date.now() });
      return versionInfo;

    } catch (error) {
      console.error(`Failed to check version for ${packageName}:`, error);

      return {
        packageName,
        currentVersion,
        isOutdated: false,
        isDeprecated: false,
        securityVulnerabilities: [],
        updateComplexity: 'unknown' as any,
        lastChecked: new Date(),
        registry: registry || 'unknown'
      };
    }
  }

  /**
   * Check multiple packages at once
   */
  async checkVersionsBatch(
    packages: Array<{ name: string; version?: string; registry?: string }>
  ): Promise<VersionInfo[]> {
    return Promise.all(
      packages.map(pkg => this.checkVersion(pkg.name, pkg.version, pkg.registry as any))
    );
  }

  /**
   * Detect deprecated API patterns in code
   */
  detectDeprecatedAPIs(code: string, language: string): DeprecatedAPIPattern[] {
    const found: DeprecatedAPIPattern[] = [];

    for (const api of this.deprecatedAPIs) {
      // Filter by language if applicable
      if (language && !this.isApiForLanguage(api, language)) {
        continue;
      }

      const matches = code.match(api.regex);
      if (matches) {
        found.push(api);
      }
    }

    return found;
  }

  /**
   * Get migration path from current to target version
   */
  async getMigrationPath(
    packageName: string,
    fromVersion: string,
    toVersion: string,
    registry?: string
  ): Promise<string[]> {
    const path: string[] = [];

    try {
      // Fetch release notes or changelog
      const releases = await this.fetchReleaseHistory(packageName, registry || 'npm');

      // Build chronological path
      const between = releases.filter(r => {
        const isAfterFrom = this.compareVersions(r.version, fromVersion) > 0;
        const isBeforeTo = this.compareVersions(r.version, toVersion) <= 0;
        return isAfterFrom && isBeforeTo;
      });

      // Generate migration steps
      for (const release of between) {
        if (release.breaking) {
          path.push(`Major: ${release.version} - ${release.breaking}`);
        }
        if (release.deprecated) {
          path.push(`Deprecated in ${release.version}: ${release.deprecated}`);
        }
      }

      return path;
    } catch (error) {
      console.error('Failed to get migration path:', error);
      return [];
    }
  }

  /**
   * Check for security vulnerabilities in a specific version
   */
  async checkSecurityVulnerabilities(
    packageName: string,
    version: string,
    registry?: string
  ): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    try {
      const validator = this.getValidator(registry || 'npm');
      const packageInfo = await validator.validate(packageName, version);

      if (packageInfo.securityIssues) {
        vulnerabilities.push(
          ...packageInfo.securityIssues.map((issue: any) => ({
            id: issue.cve || `${packageName}-${version}-${issue.severity}`,
            severity: issue.severity,
            description: issue.description,
            fixedIn: issue.fixedIn || '',
            cve: issue.cve,
            affectedVersions: [version]
          }))
        );
      }
    } catch (error) {
      console.error('Failed to check security vulnerabilities:', error);
    }

    return vulnerabilities;
  }

  /**
   * Get recommended version based on compatibility and security
   */
  async getRecommendedVersion(
    packageName: string,
    _minCompatibility: string = '>=',
    registry?: string
  ): Promise<string | null> {
    try {
      const validator = this.getValidator(registry || 'npm');
      const packageInfo = await validator.validate(packageName);

      if (!packageInfo.latestVersion) {
        return null;
      }

      // Check if latest has security issues
      const vulnerabilities = await this.checkSecurityVulnerabilities(
        packageName,
        packageInfo.latestVersion,
        registry
      );

      if (vulnerabilities.some(v => v.severity === 'critical' || v.severity === 'high')) {
        // Latest has critical vulnerabilities, find safe version
        return await this.findSafeVersion(packageName, registry);
      }

      return packageInfo.latestVersion;
    } catch (error) {
      console.error('Failed to get recommended version:', error);
      return null;
    }
  }

  /**
   * Extract version from package.json or requirements.txt style strings
   */
  extractPackagesWithVersions(
    content: string,
    language: 'npm' | 'python' | 'maven' | 'cargo' | 'ruby' | 'dotnet' | 'go'
  ): Array<{ name: string; version?: string }> {
    const packages: Array<{ name: string; version?: string }> = [];

    switch (language) {
      case 'npm': {
        try {
          const json = JSON.parse(content);
          const deps = { ...json.dependencies, ...json.devDependencies };
          for (const [name, version] of Object.entries(deps)) {
            packages.push({ name, version: version as string });
          }
        } catch (e) {
          // Fallback to regex parsing
          const matches = content.matchAll(/"([^"]+)":\s*"([^"]+)"/g);
          for (const match of matches) {
            const pkg: { name: string; version?: string } = { name: match[1] || '' };
            if (match[2]) pkg.version = match[2];
            packages.push(pkg);
          }
        }
        break;
      }

      case 'python': {
        // Parse requirements.txt or similar
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          // Handle: package==1.0.0, package>=1.0, package, etc.
          const match = trimmed.match(/^([a-zA-Z0-9._-]+)(?:([=><~!]+)(.+))?/);
          if (match) {
            const pkg: { name: string; version?: string } = { name: match[1] || '' };
            if (match[3]) {
              const operator = match[2] || '';
              pkg.version = `${operator}${match[3]}`;
            }
            packages.push(pkg);
          }
        }
        break;
      }

      case 'cargo': {
        // Parse Cargo.toml style
        const matches = content.matchAll(/^(\w[\w-]*)\s*=\s*["{]?([0-9*.~=<>]+)?/gm);
        for (const match of matches) {
          const pkg: { name: string; version?: string } = { name: match[1] || '' };
          if (match[2]) pkg.version = match[2];
          packages.push(pkg);
        }
        break;
      }

      case 'ruby': {
        // Parse Gemfile style
        const matches = content.matchAll(/gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"]])?/g);
        for (const match of matches) {
          const pkg: { name: string; version?: string } = { name: match[1] || '' };
          if (match[2]) pkg.version = match[2];
          packages.push(pkg);
        }
        break;
      }

      case 'maven': {
        // Parse Maven pom.xml
        const matches = content.matchAll(
          /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/gm
        );
        for (const match of matches) {
          packages.push({ name: `${match[1]}:${match[2]}`, version: match[3] });
        }
        break;
      }

      case 'dotnet': {
        // Parse .csproj or packages.config
        const matches = content.matchAll(
          /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g
        );
        for (const match of matches) {
          const pkg: { name: string; version?: string } = { name: match[1] || '' };
          if (match[2]) pkg.version = match[2];
          packages.push(pkg);
        }
        break;
      }

      case 'go': {
        // Parse go.mod
        const matches = content.matchAll(/require\s+(\S+)\s+([v\d.]+)/gm);
        for (const match of matches) {
          const pkg: { name: string; version?: string } = { name: match[1] || '' };
          if (match[2]) pkg.version = match[2];
          packages.push(pkg);
        }
        break;
      }
    }

    return packages;
  }

  /**
   * Compare two semantic versions
   * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parse = (v: string) => {
      const cleaned = v.replace(/^[=v~^<>]+/, '');
      const parts = cleaned.split('.').map(p => {
        const match = p.match(/^(\d+)/);
        return match && match[1] ? parseInt(match[1], 10) : 0;
      });
      return parts;
    };

    const parts1 = parse(v1);
    const parts2 = parse(v2);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * Find a safe version without critical vulnerabilities
   */
  private async findSafeVersion(_packageName: string, _registry?: string): Promise<string | null> {
    try {
      // This would require access to full version history with vulnerability info
      // For now, return null to indicate manual review needed
      return null;
    } catch (error) {
      console.error('Failed to find safe version:', error);
      return null;
    }
  }

  /**
   * Fetch version information from registry
   */
  private async fetchVersionInfo(
    packageName: string,
    currentVersion?: string,
    registry?: string
  ): Promise<VersionInfo> {
    const validator = this.getValidator(registry || 'npm');
    const packageInfo = await validator.validate(packageName, currentVersion);

    const isOutdated = currentVersion && packageInfo.latestVersion
      ? this.compareVersions(currentVersion, packageInfo.latestVersion) < 0
      : false;

    const majorVersionsBehind = this.calculateVersionsBehind(
      currentVersion,
      packageInfo.latestVersion,
      'major'
    );

    const minorVersionsBehind = this.calculateVersionsBehind(
      currentVersion,
      packageInfo.latestVersion,
      'minor'
    );

    const vulnerabilities = packageInfo.securityIssues || [];

    return {
      packageName,
      currentVersion,
      latestVersion: packageInfo.latestVersion,
      isOutdated,
      isDeprecated: packageInfo.deprecated || false,
      majorVersionsBehind,
      minorVersionsBehind,
      securityVulnerabilities: vulnerabilities.map((v: any) => ({
        id: v.cve || `${packageName}-${v.severity}`,
        severity: v.severity,
        description: v.description,
        fixedIn: v.fixedIn || '',
        cve: v.cve,
        affectedVersions: currentVersion ? [currentVersion] : []
      })),
      updateComplexity: this.calculateUpdateComplexity(majorVersionsBehind || 0),
      lastChecked: new Date(),
      registry: registry || 'npm'
    };
  }

  /**
   * Fetch release history and changelog
   */
  private async fetchReleaseHistory(
    _packageName: string,
    _registry: string
  ): Promise<Array<{
    version: string;
    breaking?: string;
    deprecated?: string;
  }>> {
    // This would fetch changelog/release notes
    // For now, return empty array
    return [];
  }

  /**
   * Calculate how many major/minor versions behind
   */
  private calculateVersionsBehind(
    current?: string,
    latest?: string,
    granularity: 'major' | 'minor' = 'major'
  ): number {
    if (!current || !latest) return 0;

    const parsePart = (v: string, part: 'major' | 'minor') => {
      const cleaned = v.replace(/^[=v~^<>]+/, '');
      const parts = cleaned.split('.');
      return parseInt(parts[part === 'major' ? 0 : 1] || '0', 10);
    };

    if (granularity === 'major') {
      return Math.max(0, parsePart(latest, 'major') - parsePart(current, 'major'));
    } else {
      const majorDiff = parsePart(latest, 'major') - parsePart(current, 'major');
      if (majorDiff > 0) {
        return majorDiff * 100 + parsePart(latest, 'minor');
      }
      return Math.max(0, parsePart(latest, 'minor') - parsePart(current, 'minor'));
    }
  }

  /**
   * Calculate update complexity based on version distance
   */
  private calculateUpdateComplexity(majorVersionsBehind: number): 'low' | 'medium' | 'high' {
    if (majorVersionsBehind === 0) return 'low';
    if (majorVersionsBehind === 1) return 'medium';
    return 'high';
  }

  /**
   * Get appropriate validator for registry
   */
  private getValidator(registry: string) {
    switch (registry.toLowerCase()) {
      case 'npm': return this.npmValidator;
      case 'pypi': return this.pypiValidator;
      case 'maven': return this.mavenValidator;
      case 'cargo': return this.cargoValidator;
      case 'gem': return this.gemValidator;
      case 'nuget': return this.nugetValidator;
      case 'go': return this.goValidator;
      default: return this.npmValidator;
    }
  }

  /**
   * Detect registry from package name patterns
   */
  private detectRegistry(packageName: string): 'npm' | 'pypi' | 'maven' | 'cargo' | 'gem' | 'nuget' | 'go' {
    // Maven: contains ':'
    if (packageName.includes(':')) return 'maven';

    // Go: contains '/'
    if (packageName.includes('/') && packageName.startsWith(packageName.split('/')[0] + '/')) {
      return 'go';
    }

    // Default to npm
    return 'npm';
  }

  /**
   * Check if deprecated API pattern is for a specific language
   */
  private isApiForLanguage(api: DeprecatedAPIPattern, language: string): boolean {
    // Map language to library if needed
    const languageLibraries: Record<string, string[]> = {
      javascript: ['react', 'nextjs', 'react-query', 'openai'],
      typescript: ['react', 'nextjs', 'react-query', 'openai'],
      python: ['openai', 'requests', 'flask', 'django'],
      go: ['gin', 'gorm', 'cobra'],
      java: ['spring', 'junit']
    };

    const libs = languageLibraries[language.toLowerCase()] || [];
    return libs.some(lib => api.library.toLowerCase().includes(lib));
  }

  /**
   * Initialize common deprecated API patterns
   */
  private initializeDeprecatedAPIs() {
    this.deprecatedAPIs = [
      // Next.js
      {
        pattern: 'import { useRouter } from "next/router"',
        regex: /import\s+{\s*useRouter\s*}\s+from\s+['"]next\/router['"]/,
        replacement: 'import { useRouter } from "next/navigation"',
        library: 'nextjs',
        deprecatedSince: '13.0.0',
        removedIn: '14.0.0',
        reason: 'Pages Router deprecated in favor of App Router'
      },
      {
        pattern: 'getStaticProps/getServerSideProps',
        regex: /export\s+(?:async\s+)?function\s+(?:getStaticProps|getServerSideProps)/,
        replacement: 'Use Server Components or route handlers in app directory',
        library: 'nextjs',
        deprecatedSince: '13.0.0',
        removedIn: '14.0.0',
        reason: 'Replaced with Server Components'
      },

      // React Query
      {
        pattern: 'import { useQuery } from "react-query"',
        regex: /import\s+{\s*useQuery\s*}\s+from\s+['"]react-query['"]/,
        replacement: 'import { useQuery } from "@tanstack/react-query"',
        library: 'react-query',
        deprecatedSince: '4.0.0',
        removedIn: '5.0.0',
        reason: 'Package renamed to @tanstack/react-query'
      },

      // React
      {
        pattern: 'React.FC or React.FunctionComponent',
        regex: /React\.FC<|React\.FunctionComponent</,
        replacement: 'Use function (params: Props) => JSX.Element',
        library: 'react',
        deprecatedSince: '17.0.0',
        reason: 'Implicit children prop causes issues'
      },

      // OpenAI API
      {
        pattern: 'openai.createCompletion()',
        regex: /openai\.createCompletion\(/,
        replacement: 'openai.chat.completions.create()',
        library: 'openai',
        deprecatedSince: '3.0.0',
        removedIn: '4.0.0',
        reason: 'GPT-3 completions endpoint deprecated'
      },
      {
        pattern: 'openai.createEmbedding()',
        regex: /openai\.createEmbedding\(/,
        replacement: 'openai.embeddings.create()',
        library: 'openai',
        deprecatedSince: '3.0.0',
        removedIn: '4.0.0',
        reason: 'Embeddings API method renamed'
      },

      // Node.js
      {
        pattern: 'require("module").createRequire()',
        regex: /require\(['"]module['"]\)\.createRequire/,
        replacement: 'Use import.meta.url with createRequire or native imports',
        library: 'nodejs',
        deprecatedSince: '12.0.0',
        reason: 'CommonJS requires conditional logic in ESM'
      },

      // Webpack/Babel
      {
        pattern: '@babel/plugin-transform-runtime',
        regex: /@babel\/plugin-transform-runtime/,
        replacement: 'Update to latest version and configure properly',
        library: 'babel',
        deprecatedSince: '7.4.0',
        reason: 'Plugin configuration changed in newer versions'
      },

      // Lodash
      {
        pattern: 'import _ from "lodash"',
        regex: /import\s+_\s+from\s+['"]lodash['"]/,
        replacement: 'import { functionName } from "lodash"',
        library: 'lodash',
        deprecatedSince: '4.0.0',
        reason: 'Default import includes entire library; use named imports'
      },

      // Deprecated HTTP libraries
      {
        pattern: 'request library',
        regex: /require\(['"]request['"]\)|from\s+['"]request['"]/,
        replacement: 'Use axios, fetch, or native Node.js http/https',
        library: 'request',
        deprecatedSince: '2021.0.0',
        removedIn: '2022.0.0',
        reason: 'Package is fully deprecated'
      }
    ];
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.versionCache.clear();
    this.npmValidator.clearCache?.();
  }
}
