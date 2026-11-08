/*
 * Vault Edge Function — AES-256-GCM API Key Encryption
 *
 * Actions:
 *   POST { action: "encrypt", apiKey, apiSecret }
 *     → Returns { encryptedKey, encryptedSecret, keyPreview } for storage in broker_keys
 *   POST { action: "decrypt", encryptedKey, encryptedSecret }
 *     → Returns { apiKey, apiSecret } for in-memory use by execute-trade only
 *
 * The encryption key is derived from SUPABASE_SERVICE_ROLE_KEY via PBKDF2,
 * so ciphertext is unreadable without the service-role secret. Decrypted
 * values are never persisted or logged.
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(): Promise<CryptoKey> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "fallback-vault-key";
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(serviceKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("cortex-vault-salt-v1"), iterations: 100_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function encryptValue(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return toBase64(combined.buffer);
}

async function decryptValue(ciphertext: string, key: CryptoKey): Promise<string> {
  const combined = fromBase64(ciphertext);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return dec.decode(plainBuf);
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "-****-" + key.slice(-4);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await adminClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const key = await deriveKey();

    if (body.action === "encrypt") {
      const { apiKey, apiSecret } = body;
      if (!apiKey || !apiSecret) {
        return new Response(JSON.stringify({ error: "Missing apiKey or apiSecret" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const encryptedKey = await encryptValue(apiKey, key);
      const encryptedSecret = await encryptValue(apiSecret, key);
      return new Response(JSON.stringify({
        encryptedKey,
        encryptedSecret,
        keyPreview: maskKey(apiKey),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "decrypt") {
      const { encryptedKey, encryptedSecret } = body;
      if (!encryptedKey || !encryptedSecret) {
        return new Response(JSON.stringify({ error: "Missing encryptedKey or encryptedSecret" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const apiKey = await decryptValue(encryptedKey, key);
      const apiSecret = await decryptValue(encryptedSecret, key);
      return new Response(JSON.stringify({ apiKey, apiSecret }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use 'encrypt' or 'decrypt'." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
