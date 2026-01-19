# Deployment Update Guide - v1.0.3

## 🎉 Release Successfully Published!

Version 1.0.3 is now live on npm: https://www.npmjs.com/package/couchloop-eq-mcp

Published: January 19, 2026 at 13:37 UTC

## ✅ What Was Accomplished

1. **Fixed Critical JSON Schema Bug**
   - `save_checkpoint` tool now properly validates with ChatGPT
   - Accepts any JSON value type (string, number, object, array)

2. **Updated to Production shrink-chat**
   - Switched from staging URL to https://couchloopchat.com
   - Ensures stable production responses

3. **Fixed TypeScript Build Error**
   - Resolved postgres client configuration issue
   - Build now completes successfully

4. **Published to npm Registry**
   - Version 1.0.3 available for installation
   - Git tag created and pushed

## 🚀 Railway Deployment Update

### Step 1: Update Environment Variables

In your Railway dashboard:

1. Navigate to your couchloop-eq-mcp service
2. Go to Variables tab
3. Update or add:
   ```
   SHRINK_CHAT_API_URL=https://couchloopchat.com
   ```

### Step 2: Trigger Redeploy

Option A - Automatic (if configured):
- Railway will detect the new npm package and redeploy

Option B - Manual:
1. Go to Deployments tab
2. Click "Redeploy" on the latest deployment
3. Or trigger from Settings → Manual Deploy

### Step 3: Verify Deployment

After deployment completes:
1. Check logs for successful startup
2. Test with ChatGPT to verify:
   - Sessions can be created
   - Checkpoints save without errors
   - Messages route to production shrink-chat

## 📦 For Local Development

Update your local installation:
```bash
npm update couchloop-eq-mcp
# or
npm install couchloop-eq-mcp@1.0.3
```

## 🔗 Important Links

- npm Package: https://www.npmjs.com/package/couchloop-eq-mcp
- GitHub Release: https://github.com/wisenbergg/couchloop-mcp/releases/tag/v1.0.3
- Production shrink-chat: https://couchloopchat.com

## ✨ Next Steps

1. ✅ npm package published (v1.0.3)
2. ✅ Git tag created and pushed
3. ⏳ Update Railway environment variables
4. ⏳ Verify ChatGPT integration works with new version
5. ⏳ Monitor for any issues in production logs

## 🐛 Troubleshooting

If you encounter issues after deployment:

1. **Check Railway logs** for startup errors
2. **Verify environment variables** are set correctly
3. **Test shrink-chat connectivity** with the test script
4. **Ensure database connection** is working

For support, create an issue at:
https://github.com/wisenbergg/couchloop-mcp/issues