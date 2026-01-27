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
}