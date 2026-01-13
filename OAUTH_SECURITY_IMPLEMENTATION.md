# OAuth Security Implementation Documentation

## 🔒 Security Features Implemented

### Phase 1: Core Security (Complete) ✅

#### 1. PKCE (Proof Key for Code Exchange)
- **File**: `src/server/oauth/pkce.ts`
- **Features**:
  - RFC 7636 compliant implementation
  - S256 challenge method (plain deprecated)
  - Cryptographically secure verifier generation
  - Constant-time comparison to prevent timing attacks
  - Automatic cleanup of expired challenges
  - 10-minute challenge TTL

#### 2. CSRF Protection with State Parameters
- **File**: `src/server/oauth/security.ts`
- **Features**:
  - JWT-based state tokens with tamper protection
  - Cryptographic nonce generation
  - Browser fingerprinting for session validation
  - Automatic state cleanup
  - Redirect URI validation (exact match per OAuth 2.1)
  - Comprehensive authorization request validation

#### 3. Token Encryption at Rest
- **File**: `src/server/oauth/tokenEncryption.ts`
- **Features**:
  - AES-256-GCM encryption for all stored tokens
  - Unique salt and IV per encryption
  - Authentication tags to prevent tampering
  - SHA256 hashing for token indexing
  - Key derivation using scrypt
  - Encryption key validation on startup

#### 4. Refresh Token Rotation
- **File**: `src/server/oauth/refreshTokenRotation.ts`
- **Features**:
  - Automatic token rotation on refresh
  - Token family tracking for lineage
  - Reuse detection with automatic revocation
  - Grace period for legitimate retries (2 seconds)
  - Suspicious rotation pattern detection
  - Maximum rotation count enforcement
  - Security event logging

### Phase 2: Multi-Provider Architecture (Complete) ✅

#### Provider Base Class
- **File**: `src/server/oauth/providers/base.ts`
- **Features**:
  - Abstract base for all OAuth providers
  - OIDC ID token validation
  - JWKS caching (1 hour TTL)
  - Common error handling
  - Provider-agnostic interface

#### Google Provider
- **File**: `src/server/oauth/providers/google.ts`
- **Features**:
  - Full OpenID Connect support
  - G Suite domain restrictions
  - Email verification enforcement
  - Service access checking (Calendar, Drive, Gmail)
  - Refresh token support

#### GitHub Provider
- **File**: `src/server/oauth/providers/github.ts`
- **Features**:
  - OAuth 2.0 implementation (no OIDC)
  - Email address fetching
  - Organization membership verification
  - Repository access checking
  - No refresh token (GitHub limitation)

## 🛡️ Security Architecture

### Token Security Layers

```
┌─────────────────────────────────────┐
│         User Authentication         │
└─────────────┬───────────────────────┘
              │
┌─────────────▼───────────────────────┐
│      PKCE Challenge/Verifier        │
│   (Prevents code interception)      │
└─────────────┬───────────────────────┘
              │
┌─────────────▼───────────────────────┐
│    CSRF Protection (State Token)    │
│  (Prevents cross-site attacks)      │
└─────────────┬───────────────────────┘
              │
┌─────────────▼───────────────────────┐
│      Token Encryption at Rest       │
│     (AES-256-GCM encryption)        │
└─────────────┬───────────────────────┘
              │
┌─────────────▼───────────────────────┐
│     Refresh Token Rotation          │
│   (Prevents token replay attacks)   │
└─────────────────────────────────────┘
```

### Attack Prevention Matrix

| Attack Vector | Protection Mechanism | Implementation |
|--------------|---------------------|----------------|
| Authorization Code Interception | PKCE | ✅ Implemented |
| CSRF | State Parameters + Nonce | ✅ Implemented |
| Token Theft | Encryption at Rest | ✅ Implemented |
| Token Replay | Rotation + Reuse Detection | ✅ Implemented |
| Session Hijacking | Browser Fingerprinting | ✅ Implemented |
| Token Leakage | Short TTL + Revocation | ✅ Implemented |
| Timing Attacks | Constant-time Comparison | ✅ Implemented |
| Open Redirect | Exact URI Matching | ✅ Implemented |

## 📋 Configuration

### Required Environment Variables

```bash
# Core OAuth Configuration
OAUTH_ISSUER=https://auth.couchloop.com
OAUTH_AUDIENCE=https://api.couchloop.com

# Security Keys (Generate with: openssl rand -hex 32)
JWT_SECRET=<64-character-hex-string>
ENCRYPTION_KEY=<64-character-hex-string>
STATE_SECRET=<64-character-hex-string>

# PKCE Settings
PKCE_REQUIRED=true
PKCE_METHOD=S256

# Token Configuration
ACCESS_TOKEN_TTL=900              # 15 minutes
REFRESH_TOKEN_TTL=2592000        # 30 days
REFRESH_TOKEN_ROTATION=true
REFRESH_TOKEN_REUSE_WINDOW=2000  # 2 seconds

# Google OAuth
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://couchloop.com/oauth/callback/google
GOOGLE_ALLOWED_DOMAIN=company.com  # Optional: G Suite restriction

# GitHub OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_REDIRECT_URI=https://couchloop.com/oauth/callback/github

# Security Monitoring
ENABLE_AUDIT_LOGGING=true
ENABLE_SECURITY_ALERTS=true
SECURITY_WEBHOOK_URL=https://alerts.example.com/webhook
```

