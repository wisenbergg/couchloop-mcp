/**
 * RubyGems Registry Validator
 * Validates Ruby gem existence from rubygems.org
 */

import type { PackageInfo, RegistryValidator } from '../types/package.js';

export class GemValidator implements RegistryValidator {
  private readonly registryUrl = 'https://rubygems.org/api/v1';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    const cacheKey = `${packageName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // RubyGems API endpoint
      const url = version
        ? `${this.registryUrl}/versions/${packageName}-${version}.json`
        : `${this.registryUrl}/gems/${packageName}.json`;

      const response = await fetch(url);

      if (response.status === 404) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'gem',
          exists: false,
          lastChecked: new Date()
        };

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`);
      }

      const data = await response.json() as any;

      const result: PackageInfo = {
        name: packageName,
        version: version || data.version,
        registry: 'gem',
        exists: true,
        latestVersion: data.version,
        deprecated: data.yanked || false,
        lastChecked: new Date()
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error(`Failed to validate Ruby gem ${packageName}:`, error);

      return {
        name: packageName,
        version,
        registry: 'gem',
        exists: false,
        warning: 'Could not verify gem existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      const response = await fetch(
        `${this.registryUrl}/search.json?query=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as any;

      return data.slice(0, limit).map((gem: any) => ({
        name: gem.name,
        version: gem.version,
        registry: 'gem' as const,
        exists: true,
        latestVersion: gem.version,
        lastChecked: new Date()
      }));

    } catch (error) {
      console.error(`Failed to search RubyGems for ${query}:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}