#!/bin/bash

# Publish script for couchloop-eq-mcp v1.0.3
# This script helps publish the JSON Schema fix and production shrink-chat update

echo "===== Publishing couchloop-eq-mcp v1.0.3 ====="
echo ""
echo "Version 1.0.3 includes:"
echo "✅ Fixed JSON Schema bug in save_checkpoint tool"
echo "✅ Updated to production shrink-chat API"
echo "✅ Performance optimizations (connection pooling, caching)"
echo ""

# Check if already logged in
npm whoami &>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️  You need to authenticate to npm first"
    echo ""
    echo "Run one of these commands:"
    echo "  npm login         # Interactive login"
    echo "  npm set //registry.npmjs.org/:_authToken=YOUR_TOKEN  # Using token"
    echo ""
    echo "To get a new token:"
    echo "1. Go to https://www.npmjs.com/settings/wisenbergg/tokens"
    echo "2. Click 'Generate New Token'"
    echo "3. Choose 'Publish' scope"
    echo "4. Copy the token and use the command above"
    echo ""
    exit 1
fi

LOGGED_IN_USER=$(npm whoami)
echo "✅ Logged in as: $LOGGED_IN_USER"
echo ""

# Verify build exists
if [ ! -d "dist" ]; then
    echo "❌ dist/ folder not found. Running build..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ Build failed"
        exit 1
    fi
fi

# Verify package.json version
CURRENT_VERSION=$(node -p "require('./package.json').version")
if [ "$CURRENT_VERSION" != "1.0.3" ]; then
    echo "❌ Version mismatch. Expected 1.0.3, found $CURRENT_VERSION"
    exit 1
fi

echo "📦 Publishing version $CURRENT_VERSION..."
echo ""

# Publish with public access (required for scoped packages if applicable)
npm publish --access public

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Successfully published couchloop-eq-mcp@1.0.3!"
    echo ""
    echo "Next steps:"
    echo "1. Verify on npm: https://www.npmjs.com/package/couchloop-eq-mcp"
    echo "2. Update Railway environment to use production shrink-chat"
    echo "3. Test ChatGPT integration with new version"
    echo ""
    echo "Users can now update with:"
    echo "  npm update couchloop-eq-mcp"
    echo "  # or"
    echo "  npm install couchloop-eq-mcp@1.0.3"
else
    echo ""
    echo "❌ Publish failed. Check the error above."
    echo "Common issues:"
    echo "- Token expired: Generate a new one at npmjs.com"
    echo "- Permission denied: Check if you have publish rights"
    echo "- Version conflict: Make sure 1.0.3 doesn't already exist"
fi