import { createHash, generateKeyPairSync, sign, verify, KeyObject } from 'crypto';
import { SignJWT, jwtVerify, importJWK, JWK, exportJWK } from 'jose';
import { logger } from '../../utils/logger.js';

/**
 * DPoP Proof structure according to RFC draft
 */
export interface DPoPProof {
  typ: 'dpop+jwt';
  alg: 'RS256' | 'ES256';
  jwk: JWK;
}

/**
 * DPoP Proof payload
 */
export interface DPoPPayload {
  jti: string;      // Unique identifier for this proof
  htm: string;      // HTTP method
  htu: string;      // HTTP target URI
  iat: number;      // Issued at
  ath?: string;     // Access token hash (when binding to access token)
  nonce?: string;   // Server-provided nonce (optional)
}

/**
 * DPoP Token binding
 */
export interface DPoPBinding {
  jkt: string;      // JWK thumbprint of the DPoP key
  cnf?: {           // Confirmation claim
    jkt: string;
  };
}

/**
 * DPoP Manager for Demonstration of Proof of Possession
 * Implements sender-constrained tokens to prevent token theft
 * Based on OAuth 2.0 DPoP draft specification
 */
export class DPoPManager {
  private readonly jtiCache = new Map<string, number>();
  private readonly nonceCache = new Map<string, number>();
  private readonly JTI_TTL = 3600000; // 1 hour
  private readonly NONCE_TTL = 600000; // 10 minutes
  private readonly MAX_TIME_SKEW = 300; // 5 minutes in seconds

  /**
   * Generate a DPoP key pair for client
   */
  generateKeyPair(algorithm: 'RS256' | 'ES256' = 'ES256'): {
    publicKey: KeyObject;
    privateKey: KeyObject;
    jwk: JWK;
  } {
    let keyPair;

    if (algorithm === 'RS256') {
      keyPair = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
    } else {
      keyPair = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
    }

    const publicKey = keyPair.publicKey as unknown as KeyObject;
    const privateKey = keyPair.privateKey as unknown as KeyObject;

    logger.info(`Generated DPoP ${algorithm} key pair`);

    return {
      publicKey,
      privateKey,
      jwk: {} as JWK // Would need to convert to JWK format
    };
  }

  /**
   * Create a DPoP proof JWT
   */
  async createDPoPProof(
    privateKey: KeyObject,
    httpMethod: string,
    httpUri: string,
    options?: {
      accessToken?: string;
      nonce?: string;
      algorithm?: 'RS256' | 'ES256';
    }
  ): Promise<string> {
    const algorithm = options?.algorithm || 'ES256';
    const jti = this.generateJti();
    const now = Math.floor(Date.now() / 1000);

    // Create JWK from public key
    const jwk = await exportJWK(privateKey);

    const payload: DPoPPayload = {
      jti,
      htm: httpMethod.toUpperCase(),
      htu: this.normalizeUri(httpUri),
      iat: now,
    };

    // Add access token hash if provided
    if (options?.accessToken) {
      payload.ath = await this.hashToken(options.accessToken);
    }

    // Add nonce if provided
    if (options?.nonce) {
      payload.nonce = options.nonce;
    }

    // Create the proof JWT
    const proof = await new SignJWT(payload)
      .setProtectedHeader({
        typ: 'dpop+jwt',
        alg: algorithm,
        jwk,
      })
      .sign(privateKey);

    logger.debug(`Created DPoP proof for ${httpMethod} ${httpUri}`);
    return proof;
  }

