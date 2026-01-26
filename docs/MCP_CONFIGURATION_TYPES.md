# MCP Server Configuration Types

This guide explains the different ways to configure MCP servers for Claude Desktop and other MCP clients.

---

## 1. Local (Shell Script or Direct Node)

Runs from source code on your local machine.

### Using Shell Script

```json
{
  "couchloop-eq-mcp": {
    "command": "/Users/hipdev/dev/mcp/run-mcp-server.sh",
    "args": []
  }
}
```

### Using Direct Node

```json
{
  "couchloop-eq-mcp": {
    "command": "node",
    "args": ["/Users/hipdev/dev/mcp/dist/index.js"],
    "env": {
      "MCP_MODE": "true"
    }
  }
}
```

| Pros | Cons |
|------|------|
| Full control over code | Must build locally (`npm run build`) |
| Easy to debug/modify | Tied to your file system path |
| Works offline | Not portable to other machines |

---

## 2. NPM (Published Package)

Installs and runs from npm registry using `npx`.

```json
{
  "couchloop-eq-mcp": {
    "command": "npx",
    "args": ["-y", "couchloop-eq-mcp"],
    "env": {
      "DATABASE_URL": "your-connection-string"
    }
  }
}
```

| Pros | Cons |
|------|------|
| No local setup required | Must publish to npm first |
| Auto-downloads latest version | Requires internet to install |
| Portable - works on any machine | Less control over exact version |
| Clean - no source files needed | |

> **Note:** The `-y` flag auto-confirms the install prompt.

---

## 3. Remote (HTTP/SSE Transport)

Connects to a server running elsewhere (cloud, another machine).

### Basic Remote

```json
{
  "couchloop-eq-mcp": {
    "url": "https://your-server.com/mcp",
    "transport": "sse"
  }
}
```

### With Authentication

```json
{
  "couchloop-eq-mcp": {
    "url": "https://mcp.couchloop.com/sse",
    "transport": "sse",
    "headers": {
      "Authorization": "Bearer your-api-key"
    }
  }
}
```

| Pros | Cons |
|------|------|
| No local installation | Requires server hosting |
| Shared across teams | Network latency |
| Centralized updates | Internet dependency |
| Can use OAuth/API keys | More complex infrastructure |

---

## Summary Comparison

| Type | Command | Use Case |
|------|---------|----------|
| **Local** | `node` or shell script | Development, debugging |
| **NPM** | `npx` | Distribution to users |
| **Remote** | `url` (SSE/HTTP) | SaaS, team sharing, OAuth flows |

---

## Couchloop EQ MCP Configuration

### Server Details

| Field | Value |
|-------|-------|
| **Server Name** | `couchloop-eq-mcp` |
| **Package Name** | `couchloop-eq-mcp` |
| **Version** | `1.1.0` |

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string for session storage | Yes |
| `MCP_MODE` | Set to `true` (auto-set by run script) | No |

---

## Recommended Configuration by Use Case

### For Personal Development

Use **Local** configuration:

```json
{
  "couchloop-eq-mcp": {
    "command": "/Users/hipdev/dev/mcp/run-mcp-server.sh",
    "args": []
  }
}
```

### For Sharing with Others

Use **NPM** configuration:

```json
{
  "couchloop-eq-mcp": {
    "command": "npx",
    "args": ["-y", "couchloop-eq-mcp"],
    "env": {
      "DATABASE_URL": "postgresql://..."
    }
  }
}
```

### For SaaS/Enterprise

Use **Remote** configuration with OAuth:

```json
{
  "couchloop-eq-mcp": {
    "url": "https://mcp.couchloop.com/sse",
    "transport": "sse"
  }
}
```
