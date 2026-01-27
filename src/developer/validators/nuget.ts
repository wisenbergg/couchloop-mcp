/**
 * NuGet Registry Validator
 * Validates .NET/C# package existence from nuget.org
 */

import type { PackageInfo, RegistryValidator } from '../types/package.js';

export class NuGetValidator implements RegistryValidator {
  private readonly registryUrl = 'https://api.nuget.org/v3-flatcontainer';
  private readonly searchUrl = 'https://api-v2v3search-0.nuget.org/query';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    const normalizedName = packageName.toLowerCase();
    const cacheKey = `${normalizedName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // NuGet uses a specific URL structure
      const indexUrl = `${this.registryUrl}/${normalizedName}/index.json`;
      const response = await fetch(indexUrl);

      if (response.status === 404) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'nuget',
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
      const versions = data.versions || [];

      if (versions.length === 0) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'nuget',
          exists: false,
          lastChecked: new Date()
        };

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      // Check if specific version exists
      if (version && !versions.includes(version)) {
        return {
          name: packageName,
          version,
          registry: 'nuget',
          exists: false,
          latestVersion: versions[versions.length - 1],
          lastChecked: new Date()
        };
      }

      const result: PackageInfo = {
        name: packageName,
        version: version || versions[versions.length - 1],
        registry: 'nuget',
        exists: true,
        latestVersion: versions[versions.length - 1],
        lastChecked: new Date()
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error(`Failed to validate NuGet package ${packageName}:`, error);

      return {
        name: packageName,
        version,
        registry: 'nuget',
        exists: false,
        warning: 'Could not verify package existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      const response = await fetch(
        `${this.searchUrl}?q=${encodeURIComponent(query)}&take=${limit}`
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as any;

      return (data.data || []).map((pkg: any) => ({
        name: pkg.id,
        version: pkg.version,
        registry: 'nuget' as const,
        exists: true,
        latestVersion: pkg.version,
        lastChecked: new Date()
      }));

    } catch (error) {
      console.error(`Failed to search NuGet for ${query}:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}