/**
 * Cargo Registry Validator (crates.io)
 * Validates Rust package existence from crates.io registry
 */

import type { PackageInfo, RegistryValidator } from '../types/package.js';

export class CargoValidator implements RegistryValidator {
  private readonly registryUrl = 'https://crates.io/api/v1';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    // Cargo/Rust crate names use underscores or hyphens
    // crates.io treats them as equivalent
    const normalizedName = packageName.toLowerCase().replace(/-/g, '_');
    const cacheKey = `${normalizedName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // crates.io API endpoint for crate info
      const response = await fetch(`${this.registryUrl}/crates/${packageName}`, {
        headers: {
          'User-Agent': 'CouchLoop-MCP/1.0 (https://github.com/wisenbergg/couchloop-mcp)'
        }
      });

      if (response.status === 404) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'cargo',
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
      const crate = data.crate;

      // Check if specific version exists
      if (version) {
        // Fetch version-specific info
        const versionResponse = await fetch(
          `${this.registryUrl}/crates/${packageName}/${version}`,
          {
            headers: {
              'User-Agent': 'CouchLoop-MCP/1.0'
            }
          }
        );

        if (versionResponse.status === 404) {
          return {
            name: packageName,
            version,
            registry: 'cargo',
            exists: false,
            latestVersion: crate.max_version,
            lastChecked: new Date()
          };
        }

        if (!versionResponse.ok) {
          throw new Error(`Version check returned ${versionResponse.status}`);
        }

        const versionData = await versionResponse.json() as any;

        const result: PackageInfo = {
          name: packageName,
          version: version,
          registry: 'cargo',
          exists: true,
          latestVersion: crate.max_version,
          deprecated: versionData.version?.yanked || false,
          lastChecked: new Date()
        };

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      // Return latest version info
      const result: PackageInfo = {
        name: packageName,
        version: crate.max_version,
        registry: 'cargo',
        exists: true,
        latestVersion: crate.max_version,
        deprecated: false,
        lastChecked: new Date()
      };

      // Check for security advisories if available
      // Note: crates.io doesn't directly provide this, but RustSec advisory DB could be integrated

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error(`Failed to validate Cargo package ${packageName}:`, error);

      return {
        name: packageName,
        version,
        registry: 'cargo',
        exists: false,
        warning: 'Could not verify package existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      // crates.io search API
      const response = await fetch(
        `${this.registryUrl}/crates?q=${encodeURIComponent(query)}&per_page=${limit}`,
        {
          headers: {
            'User-Agent': 'CouchLoop-MCP/1.0'
          }
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as any;

      return data.crates.map((crate: any) => ({
        name: crate.name,
        version: crate.max_version,
        registry: 'cargo' as const,
        exists: true,
        latestVersion: crate.max_version,
        lastChecked: new Date()
      }));

    } catch (error) {
      console.error(`Failed to search Cargo registry for ${query}:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}