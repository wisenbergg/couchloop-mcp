/**
 * NPM Registry Validator
 * Validates package existence and retrieves metadata from npm registry
 */

import type { PackageInfo, RegistryValidator, NpmRegistryResponse, NpmSearchResponse } from '../types/package.js';
import { logger } from '../../utils/logger.js';

export class NpmValidator implements RegistryValidator {
  private readonly registryUrl = 'https://registry.npmjs.org';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    // Check cache first
    const cacheKey = `${packageName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await fetch(`${this.registryUrl}/${packageName}`);

      if (response.status === 404) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'npm',
          exists: false,
          lastChecked: new Date()
        };

        // Cache negative result for shorter time
        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`);
      }

      const data = await response.json() as NpmRegistryResponse;

      // Check if specific version exists
      if (version && !data.versions?.[version]) {
        return {
          name: packageName,
          version,
          registry: 'npm',
          exists: false,
          latestVersion: data['dist-tags']?.latest,
          lastChecked: new Date()
        };
      }

      const result: PackageInfo = {
        name: packageName,
        version: version || data['dist-tags']?.latest,
        registry: 'npm',
        exists: true,
        latestVersion: data['dist-tags']?.latest,
        deprecated: !!(data.deprecated || data.versions?.[version || data['dist-tags']?.latest || '']?.deprecated),
        lastChecked: new Date()
      };

      // Cache positive result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      logger.error(`Failed to validate npm package ${packageName}:`, error);

      // Return unknown state rather than false positive
      return {
        name: packageName,
        version,
        registry: 'npm',
        exists: false, // Safe default - block if we can't verify
        warning: 'Could not verify package existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      const response = await fetch(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as NpmSearchResponse;

      return data.objects.map((obj) => ({
        name: obj.package.name,
        version: obj.package.version,
        registry: 'npm' as const,
        exists: true,
        latestVersion: obj.package.version,
        lastChecked: new Date()
      }));
    } catch (error) {
      logger.error(`Failed to search npm registry for ${query}:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}