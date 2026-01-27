/**
 * Dependency Updater - Generates upgrade commands and migration guides
 * Helps AI understand how to safely update dependencies with breaking changes
 */

import type { VersionInfo, BreakingChange, DeprecationNotice } from '../validators/version-checker.js';

export interface UpgradeReport {
  packageName: string;
  fromVersion?: string;
  toVersion: string;
  upgradeCommand: string;
  installCommand: string;
  complexity: 'low' | 'medium' | 'high';
  estimatedTime: string;
  breakingChanges: BreakingChange[];
  deprecations: DeprecationNotice[];
  migrationSteps: MigrationStep[];
  testingStrategy: string[];
  rollbackStrategy: string;
  risks: RiskAssessment;
  resources: MigrationResource[];
}

export interface MigrationStep {
  step: number;
  title: string;
  description: string;
  commands?: string[];
  codeChanges?: CodeChange[];
  verification: string;
  rollbackCommand?: string;
}

export interface CodeChange {
  file: string;
  from: string;
  to: string;
  explanation: string;
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  mitigations: string[];
}

export interface MigrationResource {
  type: 'changelog' | 'migration-guide' | 'blog' | 'video' | 'docs';
  title: string;
  url?: string;
  summary: string;
}

export class DependencyUpdater {
  /**
   * Generate comprehensive upgrade report
   */
  generateUpgradeReport(
    versionInfo: VersionInfo,
    currentVersion?: string
  ): UpgradeReport {
    const toVersion = versionInfo.latestVersion || 'latest';
    const complexity = versionInfo.updateComplexity || 'medium';

    return {
      packageName: versionInfo.packageName,
      fromVersion: currentVersion || versionInfo.currentVersion,
      toVersion,
      upgradeCommand: this.generateUpgradeCommand(versionInfo.packageName, toVersion, versionInfo.registry),
      installCommand: this.generateInstallCommand(versionInfo.packageName, toVersion, versionInfo.registry),
      complexity,
      estimatedTime: this.estimateUpdateTime(complexity),
      breakingChanges: this.getBreakingChanges(versionInfo.packageName, currentVersion, toVersion),
      deprecations: this.getDeprecationNotices(versionInfo.packageName, currentVersion, toVersion),
      migrationSteps: this.generateMigrationSteps(versionInfo.packageName, currentVersion, toVersion, complexity),
      testingStrategy: this.generateTestingStrategy(versionInfo.packageName, complexity),
      rollbackStrategy: this.generateRollbackStrategy(versionInfo.packageName, versionInfo.registry),
      risks: this.assessRisks(versionInfo, currentVersion, toVersion),
      resources: this.getResourceLinks(versionInfo.packageName, currentVersion, toVersion)
    };
  }

  /**
   * Generate upgrade command for package manager
   */
  generateUpgradeCommand(packageName: string, toVersion: string, registry: string): string {
    switch (registry.toLowerCase()) {
      case 'npm':
        return `npm install ${packageName}@${toVersion}`;

      case 'pypi':
        return `pip install --upgrade ${packageName}==${toVersion}`;

      case 'maven':
        return `mvn versions:set -DnewVersion=${toVersion}`;

      case 'cargo':
        return `cargo update ${packageName} --precise ${toVersion}`;

      case 'gem':
        return `bundle update ${packageName}`;

      case 'nuget':
        return `Update-Package ${packageName} -Version ${toVersion}`;

      case 'go':
        return `go get -u ${packageName}@v${toVersion}`;

      default:
        return `npm install ${packageName}@${toVersion}`;
    }
  }

  /**
   * Generate install command
   */
  generateInstallCommand(packageName: string, version: string, registry: string): string {
    switch (registry.toLowerCase()) {
      case 'npm':
        return `npm install ${packageName}@${version}`;

      case 'pypi':
        return `pip install ${packageName}==${version}`;

      case 'maven':
        return `<dependency>
    <groupId>org.example</groupId>
    <artifactId>${packageName}</artifactId>
    <version>${version}</version>
</dependency>`;

      case 'cargo':
        return `${packageName} = "${version}"`;

      case 'gem':
        return `gem '${packageName}', '~> ${version}'`;

      case 'nuget':
        return `Install-Package ${packageName} -Version ${version}`;

      case 'go':
        return `go get ${packageName}@v${version}`;

      default:
        return `npm install ${packageName}@${version}`;
    }
  }

