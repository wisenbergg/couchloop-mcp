/**
 * Registry Manager - Unified interface for all package validators
 */

import type { PackageInfo, RegistryValidator } from '../types/package.js';
import { NpmValidator } from './npm.js';
import { PyPiValidator } from './pypi.js';
import { MavenValidator } from './maven.js';
import { CargoValidator } from './cargo.js';
import { GemValidator } from './gem.js';
import { NuGetValidator } from './nuget.js';
import { GoValidator } from './go.js';

export class RegistryManager {
  private validators: Map<string, RegistryValidator>;

  constructor() {
    this.validators = new Map<string, RegistryValidator>();
    this.validators.set('npm', new NpmValidator());
    this.validators.set('pypi', new PyPiValidator());
    this.validators.set('maven', new MavenValidator());
    this.validators.set('cargo', new CargoValidator());
    this.validators.set('gem', new GemValidator());
    this.validators.set('nuget', new NuGetValidator());
    this.validators.set('go', new GoValidator());
  }

  /**
   * Detect registry type from package reference
   */
  detectRegistry(packageRef: string): string {
    // Maven packages contain colons
    if (packageRef.includes(':')) {
      return 'maven';
    }

    // Python packages often have hyphens or underscores
    // But this is not definitive, so we need context
    // For now, default to npm for JavaScript context
    return 'npm';
  }

  /**
   * Validate a package across registries
   */
  async validate(
    packageName: string,
    registry?: string,
    version?: string
  ): Promise<PackageInfo> {
    const targetRegistry = registry || this.detectRegistry(packageName);
    const validator = this.validators.get(targetRegistry);

    if (!validator) {
      return {
        name: packageName,
        version,
        registry: targetRegistry as PackageInfo['registry'],
        exists: false,
        warning: `Unknown registry: ${targetRegistry}`,
        lastChecked: new Date()
      } as PackageInfo;
    }

    return validator.validate(packageName, version);
  }

  /**
   * Validate multiple packages in parallel
   */
  async validateBatch(
    packages: Array<{ name: string; registry?: string; version?: string }>
  ): Promise<PackageInfo[]> {
    return Promise.all(
      packages.map(pkg =>
        this.validate(pkg.name, pkg.registry, pkg.version)
      )
    );
  }

  /**
   * Search for packages across a specific registry
   */
  async search(
    query: string,
    registry: string,
    limit = 10
  ): Promise<PackageInfo[]> {
    const validator = this.validators.get(registry);
    if (!validator) {
      return [];
    }

    return validator.search(query, limit);
  }

  /**
   * Find similar package names (for typo correction)
   */
  async findSimilar(
    packageName: string,
    registry: string
  ): Promise<string[]> {
    // Simple approach: search for the package name
    const results = await this.search(packageName, registry, 5);
    return results.map(r => r.name);
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.validators.forEach(validator => {
      if (validator.clearCache) {
        validator.clearCache();
      }
    });
  }
}