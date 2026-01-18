# Quick Fix for Chrome Local Network Access Issues

## Problem
Chrome blocks requests from public websites to your local MCP server with errors like:
- "Access to fetch at 'http://localhost:3000' from origin 'https://...' has been blocked by CORS policy"
- "Private Network Access check failed"

## Solution

### 1. Add the Local Network Access Middleware

The middleware is already created at: `src/server/middleware/localNetworkAccess.ts`

### 2. Update Your Server

In `src/server/index.ts`, add at the top with other imports:
```typescript
import { localNetworkAccessMiddleware, enhancedCors } from './middleware/localNetworkAccess.js';
```

Replace the current `oauthCors` line with:
```typescript
// Use enhanced CORS with Local Network Access support
app.use(enhancedCors);
app.use(localNetworkAccessMiddleware);
```

### 3. Environment Variables

Add to your `.env.local`:
```env
NODE_ENV=development
ALLOWED_ORIGINS=https://chat.openai.com,https://claude.ai,http://localhost:3000
```

### 4. Test the Fix

Test script to verify it works:
```html
<!-- test-local-access.html -->
<!DOCTYPE html>
<html>
<head><title>Local Network Access Test</title></head>
<body>
  <h1>Testing Local Network Access</h1>
  <button onclick="testAccess()">Test Access</button>
  <pre id="result"></pre>

  <script>
    async function testAccess() {
      const resultEl = document.getElementById('result');
      try {
        const response = await fetch('http://localhost:3000/api/health', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (response.ok) {
          resultEl.textContent = '✅ Success! Local network access is working.';
          const data = await response.json();
          resultEl.textContent += '\n\nResponse: ' + JSON.stringify(data, null, 2);
        } else {
          resultEl.textContent = '❌ Request failed with status: ' + response.status;
        }
      } catch (error) {
        resultEl.textContent = '❌ Error: ' + error.message;
        console.error('Full error:', error);
      }
    }
  </script>
</body>
</html>
```

### 5. Chrome Flags (If Still Blocked)

If you still get errors, temporarily disable the restriction:

1. Go to: `chrome://flags/#block-insecure-private-network-requests`
2. Set to "Disabled"
3. Restart Chrome

**Note**: This is for development only. Never ask users to disable security features.

## Key Headers Being Set

The middleware adds these critical headers:
- `Access-Control-Allow-Private-Network: true` - Allows private network access
- `Access-Control-Allow-Origin` - Dynamically set based on request origin
- Standard CORS headers for methods, headers, and credentials

## Production Deployment

For production, don't expose local services. Instead:
1. Deploy to a cloud provider (Vercel, AWS, etc.)
2. Use proper SSL certificates
3. Configure `ALLOWED_ORIGINS` with your production domains

## Verification

After implementing, you should see in server logs:
```
[Local Network Access] Handling private network preflight request
[CORS] Development request from: https://your-site.com
```

And Chrome DevTools Network tab should show:
- Preflight OPTIONS request with status 204
- Response header: `Access-Control-Allow-Private-Network: true`