  /**
   * Generate migration steps based on package and version jump
   */
  private generateMigrationSteps(
    packageName: string,
    _fromVersion?: string,
    _toVersion?: string,
    complexity: 'low' | 'medium' | 'high' = 'medium'
  ): MigrationStep[] {
    const steps: MigrationStep[] = [
      {
        step: 1,
        title: 'Backup and Version Control',
        description: 'Ensure your code is committed and create a backup branch',
        commands: [
          'git status',
          'git add .',
          'git commit -m "Backup before updating ' + packageName + '"',
          'git checkout -b update/' + packageName
        ],
        verification: 'git branch should show your new branch',
        rollbackCommand: 'git checkout -'
      },

      {
        step: 2,
        title: 'Review Breaking Changes',
        description: 'Check the changelog for breaking changes between versions',
        codeChanges: this.getCommonCodeChanges(packageName, _fromVersion, _toVersion),
        verification: 'Review all listed breaking changes and plan code adjustments'
      },

      {
        step: 3,
        title: 'Update Package',
        description: 'Install the new version of the package',
        commands: [this.generateUpgradeCommand(packageName, _toVersion || 'latest', 'npm')],
        verification: 'npm ls ' + packageName + ' should show new version'
      },

      {
        step: 4,
        title: 'Update Imports and API Calls',
        description: 'Update your code to use new API patterns',
        codeChanges: this.getImportUpdateChanges(packageName),
        verification: 'Code should compile without import-related errors'
      },

      {
        step: 5,
        title: 'Run Type Checking (TypeScript)',
        description: 'Verify type compatibility with new version',
        commands: ['npm run typecheck'],
        verification: 'No type errors in type checking output'
      },

      {
        step: 6,
        title: 'Run Tests',
        description: 'Execute your test suite to catch breaking changes',
        commands: ['npm test'],
        verification: 'All tests should pass'
      },

      {
        step: 7,
        title: 'Manual Testing',
        description: 'Test affected features manually',
        verification: 'Features work as expected in browser/app'
      },

      {
        step: 8,
        title: 'Check Dependencies',
        description: 'Verify no dependency conflicts',
        commands: ['npm audit', 'npm ls'],
        verification: 'No high/critical vulnerabilities'
      }
    ];

    // Filter steps based on complexity
    if (complexity === 'low') {
      return steps.slice(0, 3);
    }

    return steps;
  }

  /**
   * Get breaking changes for a package
   */
  private getBreakingChanges(
    packageName: string,
    _fromVersion?: string,
    _toVersion?: string
  ): BreakingChange[] {
    // Map of known breaking changes by package
    const breakingChangesDB: Record<string, BreakingChange[]> = {
      'react-query': [
        {
          fromVersion: '3.x',
          toVersion: '4.x',
          description: 'Package renamed to @tanstack/react-query',
          impact: 'All imports must be updated',
          migrationGuide: 'Change "react-query" to "@tanstack/react-query" in imports'
        },
        {
          fromVersion: '4.x',
          toVersion: '5.x',
          description: 'useQuery hook signature changed',
          impact: 'Query definitions must be refactored',
          migrationGuide: 'Use queryFn and queryKey as separate parameters'
        }
      ],
      'next': [
        {
          fromVersion: '12.x',
          toVersion: '13.x',
          description: 'App Router introduced, Pages Router deprecated',
          impact: 'Project structure needs migration',
          migrationGuide: 'Create app/ directory and migrate from pages/'
        },
        {
          fromVersion: '13.x',
          toVersion: '14.x',
          description: 'getServerSideProps/getStaticProps removed',
          impact: 'Cannot use old data fetching patterns',
          migrationGuide: 'Use Server Components or route handlers'
        }
      ],
      'react': [
        {
          fromVersion: '17.x',
          toVersion: '18.x',
          description: 'Automatic batching for all updates',
          impact: 'Some component behaviors may change',
          migrationGuide: 'Test components thoroughly, especially with state'
        }
      ],
      'express': [
        {
          fromVersion: '4.x',
          toVersion: '5.x',
          description: 'Removed express.text() and express.json() defaults',
          impact: 'Must explicitly add body parsing middleware',
          migrationGuide: 'Add app.use(express.json()) and app.use(express.text())'
        }
      ],
      'axios': [
        {
          fromVersion: '0.x',
          toVersion: '1.x',
          description: 'Removed deprecated request config properties',
          impact: 'Custom config may not work',
          migrationGuide: 'Update deprecated axios configuration'
        }
      ],
      'lodash': [
        {
          fromVersion: '3.x',
          toVersion: '4.x',
          description: 'Many functions signature changed, removed some utilities',
          impact: 'Utility functions may behave differently',
          migrationGuide: 'Review lodash 4 migration guide for each function'
        }
      ]
    };

    return breakingChangesDB[packageName.toLowerCase()] || [];
  }

