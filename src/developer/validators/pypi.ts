/**
 * PyPI Registry Validator
 * Validates Python package existence from PyPI registry
 */

import type { PackageInfo, RegistryValidator, PyPiRegistryResponse, SecurityIssue } from '../types/package.js';

export class PyPiValidator implements RegistryValidator {
  private readonly registryUrl = 'https://pypi.org/pypi';
  private cache = new Map<string, { data: PackageInfo; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async validate(packageName: string, version?: string): Promise<PackageInfo> {
    // Normalize package name (PyPI uses hyphens, but allows underscores)
    const normalizedName = packageName.toLowerCase().replace(/_/g, '-');
    const cacheKey = `${normalizedName}${version ? `@${version}` : ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const url = version
        ? `${this.registryUrl}/${normalizedName}/${version}/json`
        : `${this.registryUrl}/${normalizedName}/json`;

      const response = await fetch(url);

      if (response.status === 404) {
        const result: PackageInfo = {
          name: packageName,
          version,
          registry: 'pypi',
          exists: false,
          lastChecked: new Date()
        };

        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`);
      }

      const data = await response.json() as PyPiRegistryResponse;

      const result: PackageInfo = {
        name: packageName,
        version: version || data.info.version,
        registry: 'pypi',
        exists: true,
        latestVersion: data.info.version,
        deprecated: data.info.yanked || false,
        lastChecked: new Date()
      };

      // Check for vulnerabilities if available
      if (data.vulnerabilities?.length) {
        result.securityIssues = data.vulnerabilities.map((vuln) => ({
          severity: (vuln.severity || 'medium') as SecurityIssue['severity'],
          description: vuln.description,
          cve: vuln.cve,
          fixedIn: vuln.fixed_in?.[0]
        }));
      }

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error(`Failed to validate PyPI package ${packageName}:`, error);

      return {
        name: packageName,
        version,
        registry: 'pypi',
        exists: false,
        warning: 'Could not verify package existence',
        lastChecked: new Date()
      } as PackageInfo;
    }
  }

  async search(query: string, limit = 10): Promise<PackageInfo[]> {
    try {
      // PyPI doesn't have a great search API, but we can try exact matches
      // and common variations
      const variations = [
        query,
        query.replace(/_/g, '-'),
        query.replace(/-/g, '_'),
        query.toLowerCase(),
        query.toLowerCase().replace(/_/g, '-'),
      ];

      const results: PackageInfo[] = [];
      const seen = new Set<string>();

      for (const variant of variations) {
        if (results.length >= limit) break;

        try {
          const response = await fetch(`${this.registryUrl}/${variant}/json`);
          if (response.ok) {
            const data = await response.json() as PyPiRegistryResponse;
            if (!seen.has(data.info.name)) {
              seen.add(data.info.name);
              results.push({
                name: data.info.name,
                version: data.info.version,
                registry: 'pypi' as const,
                exists: true,
                latestVersion: data.info.version,
                lastChecked: new Date()
              });
            }
          }
        } catch {
          // Ignore individual failures
        }
      }

      return results.slice(0, limit);

    } catch (error) {
      console.error(`Failed to search PyPI registry:`, error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}