/**
 * Package validation types for developer augmentation features
 */

export interface PackageInfo {
  name: string;
  version?: string;
  registry: 'npm' | 'pypi' | 'maven' | 'cargo' | 'gem' | 'nuget' | 'go';
  exists: boolean;
  latestVersion?: string;
  deprecated?: boolean;
  securityIssues?: SecurityIssue[];
  lastChecked?: Date;
  warning?: string;
}

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  cve?: string;
  fixedIn?: string;
}

export interface PackageValidationResult {
  package: PackageInfo;
  suggestions?: string[];
  warning?: string;
  blocked: boolean;
  reason?: string;
}

export interface RegistryValidator {
  validate(packageName: string, version?: string): Promise<PackageInfo>;
  search(query: string, limit?: number): Promise<PackageInfo[]>;
  clearCache?(): void;
}

// ── Registry API response shapes ──

/** npm registry: GET /:package */
export interface NpmRegistryResponse {
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, { deprecated?: string }>;
  deprecated?: string;
}

/** npm search: GET /-/v1/search */
export interface NpmSearchResponse {
  objects: Array<{
    package: { name: string; version: string };
  }>;
}

/** PyPI: GET /pypi/:package/json */
export interface PyPiRegistryResponse {
  info: { name: string; version: string; yanked?: boolean };
  vulnerabilities?: Array<{
    severity?: string;
    description: string;
    cve?: string;
    fixed_in?: string[];
  }>;
}

/** crates.io: GET /api/v1/crates/:crate */
export interface CargoRegistryResponse {
  crate: { name: string; max_version: string };
}

/** crates.io version detail */
export interface CargoVersionResponse {
  version?: { yanked?: boolean };
}

/** crates.io search */
export interface CargoSearchResponse {
  crates: Array<{ name: string; max_version: string }>;
}

/** NuGet: GET /v3-flatcontainer/:id/index.json */
export interface NuGetIndexResponse {
  versions: string[];
}

/** NuGet search */
export interface NuGetSearchResponse {
  data: Array<{ id: string; version: string }>;
}

/** RubyGems: GET /api/v1/gems/:gem.json */
export interface GemRegistryResponse {
  name: string;
  version: string;
  yanked?: boolean;
}

/** RubyGems search */
export type GemSearchResponse = Array<{ name: string; version: string }>;

/** Maven Central Solr search */
export interface MavenSearchResponse {
  response: {
    docs: Array<{
      g: string;
      a: string;
      v: string;
      latestVersion?: string;
    }>;
  };
}

/** Go proxy @latest endpoint */
export interface GoLatestResponse {
  Version: string;
}