  /**
   * Get deprecation notices
   */
  private getDeprecationNotices(
    packageName: string,
    _fromVersion?: string,
    _toVersion?: string
  ): DeprecationNotice[] {
    const deprecationDB: Record<string, DeprecationNotice[]> = {
      'request': [
        {
          deprecatedSince: '2021.0.0',
          removedIn: '2023.0.0',
          replacement: 'axios, node-fetch, or native fetch',
          reason: 'Package fully deprecated, maintainers recommend alternatives',
          timeline: 'immediate'
        }
      ],
      'body-parser': [
        {
          deprecatedSince: '4.16.0',
          replacement: 'express.json(), express.text(), etc.',
          reason: 'Built into Express natively',
          timeline: 'soon'
        }
      ],
      'react-dom/test-utils': [
        {
          deprecatedSince: '18.0.0',
          replacement: 'React Testing Library',
          reason: 'Testing utils moved to external package',
          timeline: 'planned'
        }
      ]
    };

    return deprecationDB[packageName.toLowerCase()] || [];
  }

  /**
   * Get common code changes needed
   */
  private getCommonCodeChanges(
    packageName: string,
    _fromVersion?: string,
    _toVersion?: string
  ): CodeChange[] {
    const changesDB: Record<string, CodeChange[]> = {
      'react-query': [
        {
          file: 'src/**/*.tsx',
          from: 'import { useQuery } from "react-query"',
          to: 'import { useQuery } from "@tanstack/react-query"',
          explanation: 'Package renamed to @tanstack/react-query'
        }
      ],
      'next': [
        {
          file: 'pages/**/*.tsx',
          from: 'export async function getServerSideProps() {}',
          to: 'export default async function Page() { const data = await fetch(...); ... }',
          explanation: 'Use Server Components instead of getServerSideProps'
        }
      ],
      'axios': [
        {
          file: 'src/**/*.ts',
          from: 'axios.get(url).then(...)',
          to: 'try { const res = await axios.get(url); ... } catch (error) { ... }',
          explanation: 'Async/await is more readable than promise chains'
        }
      ]
    };

    return changesDB[packageName.toLowerCase()] || [];
  }

  /**
   * Get import update changes
   */
  private getImportUpdateChanges(packageName: string): CodeChange[] {
    const importChanges: Record<string, CodeChange[]> = {
      'openai': [
        {
          file: 'src/**/*.ts',
          from: 'const completion = await openai.createCompletion({...})',
          to: 'const response = await openai.chat.completions.create({...})',
          explanation: 'GPT-3 completions replaced with chat completions'
        }
      ],
      'lodash': [
        {
          file: 'src/**/*.ts',
          from: 'import _ from "lodash"',
          to: 'import { map, filter } from "lodash"',
          explanation: 'Use named imports to reduce bundle size'
        }
      ]
    };

    return importChanges[packageName.toLowerCase()] || [];
  }

  /**
   * Generate testing strategy
   */
  private generateTestingStrategy(
    _packageName: string,
    complexity: 'low' | 'medium' | 'high'
  ): string[] {
    const base = [
      'Run unit tests: npm test',
      'Run type checking: npm run typecheck',
      'Check for build errors: npm run build'
    ];

    if (complexity === 'medium') {
      return [
        ...base,
        'Run integration tests',
        'Manual smoke testing of affected features',
        'Check browser console for warnings'
      ];
    }

    if (complexity === 'high') {
      return [
        ...base,
        'Full integration test suite',
        'End-to-end testing',
        'Performance testing',
        'Accessibility testing',
        'Security scanning',
        'Manual QA on all affected features',
        'Load testing'
      ];
    }

    return base;
  }

