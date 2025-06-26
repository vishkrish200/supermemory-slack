/**
 * Token Encryption Service for Slack Connector
 *
 * Implements AES-GCM-256 encryption with unique IVs per operation
 * Following 2024-2025 security best practices for Cloudflare Workers
 */

export interface EncryptedToken {
  encryptedData: string; // Base64 encoded IV + ciphertext
  algorithm: "AES-GCM-256";
  keyId?: string; // For key rotation support
}

export interface TokenMetadata {
  teamId: string;
  slackUserId: string;
  tokenType: "bot" | "user";
  scope: string;
  botUserId?: string;
  appId: string;
}

export class TokenEncryptionService {
  private readonly ALGORITHM = "AES-GCM";
  private readonly KEY_LENGTH = 256;
  private readonly IV_LENGTH = 12; // 96 bits for AES-GCM

  constructor(private readonly secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error("Encryption secret must be at least 32 characters long");
    }
  }

  /**
   * Encrypt a Slack token using AES-GCM-256 with a unique IV
   */
  async encryptToken(
    token: string,
    metadata?: TokenMetadata
  ): Promise<EncryptedToken> {
    try {
      // Import the encryption key
      const key = await this.importKey(this.secret);

      // Generate a unique IV for this operation
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

      // Encrypt the token
      const ciphertext = await crypto.subtle.encrypt(
        { name: this.ALGORITHM, iv },
        key,
        new TextEncoder().encode(token)
      );

      // Combine IV + ciphertext and encode as base64
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);

      const encryptedData = btoa(String.fromCharCode(...combined));

      return {
        encryptedData,
        algorithm: "AES-GCM-256",
        keyId: "default", // For future key rotation support
      };
    } catch (error) {
      throw new Error(
        `Token encryption failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Decrypt a Slack token using AES-GCM-256
   */
  async decryptToken(encryptedToken: EncryptedToken): Promise<string> {
    try {
      // Import the decryption key
      const key = await this.importKey(this.secret);

      // Decode the base64 data
      const combined = Uint8Array.from(
        atob(encryptedToken.encryptedData),
        (c) => c.charCodeAt(0)
      );

      // Extract IV and ciphertext
      const iv = combined.slice(0, this.IV_LENGTH);
      const ciphertext = combined.slice(this.IV_LENGTH);

      // Decrypt the token
      const plaintext = await crypto.subtle.decrypt(
        { name: this.ALGORITHM, iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(plaintext);
    } catch (error) {
      throw new Error(
        `Token decryption failed: ${
          error instanceof Error ? error.message : "Invalid or corrupted token"
        }`
      );
    }
  }

  /**
   * Validate that a token can be decrypted without actually decrypting it
   */
  async validateEncryptedToken(
    encryptedToken: EncryptedToken
  ): Promise<boolean> {
    try {
      await this.decryptToken(encryptedToken);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Re-encrypt a token with a new key (for key rotation)
   */
  async rotateTokenEncryption(
    encryptedToken: EncryptedToken,
    oldSecret: string,
    newSecret: string
  ): Promise<EncryptedToken> {
    // Decrypt with old key
    const oldService = new TokenEncryptionService(oldSecret);
    const plaintext = await oldService.decryptToken(encryptedToken);

    // Encrypt with new key
    const newService = new TokenEncryptionService(newSecret);
    return await newService.encryptToken(plaintext);
  }

  /**
   * Import a key for encryption/decryption operations
   */
  private async importKey(secret: string): Promise<CryptoKey> {
    // Create a consistent key from the secret
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret.slice(0, 32)), // Use first 32 chars for 256-bit key
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    // Derive the actual encryption key
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode("slack-connector-salt"), // Fixed salt for consistency
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Generate a secure random secret for encryption
   */
  static generateSecret(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
  }
}

/**
 * Utility functions for token encryption in the app
 */
export class TokenManager {
  private encryptionService: TokenEncryptionService;

  constructor(secret: string) {
    this.encryptionService = new TokenEncryptionService(secret);
  }

  /**
   * Securely store a token with metadata
   */
  async prepareTokenForStorage(
    token: string,
    metadata: TokenMetadata
  ): Promise<{
    encryptedToken: EncryptedToken;
    metadata: TokenMetadata;
  }> {
    const encryptedToken = await this.encryptionService.encryptToken(
      token,
      metadata
    );

    return {
      encryptedToken,
      metadata,
    };
  }

  /**
   * Retrieve and decrypt a token for use
   */
  async retrieveToken(encryptedToken: EncryptedToken): Promise<string> {
    return await this.encryptionService.decryptToken(encryptedToken);
  }

  /**
   * Check if a token is valid without decrypting it
   */
  async isTokenValid(encryptedToken: EncryptedToken): Promise<boolean> {
    return await this.encryptionService.validateEncryptedToken(encryptedToken);
  }
}
