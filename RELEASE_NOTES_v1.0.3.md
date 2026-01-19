# Release Notes - v1.0.3

## 🚀 What's New

### 🐛 Critical Bug Fix
- **Fixed JSON Schema validation error in `save_checkpoint` tool**
  - The `value` parameter was missing a required `type` field
  - Now properly accepts any JSON value (string, number, object, array, etc.)
  - Resolves ChatGPT integration errors when saving checkpoints

### 🔄 Environment Updates
- **Switched to production shrink-chat API**
  - Updated from staging URL (`https://staging.couchloopchat.com`)
  - Now using production URL (`https://couchloopchat.com`)
  - Ensures stable, production-ready therapeutic AI responses

### ⚡ Performance Optimizations (from v1.0.2)
- **Database connection pooling improvements**
  - Increased max connections from 10 to 25 for better concurrency
  - Extended idle timeout from 20s to 60s to keep connections warm
  - Disabled prepared statements for better connection reuse

- **Caching enhancements**
  - Implemented journey definition caching (5-minute TTL)
  - Added session data caching to reduce database queries
  - Reduced redundant database lookups

- **Parallel query optimization**
  - Converted sequential queries to parallel execution where possible
  - Improved response times for multi-resource requests

## 📦 Installation

```bash
# For new installations
npm install couchloop-eq-mcp@1.0.3

# For updates from previous versions
npm update couchloop-eq-mcp
```

## 🔧 Configuration Updates

If deploying to Railway or other platforms, update your environment variables:

```env
SHRINK_CHAT_API_URL=https://couchloopchat.com
```

## 💡 Migration Notes

No database migrations required for this update. The changes are backward compatible with existing sessions and checkpoints.

## 🧪 Testing

The following have been verified:
- ✅ JSON Schema validation for all MCP tools
- ✅ Production shrink-chat API connectivity
- ✅ Session creation and checkpoint saving
- ✅ Performance improvements under load

## 📝 Technical Details

### Files Modified
- `src/tools/index.ts` - Fixed JSON Schema for save_checkpoint tool
- `.env.local` - Updated to production shrink-chat URL
- `.env.production` - Confirmed production configuration
- `package.json` - Version bump to 1.0.3

### JSON Schema Fix Example
```typescript
// Before (invalid):
value: {
  description: 'The captured content...',
}

// After (valid):
value: {
  type: 'object',
  additionalProperties: true,
  description: 'The captured content...',
}
```

## 🙏 Credits

This release addresses critical issues reported by the community and ensures stable production operation of the CouchLoop MCP server.