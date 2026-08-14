// Server-only: encrypts Shopify access tokens before they touch the database.
// Never log, return, or expose decrypted tokens.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function getKey(): Promise<CryptoKey> {
  const raw = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptToken(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptToken(payload: string): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Invalid encrypted token format");
  const key = await getKey();
  const iv = fromBase64(parts[1]!);
  const cipher = fromBase64(parts[2]!);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return dec.decode(plain);
}