  /**
   * Validate a DPoP proof
   */
  async validateDPoPProof(
    dpopProof: string,
    httpMethod: string,
    httpUri: string,
    options?: {
      accessToken?: string;
      expectedNonce?: string;
      requireNonce?: boolean;
    }
  ): Promise<{ valid: boolean; jkt?: string; error?: string }> {
    try {
      // Parse the JWT header to get the public key
      const [headerB64] = dpopProof.split('.');
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

      if (header.typ !== 'dpop+jwt') {
        return { valid: false, error: 'Invalid typ header' };
      }

      if (!header.jwk) {
        return { valid: false, error: 'Missing jwk in header' };
      }

      // Import the public key from JWK
      const publicKey = await importJWK(header.jwk, header.alg);

      // Verify the signature
      const { payload } = await jwtVerify(dpopProof, publicKey, {
        algorithms: [header.alg],
      });

      const claims = payload as unknown as DPoPPayload;

      // Validate HTTP method
      if (claims.htm !== httpMethod.toUpperCase()) {
        return { valid: false, error: `HTTP method mismatch: expected ${httpMethod}, got ${claims.htm}` };
      }

      // Validate HTTP URI
      if (claims.htu !== this.normalizeUri(httpUri)) {
        return { valid: false, error: `HTTP URI mismatch` };
      }

      // Check time window (prevent replay)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - claims.iat) > this.MAX_TIME_SKEW) {
        return { valid: false, error: 'DPoP proof too old or from future' };
      }

      // Check JTI uniqueness (prevent replay)
      if (await this.isJtiUsed(claims.jti)) {
        return { valid: false, error: 'DPoP proof jti already used (replay attack)' };
      }

      // Validate access token binding if provided
      if (options?.accessToken) {
        const expectedAth = await this.hashToken(options.accessToken);
        if (claims.ath !== expectedAth) {
          return { valid: false, error: 'Access token hash mismatch' };
        }
      } else if (claims.ath) {
        return { valid: false, error: 'Unexpected access token hash in proof' };
      }

      // Validate nonce if required
      if (options?.requireNonce || options?.expectedNonce) {
        if (!claims.nonce) {
          return { valid: false, error: 'Missing required nonce' };
        }
        if (options.expectedNonce && claims.nonce !== options.expectedNonce) {
          return { valid: false, error: 'Nonce mismatch' };
        }
        if (!await this.validateNonce(claims.nonce)) {
          return { valid: false, error: 'Invalid or expired nonce' };
        }
      }

      // Store JTI to prevent replay
      await this.storeJti(claims.jti);

      // Calculate JWK thumbprint for token binding
      const jkt = await this.calculateJwkThumbprint(header.jwk);

      logger.info(`DPoP proof validated successfully`);
      return { valid: true, jkt };

    } catch (error) {
      logger.error('DPoP validation error:', error);
      return { valid: false, error: 'DPoP validation failed' };
    }
  }

  /**
   * Generate a server nonce for enhanced security
   */
  generateNonce(): string {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64url');
    const expires = Date.now() + this.NONCE_TTL;

    this.nonceCache.set(nonce, expires);
    this.cleanupExpiredNonces();

    logger.debug('Generated DPoP nonce');
    return nonce;
  }

  /**
   * Validate a nonce
   */
  async validateNonce(nonce: string): Promise<boolean> {
    const expires = this.nonceCache.get(nonce);

    if (!expires) {
      return false;
    }

    if (Date.now() > expires) {
      this.nonceCache.delete(nonce);
      return false;
    }

    // Nonce is valid, remove it (single use)
    this.nonceCache.delete(nonce);
    return true;
  }

  /**
   * Bind an access token to a DPoP key
   */
  createDPoPBoundToken(
    token: any,
    jkt: string
  ): any {
    return {
      ...token,
      cnf: {
        jkt, // JWK thumbprint
      },
      token_type: 'DPoP', // Instead of 'Bearer'
    };
  }

  /**
   * Validate that a token is bound to the correct DPoP key
   */
  validateTokenBinding(
    token: any,
    dpopJkt: string
  ): boolean {
    if (!token.cnf?.jkt) {
      logger.warn('Token missing DPoP binding');
      return false;
    }

    if (token.cnf.jkt !== dpopJkt) {
      logger.warn('DPoP key mismatch');
      return false;
    }

    return true;
  }

  /**
   * Hash a token for the 'ath' claim
   */
  private async hashToken(token: string): Promise<string> {
    const hash = createHash('sha256')
      .update(token, 'ascii')
      .digest('base64url');
    return hash;
  }

  /**
   * Calculate JWK thumbprint (RFC 7638)
   */
  private async calculateJwkThumbprint(jwk: JWK): Promise<string> {
    // Create canonical JSON representation
    const canonical: any = {};

    // Required members in lexicographic order
    if (jwk.kty === 'RSA') {
      canonical.e = jwk.e;
      canonical.kty = jwk.kty;
      canonical.n = jwk.n;
    } else if (jwk.kty === 'EC') {
      canonical.crv = jwk.crv;
      canonical.kty = jwk.kty;
      canonical.x = jwk.x;
      canonical.y = jwk.y;
    }

    const json = JSON.stringify(canonical);
    const hash = createHash('sha256')
      .update(json, 'utf8')
      .digest('base64url');

    return hash;
  }

  /**
   * Normalize URI for comparison
   */
  private normalizeUri(uri: string): string {
    const url = new URL(uri);
    // Remove fragment, normalize path
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  }

  /**
   * Generate unique JTI
   */
  private generateJti(): string {
    return crypto.randomUUID();
  }

  /**
   * Check if JTI has been used
   */
  private async isJtiUsed(jti: string): Promise<boolean> {
    return this.jtiCache.has(jti);
  }

  /**
   * Store JTI to prevent replay
   */
  private async storeJti(jti: string): Promise<void> {
    const expires = Date.now() + this.JTI_TTL;
    this.jtiCache.set(jti, expires);
    this.cleanupExpiredJtis();
  }

  /**
   * Clean up expired JTIs
   */
  private cleanupExpiredJtis(): void {
    const now = Date.now();
    for (const [jti, expires] of this.jtiCache.entries()) {
      if (now > expires) {
        this.jtiCache.delete(jti);
      }
    }
  }

  /**
   * Clean up expired nonces
   */
  private cleanupExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, expires] of this.nonceCache.entries()) {
      if (now > expires) {
        this.nonceCache.delete(nonce);
      }
    }
  }

  /**
   * Middleware for Express to validate DPoP proofs
   */
  middleware(options?: { requireDPoP?: boolean; requireNonce?: boolean }) {
    return async (req: any, res: any, next: any) => {
      const dpopHeader = req.headers['dpop'];

      if (!dpopHeader) {
        if (options?.requireDPoP) {
          return res.status(401).json({ error: 'DPoP proof required' });
        }
        return next();
      }

      // Get access token from Authorization header
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader?.replace(/^DPoP /, '');

      // Validate DPoP proof
      const validation = await this.validateDPoPProof(
        dpopHeader,
        req.method,
        `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        {
          accessToken,
          expectedNonce: req.headers['dpop-nonce'],
          requireNonce: options?.requireNonce,
        }
      );

      if (!validation.valid) {
        logger.warn(`DPoP validation failed: ${validation.error}`);

        // If nonce is required, send one in response
        if (validation.error?.includes('nonce')) {
          const nonce = this.generateNonce();
          res.setHeader('DPoP-Nonce', nonce);
        }

        return res.status(401).json({
          error: 'Invalid DPoP proof',
          detail: validation.error
        });
      }

      // Add JKT to request for token binding validation
      req.dpopJkt = validation.jkt;

      next();
    };
  }

  /**
   * Get statistics about DPoP usage
   */
  getStats(): {
    activeJtis: number;
    activeNonces: number;
    totalValidations: number;
  } {
    this.cleanupExpiredJtis();
    this.cleanupExpiredNonces();

    return {
      activeJtis: this.jtiCache.size,
      activeNonces: this.nonceCache.size,
      totalValidations: 0, // Would need to track this
    };
  }
}

// Export singleton instance
export const dpopManager = new DPoPManager();