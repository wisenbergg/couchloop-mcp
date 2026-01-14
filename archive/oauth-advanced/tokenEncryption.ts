import { createCipheriv, createDecipheriv, randomBytes, scrypt, createHash, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';

const scryptAsync = promisify(scrypt);

/**
 * Encrypted token structure
 */
export interface EncryptedToken {
  encrypted: string;
  hash: string; // For indexing without decryption
}

/**
 * Token Encryption Manager
 * Provides AES-256-GCM encryption for tokens at rest
 */
export class TokenEncryption {
  private readonly algorithm = 'aes-256-gcm';
  private readonly saltLength = 32;
  private readonly tagLength = 16;
  private readonly ivLength = 16;
  private readonly keyLength = 32;

  /**
   * Encrypt a token using AES-256-GCM
   * Returns encrypted data and a hash for indexing
   */
  async encryptToken(plaintext: string): Promise<EncryptedToken> {
    if (!plaintext) {
      throw new Error('Cannot encrypt empty token');
    }

    const encryptionKey = this.getEncryptionKey();

    // Generate salt and IV for this encryption
    const salt = randomBytes(this.saltLength);
    const iv = randomBytes(this.ivLength);

    // Derive key from master key and salt
    const key = await this.deriveKey(encryptionKey, salt);

    // Create cipher
    const cipher = createCipheriv(this.algorithm, key, iv);

    // Encrypt the token
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get the authentication tag
    const tag = cipher.getAuthTag();

    // Combine salt, iv, tag, and encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);

    // Generate hash for indexing (allows searching without decryption)
    const hash = this.hashToken(plaintext);

    const result = {
      encrypted: combined.toString('base64url'),
      hash,
    };

    logger.debug(`Token encrypted, length: ${result.encrypted.length}`);
    return result;
  }

  /**
   * Decrypt a token
   */
  async decryptToken(encryptedData: string): Promise<string> {
    if (!encryptedData) {
      throw new Error('Cannot decrypt empty data');
    }

    const encryptionKey = this.getEncryptionKey();

    try {
      // Parse the combined buffer
      const combined = Buffer.from(encryptedData, 'base64url');

      if (combined.length < this.saltLength + this.ivLength + this.tagLength) {
        throw new Error('Invalid encrypted data format');
      }

      // Extract components
      const salt = combined.slice(0, this.saltLength);
      const iv = combined.slice(this.saltLength, this.saltLength + this.ivLength);
      const tag = combined.slice(
        this.saltLength + this.ivLength,
        this.saltLength + this.ivLength + this.tagLength
      );
      const encrypted = combined.slice(this.saltLength + this.ivLength + this.tagLength);

      // Derive the same key
      const key = await this.deriveKey(encryptionKey, salt);

      // Create decipher
      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(tag);

      // Decrypt
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      const result = decrypted.toString('utf8');
      logger.debug('Token decrypted successfully');
      return result;
    } catch (error) {
      logger.error('Token decryption failed:', error);
      throw new Error('Failed to decrypt token');
    }
  }

  /**
   * Hash a token for indexing
   * Uses SHA256 for consistent hashing
   */
  hashToken(token: string): string {
    const hash = createHash('sha256')
      .update(token)
      .digest('base64url');

    return hash;
  }

  /**
   * Verify a plaintext token matches a hash
   */
  verifyTokenHash(plaintext: string, hash: string): boolean {
    const computedHash = this.hashToken(plaintext);

    // Constant-time comparison
    if (computedHash.length !== hash.length) {
      return false;
    }

    const bufferA = Buffer.from(computedHash);
    const bufferB = Buffer.from(hash);

    try {
      return timingSafeEqual(bufferA, bufferB);
    } catch {
      return false;
    }
  }

  /**
   * Encrypt sensitive data (generic, not just tokens)
   */
  async encrypt(text: string): Promise<string> {
    const { encrypted } = await this.encryptToken(text);
    return encrypted;
  }

  /**
   * Decrypt sensitive data (generic)
   */
  async decrypt(encryptedData: string): Promise<string> {
    return this.decryptToken(encryptedData);
  }

  /**
   * Derive encryption key from password and salt
   * Uses scrypt for key derivation
   */
  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    const key = await scryptAsync(password, salt, this.keyLength);
    return key as Buffer;
  }

  /**
   * Get the master encryption key
   * In production, this should come from a secure key management service
   */
  private getEncryptionKey(): string {
    const key = process.env.ENCRYPTION_KEY;

    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable not set');
    }

    // Validate key strength (should be at least 32 characters)
    if (key.length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters');
    }

    return key;
  }

  /**
   * Rotate encryption (re-encrypt with new salt/IV)
   * Useful for key rotation scenarios
   */
  async rotateEncryption(encryptedData: string): Promise<EncryptedToken> {
    // Decrypt with old parameters
    const plaintext = await this.decryptToken(encryptedData);

    // Re-encrypt with new salt/IV
    return this.encryptToken(plaintext);
  }

  /**
   * Batch encrypt multiple tokens
   * More efficient than individual encryption
   */
  async encryptBatch(tokens: string[]): Promise<EncryptedToken[]> {
    return Promise.all(tokens.map(token => this.encryptToken(token)));
  }

  /**
   * Batch decrypt multiple tokens
   */
  async decryptBatch(encryptedTokens: string[]): Promise<string[]> {
    return Promise.all(encryptedTokens.map(token => this.decryptToken(token)));
  }

  /**
   * Generate a secure random token
   * Useful for generating access/refresh tokens
   */
  generateSecureToken(length: number = 32): string {
    return randomBytes(length).toString('base64url');
  }

  /**
   * Validate encryption key on startup
   * Ensures the key meets security requirements
   */
  validateEncryptionSetup(): boolean {
    try {
      const key = this.getEncryptionKey();

      // Check key entropy (rough estimate)
      const uniqueChars = new Set(key).size;
      if (uniqueChars < 10) {
        logger.warn('Encryption key has low entropy');
        return false;
      }

      // Test encryption/decryption
      const testData = 'test_encryption_validation';
      this.encryptToken(testData)
        .then(encrypted => this.decryptToken(encrypted.encrypted))
        .then(decrypted => {
          if (decrypted !== testData) {
            throw new Error('Encryption validation failed');
          }
        });

      logger.info('Token encryption setup validated successfully');
      return true;
    } catch (error) {
      logger.error('Encryption setup validation failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const tokenEncryption = new TokenEncryption();

// Validate encryption on module load
if (process.env.NODE_ENV !== 'test') {
  tokenEncryption.validateEncryptionSetup();
}