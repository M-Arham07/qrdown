// Web Crypto API AES-256-GCM and SHA-256 implementation

export interface EncryptedPayload {
  cipherBuffer: ArrayBuffer;
  ivHex: string;
}

export const cryptoService = {
  /**
   * Generates a cryptographically strong 256-bit AES-GCM key
   */
  async generateKey(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
  },

  /**
   * Export key to JSON Web Key (JWK) for peer key exchange
   */
  async exportKey(key: CryptoKey): Promise<JsonWebKey> {
    return window.crypto.subtle.exportKey("jwk", key);
  },

  /**
   * Import key from JSON Web Key (JWK)
   */
  async importKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
      "jwk",
      jwk,
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
  },

  /**
   * Generates a 12-byte random initialization vector
   */
  generateIv(): Uint8Array {
    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);
    return iv;
  },

  /**
   * Encrypt an ArrayBuffer with AES-256-GCM
   */
  async encrypt(data: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
    return window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
      },
      key,
      data
    );
  },

  /**
   * Decrypt an ArrayBuffer with AES-256-GCM
   */
  async decrypt(cipherData: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
    return window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
      },
      key,
      cipherData
    );
  },

  /**
   * Computes SHA-256 hexadecimal hash string for data integrity validation
   */
  async computeChecksum(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },

  /**
   * Helpers for IV conversions
   */
  ivToHex(iv: Uint8Array): string {
    return Array.from(iv)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  },

  hexToIv(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  },
};