  /**
   * Generate rollback strategy
   */
  private generateRollbackStrategy(packageName: string, registry: string): string {
    const rollback: Record<string, string> = {
      npm: `npm install ${packageName}@OLD_VERSION && npm ci`,
      pypi: `pip install ${packageName}==OLD_VERSION`,
      cargo: `cargo update ${packageName} --precise OLD_VERSION`,
      gem: `bundle update ${packageName}`,
      maven: `mvn versions:set -DnewVersion=OLD_VERSION`,
      nuget: `Update-Package ${packageName} -Version OLD_VERSION`,
      go: `go get ${packageName}@vOLD_VERSION`
    };

    const strategy = rollback[registry.toLowerCase()] || rollback.npm;
    return `1. Revert package.json/lock file changes\n2. Run: ${strategy}\n3. Restart development server\n4. Run tests to verify`;
  }

  /**
   * Estimate update time
   */
  private estimateUpdateTime(complexity: 'low' | 'medium' | 'high'): string {
    const times = {
      low: '15-30 minutes',
      medium: '1-3 hours',
      high: '4-8+ hours'
    };
    return times[complexity];
  }

  /**
   * Assess risks of update
   */
  private assessRisks(
    versionInfo: VersionInfo,
    _fromVersion?: string,
    _toVersion?: string
  ): RiskAssessment {
    const factors: string[] = [];
    const mitigations: string[] = [];

    // Major version jump
    if (versionInfo.majorVersionsBehind && versionInfo.majorVersionsBehind > 2) {
      factors.push('Large version jump (3+ major versions)');
      mitigations.push('Consider updating through intermediate versions');
      mitigations.push('Test extensively at each major version');
    }

    // Breaking changes
    if (versionInfo.updateComplexity === 'high') {
      factors.push('High complexity update with breaking changes');
      mitigations.push('Plan dedicated time for migration');
      mitigations.push('Have rollback plan ready');
    }

    // Security issues
    if (versionInfo.securityVulnerabilities.length > 0) {
      const hasHigh = versionInfo.securityVulnerabilities.some(v =>
        v.severity === 'high' || v.severity === 'critical'
      );
      if (hasHigh) {
        factors.push('Current version has high/critical security vulnerabilities');
        mitigations.push('Prioritize this update as soon as possible');
      }
    }

    // Deprecation
    if (versionInfo.isDeprecated) {
      factors.push('Package version is deprecated');
      mitigations.push('Update soon to avoid losing support');
    }

    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';

    if (factors.length === 0) {
      level = 'low';
    } else if (factors.length <= 2) {
      level = 'medium';
    } else if (versionInfo.securityVulnerabilities.some(v => v.severity === 'critical')) {
      level = 'critical';
    } else {
      level = 'high';
    }

    return {
      level,
      factors,
      mitigations
    };
  }

  /**
   * Get resource links for migration
   */
  private getResourceLinks(
    packageName: string,
    _fromVersion?: string,
    _toVersion?: string
  ): MigrationResource[] {
    const resourceDB: Record<string, MigrationResource[]> = {
      'react-query': [
        {
          type: 'migration-guide',
          title: 'React Query v3 to v4 Migration Guide',
          url: 'https://tanstack.com/query/latest/docs/react/guides/migrating-to-react-query-4',
          summary: 'Official migration guide covering all breaking changes'
        },
        {
          type: 'changelog',
          title: 'React Query Changelog',
          url: 'https://github.com/TanStack/query/releases',
          summary: 'Detailed changelog of all versions'
        }
      ],
      'next': [
        {
          type: 'migration-guide',
          title: 'Next.js App Router Migration',
          url: 'https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration',
          summary: 'Complete guide to migrating from Pages Router to App Router'
        }
      ],
      'axios': [
        {
          type: 'changelog',
          title: 'Axios Changelog',
          url: 'https://github.com/axios/axios/releases',
          summary: 'Release notes for all Axios versions'
        }
      ]
    };

    const resources = resourceDB[packageName.toLowerCase()] || [];

    // Add generic resources
    resources.push({
      type: 'docs',
      title: `${packageName} Official Documentation`,
      summary: 'Check the official docs for the latest API and best practices'
    });

    return resources;
  }
}
