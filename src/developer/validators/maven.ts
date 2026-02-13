/**
 * Maven Central Repository Validator
 * Validates Java package existence from Maven Central
 */

import type { PackageInfo, RegistryValidator, MavenSearchResponse } from '../types/package.js';
import { logger } from '../../utils/logger.js';

export class MavenValidator implements RegistryValidator {
  private readonly registryUrl = 'https://search.maven.org/solrsearch/select';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    // Maven packages are in format groupId:artifactId
    // e.g., "org.springframework:spring-core"
    const parts = packageName.split(':');

    if (parts.length !== 2) {
      return {
        name: packageName,
        version,
        registry: 'maven',
        exists: false,
        warning: 'Invalid Maven package format. Use groupId:artifactId',
        lastChecked: new Date()
      } as PackageInfo;
    }

    const [groupId, artifactId] = parts;
    const cacheKey = `${packageName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Build query
      const query = version
        ? `g:"${groupId}" AND a:"${artifactId}" AND v:"${version}"`
        : `g:"${groupId}" AND a:"${artifactId}"`;

      const response = await fetch(
        `${this.registryUrl}?q=${encodeURIComponent(query)}&rows=1&wt=json`
      );

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`);
      }

      const data = await response.json() as MavenSearchResponse;

      if (!data.response?.docs?.length) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'maven',
          exists: false,
          lastChecked: new Date()
        };

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      const doc = data.response.docs[0];

      if (!doc) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'maven',
          exists: false,
          lastChecked: new Date()
        };
        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      const result: PackageInfo = {
        name: packageName,
        version: version || doc.latestVersion || doc.v,
        registry: 'maven',
        exists: true,
        latestVersion: doc.latestVersion || doc.v,
        lastChecked: new Date()
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      logger.error(`Failed to validate Maven package ${packageName}:`, error);

      return {
        name: packageName,
        version,
        registry: 'maven',
        exists: false,
        warning: 'Could not verify package existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      const response = await fetch(
        `${this.registryUrl}?q=${encodeURIComponent(query)}&rows=${limit}&wt=json`
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as MavenSearchResponse;

      return data.response.docs.map((doc) => ({
        name: `${doc.g}:${doc.a}`,
        version: doc.v,
        registry: 'maven' as const,
        exists: true,
        latestVersion: doc.latestVersion || doc.v,
        lastChecked: new Date()
      }));

    } catch (error) {
      logger.error(`Failed to search Maven registry for ${query}:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}