## 🔍 Security Audit Checklist

### OWASP Compliance
- [x] **Authorization Code Injection** - Mitigated with PKCE
- [x] **Insufficient Redirect URI Validation** - Exact match validation
- [x] **CSRF on Authorization Endpoint** - State parameter required
- [x] **Token Leakage via Referrer** - Short-lived tokens, secure headers
- [x] **Token Replay** - Rotation with reuse detection
- [x] **Insufficient Token Expiration** - 15-minute access tokens
- [x] **Unencrypted Token Storage** - AES-256-GCM encryption

### OAuth 2.1 Compliance
- [x] PKCE required for all clients
- [x] Exact redirect URI matching
- [x] No implicit flow support
- [x] Refresh token rotation
- [x] State parameter mandatory

### Additional Security
- [x] Browser fingerprinting
- [x] Suspicious activity detection
- [x] Security event logging
- [x] Token family tracking
- [x] Automatic revocation on anomalies

## 🚀 Usage Examples

### 1. Initiating OAuth Flow

```typescript
import { pkceManager } from './oauth/pkce';
import { oauthSecurity } from './oauth/security';
import { ProviderFactory } from './oauth/providers';

// Generate PKCE challenge
const verifier = pkceManager.generateVerifier();
const challenge = pkceManager.generateChallenge(verifier, 'S256');

// Generate state token
const state = await oauthSecurity.generateStateToken({
  clientId: 'client123',
  redirectUri: 'https://app.com/callback',
  nonce: oauthSecurity.generateNonce(),
  codeChallenge: challenge,
  codeChallengeMethod: 'S256',
});

// Build authorization URL
const provider = ProviderFactory.create('google', config);
const authUrl = provider.buildAuthorizationUrl({
  state,
  codeChallenge: challenge,
  codeChallengeMethod: 'S256',
});
```

### 2. Handling OAuth Callback

```typescript
// Validate state
const stateData = await oauthSecurity.validateState(state);
if (!stateData) {
  throw new Error('Invalid state - CSRF attack prevented');
}

// Validate PKCE
const isValid = await pkceManager.validatePKCE(
  authCode,
  verifier,
  clientId
);
if (!isValid) {
  throw new Error('PKCE validation failed');
}

// Exchange code for tokens
const tokens = await provider.exchangeCode(authCode, verifier);

// Encrypt and store tokens
const encrypted = await tokenEncryption.encryptToken(tokens.refresh_token);
```

### 3. Token Refresh with Rotation

```typescript
import { refreshTokenManager } from './oauth/refreshTokenRotation';

// Rotate refresh token
const newTokens = await refreshTokenManager.rotateRefreshToken(
  oldRefreshToken,
  {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    deviceId: req.cookies.deviceId,
  }
);

// Old token is automatically revoked
// New tokens are returned
```

## 📊 Monitoring & Alerts

### Security Events to Monitor

1. **Token Reuse Detection**
   - Alert: Immediate
   - Action: Revoke token family
   - Log: User ID, IP, timestamp

2. **Suspicious Rotation Patterns**
   - Alert: Warning
   - Indicators: Rapid rotation, IP change, device change
   - Action: Additional verification

3. **PKCE Validation Failures**
   - Alert: Warning
   - Action: Block authorization
   - Log: Client ID, timestamp

4. **State Token Tampering**
   - Alert: Critical
   - Action: Block request, investigate
   - Log: Full request details

## 🔄 Next Steps

### Remaining Security Enhancements

1. **DPoP (Demonstration of Proof of Possession)**
   - Sender-constrained tokens
   - Prevents token theft

2. **WebAuthn/Passkeys**
   - Passwordless authentication
   - Phishing-resistant

3. **Anomaly Detection**
   - Machine learning-based detection
   - Behavioral analysis

4. **Rate Limiting**
   - Per-endpoint limits
   - Exponential backoff

5. **Security Headers**
   - HSTS, CSP, X-Frame-Options
   - Referrer-Policy

## 🧪 Testing

### Security Test Coverage

```bash
# Run security tests
npm test -- --grep security

# Run penetration tests
npm run test:pentest

# Validate OWASP compliance
npm run test:owasp

# Check OAuth 2.1 compliance
npm run test:oauth21
```

### Manual Security Testing

1. **PKCE Bypass Attempt**
   - Try exchanging code without verifier
   - Expected: Request rejected

2. **Token Replay Attack**
   - Reuse old refresh token
   - Expected: Token family revoked

3. **CSRF Attack**
   - Modify or remove state parameter
   - Expected: Request blocked

4. **Token Leakage**
   - Check if tokens appear in logs/URLs
   - Expected: Only hashes visible

## 📚 References

- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-07)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [OWASP OAuth Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)