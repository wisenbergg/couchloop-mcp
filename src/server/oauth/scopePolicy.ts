const SCOPE_TOKEN = /^[A-Za-z0-9:._-]+$/;

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function splitScopeString(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sanitizeScopeTokens(tokens: string[]): string[] {
  return uniquePreserveOrder(tokens.filter((token) => SCOPE_TOKEN.test(token)));
}

export function normalizeAllowedScopes(rawScopes: unknown): string[] {
  if (!Array.isArray(rawScopes)) {
    return [];
  }

  const flattened = rawScopes
    .filter((item): item is string => typeof item === "string")
    .flatMap((item) => splitScopeString(item));

  return sanitizeScopeTokens(flattened);
}

export interface ScopeResolution {
  granted: string[];
  grantedScope: string;
  invalidRequested: string[];
  hasMalformedRequested: boolean;
}

export function resolveGrantedScope(
  requestedScope: string | undefined,
  allowedScopesRaw: unknown,
  defaults: string[] = ["read", "write"],
): ScopeResolution {
  const sanitizedDefaults = sanitizeScopeTokens(defaults);
  const allowedScopes = normalizeAllowedScopes(allowedScopesRaw);
  const effectiveAllowed =
    allowedScopes.length > 0 ? allowedScopes : sanitizedDefaults;
  const allowedSet = new Set(effectiveAllowed);

  const rawRequestedTokens = requestedScope
    ? splitScopeString(requestedScope)
    : [];
  const requestedTokens = sanitizeScopeTokens(rawRequestedTokens);
  const hasMalformedRequested =
    rawRequestedTokens.length !== requestedTokens.length;

  const invalidRequested = requestedTokens.filter((scope) => !allowedSet.has(scope));

  const candidateRequested = requestedTokens.length
    ? requestedTokens
    : sanitizedDefaults.filter((scope) => allowedSet.has(scope));

  const granted = candidateRequested.length
    ? candidateRequested.filter((scope) => allowedSet.has(scope))
    : effectiveAllowed;

  return {
    granted,
    grantedScope: granted.join(" "),
    invalidRequested,
    hasMalformedRequested,
  };
}
