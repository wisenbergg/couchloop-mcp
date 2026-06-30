import { createRequire } from 'node:module';

// Read the version from package.json at runtime so all transports share ONE
// source of truth and can never drift. createRequire resolves relative to this
// module, so `../package.json` points at the project root in both src/ (dev via
// tsx) and dist/ (built). This avoids a tsconfig rootDir violation that a static
// `import ... from '../package.json'` would cause.
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

/**
 * Stable machine identifier. Clients may key tool namespaces off this — keep it
 * constant across releases. Per the MCP spec this is the programmatic `name`.
 */
export const SERVER_NAME = 'couchloop-mcp';

/**
 * Human-readable display name shown by MCP clients (the spec's `title`, which
 * clients prefer over `name` for display). Without it, clients fall back to the
 * machine name or the connector UUID.
 */
export const SERVER_TITLE = 'CouchLoop EQ';

/** Single source of truth for the server version. */
export const SERVER_VERSION: string = pkg.version;

/**
 * The Implementation / `serverInfo` object advertised in the MCP initialize
 * handshake. Used by every transport (stdio, SSE, HTTP) so identity is uniform.
 */
export const SERVER_INFO = {
  name: SERVER_NAME,
  title: SERVER_TITLE,
  version: SERVER_VERSION,
} as const;
