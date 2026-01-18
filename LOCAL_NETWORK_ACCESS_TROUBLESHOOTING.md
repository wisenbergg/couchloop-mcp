# Local Network Access Troubleshooting Guide

## Issue: Chrome Blocking Access to Local MCP Server

Chrome implements Private Network Access restrictions that block public websites from accessing local network resources (like your MCP server on localhost).

## Common Scenarios & Solutions

### 1. Accessing MCP Server from a Public Website

**Problem**: A website served over HTTPS from the internet trying to access your local MCP server.

**Error**: Mixed content or CORS errors when trying to reach `http://localhost:3000`

**Solutions**:

#### Option A: Use Chrome Flags (Development Only)
```bash
# Launch Chrome with disabled security (NOT for production)
chrome --disable-web-security --user-data-dir=/tmp/chrome-dev
```

#### Option B: Configure Chrome Settings
1. Navigate to `chrome://flags/#block-insecure-private-network-requests`
2. Set to "Disabled"
3. Restart Chrome

#### Option C: Use targetAddressSpace (Chrome 98+)
```javascript
// In your client code
fetch("http://localhost:3000/api/shrink", {
  targetAddressSpace: "local",
  method: "POST",
  // ... rest of your options
});
```

### 2. MCP Server CORS Configuration

Add proper CORS headers to your MCP server:

```typescript
// In src/server/index.ts or your server config
app.use((req, res, next) => {
  // Allow specific origins or use wildcard for development
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});
```

### 3. Using .local Domain (Recommended for Development)

Instead of `localhost`, use a `.local` domain:

1. Edit `/etc/hosts` (Mac/Linux) or `C:\Windows\System32\drivers\etc\hosts` (Windows):
```
127.0.0.1 mcp.local
```

2. Update your environment variables:
```env
SHRINK_CHAT_API_URL=http://mcp.local:3000
```

3. Access via: `http://mcp.local:3000`

### 4. HTTPS with Self-Signed Certificate

Generate a self-signed certificate for local development:

```bash
# Generate certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Update your server to use HTTPS
```

```typescript
import https from 'https';
import fs from 'fs';

const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app);

server.listen(3000, () => {
  console.log('HTTPS Server running on https://localhost:3000');
});
```

### 5. For Production Deployment

**Never expose local services directly to public websites in production.**

Instead:
1. Deploy your MCP server to a cloud provider (Vercel, AWS, etc.)
2. Use proper SSL certificates
3. Implement authentication and rate limiting
4. Use environment-specific configurations

### 6. Testing Local Network Access

Test if your setup works:

```javascript
// Test script
async function testLocalAccess() {
  try {
    const response = await fetch('http://localhost:3000/api/health', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // For Chrome 98+
      targetAddressSpace: 'local'
    });

    if (response.ok) {
      console.log('✅ Local network access working');
    } else {
      console.log('❌ Response not OK:', response.status);
    }
  } catch (error) {
    console.error('❌ Local network access blocked:', error);
  }
}

testLocalAccess();
```

## Common Error Messages & Solutions

### "Mixed Content" Error
- **Cause**: HTTPS site trying to access HTTP localhost
- **Fix**: Use HTTPS for local server or adjust browser settings

### "CORS Policy" Error
- **Cause**: Missing CORS headers
- **Fix**: Add appropriate CORS headers to server

### "ERR_FAILED" or "net::ERR_FAILED"
- **Cause**: Chrome blocking private network access
- **Fix**: Use one of the solutions above

## Environment-Specific Configurations

### Development (.env.local)
```env
SHRINK_CHAT_API_URL=http://localhost:3000
CORS_ORIGIN=*
```

### Staging (.env.staging)
```env
SHRINK_CHAT_API_URL=https://staging-api.yourdomain.com
CORS_ORIGIN=https://staging.yourdomain.com
```

### Production (.env.production)
```env
SHRINK_CHAT_API_URL=https://api.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```

## Quick Checklist

- [ ] Is Chrome blocking local network requests? Check `chrome://flags`
- [ ] Are CORS headers properly configured on the server?
- [ ] Is the client using `targetAddressSpace: 'local'` for fetch requests?
- [ ] For HTTPS sites, is the local server also using HTTPS?
- [ ] Have you tried using a `.local` domain instead of `localhost`?
- [ ] Are you using the correct environment variables for your setup?

## Additional Resources

- [Chrome Private Network Access](https://developer.chrome.com/blog/private-network-access-update)
- [CORS MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Chrome Enterprise Policies](https://chromeenterprise.google/policies/) for managed environments