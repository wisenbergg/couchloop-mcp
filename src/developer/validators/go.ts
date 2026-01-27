/**
 * Go Module Registry Validator
 * Validates Go packages from pkg.go.dev
 */

import type { PackageInfo, RegistryValidator } from '../types/package.js';

export class GoValidator implements RegistryValidator {
  private readonly proxyUrl = 'https://proxy.golang.org';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    const cacheKey = `${packageName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Go modules use the proxy.golang.org service
      // Format: https://proxy.golang.org/{module}/@v/list for versions
      const versionListUrl = `${this.proxyUrl}/${packageName}/@v/list`;
      const response = await fetch(versionListUrl);

      if (response.status === 404 || response.status === 410) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'go',
          exists: false,
          lastChecked: new Date()
        };

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`);
      }

      const versionList = await response.text();
      const versions = versionList.trim().split('\n').filter(v => v);

      if (versions.length === 0) {
        // Try to get latest version
        const latestUrl = `${this.proxyUrl}/${packageName}/@latest`;
        const latestResponse = await fetch(latestUrl);

        if (latestResponse.status === 404) {
          const result: PackageInfo = {
            name: packageName,
            version,
            registry: 'go',
            exists: false,
            lastChecked: new Date()
          };

          this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
          return result;
        }

        if (latestResponse.ok) {
          const latestData = await latestResponse.json() as any;
          const result: PackageInfo = {
            name: packageName,
            version: version || latestData.Version,
            registry: 'go',
            exists: true,
            latestVersion: latestData.Version,
            lastChecked: new Date()
          };

          this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
          return result;
        }
      }

      // Check if specific version exists
      if (version && !versions.includes(version)) {
        return {
          name: packageName,
          version,
          registry: 'go',
          exists: false,
          latestVersion: versions[versions.length - 1],
          lastChecked: new Date()
        };
      }

      const result: PackageInfo = {
        name: packageName,
        version: version || versions[versions.length - 1],
        registry: 'go',
        exists: true,
        latestVersion: versions[versions.length - 1],
        lastChecked: new Date()
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error(`Failed to validate Go module ${packageName}:`, error);

      return {
        name: packageName,
        version,
        registry: 'go',
        exists: false,
        warning: 'Could not verify module existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      // pkg.go.dev doesn't have a public search API
      // We can only validate exact package names
      // For search, we'll try common patterns
      const commonPrefixes = [
        'github.com/',
        'golang.org/x/',
        'google.golang.org/',
        'gopkg.in/'
      ];

      const results: PackageInfo[] = [];

      for (const prefix of commonPrefixes) {
        if (results.length >= limit) break;

        const fullName = prefix + query;
        const info = await this.validate(fullName);

        if (info.exists) {
          results.push(info);
        }
      }

      // Also try the query as-is
      if (results.length < limit) {
        const directInfo = await this.validate(query);
        if (directInfo.exists) {
          results.push(directInfo);
        }
      }

      return results.slice(0, limit);

    } catch (error) {
      console.error(`Failed to search Go modules for ${query}:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}