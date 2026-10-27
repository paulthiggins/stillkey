import Dexie, { type Table } from "dexie";
import { argon2id } from "hash-wasm";
import { validateVault, type VaultData } from "./model";
export const KDF = {
  name: "Argon2id",
  version: 19,
  memory: 65536,
  iterations: 3,
  parallelism: 1,
} as const;
export interface Envelope {
  format: "stillkey-vault";
  version: 1;
  cipher: "AES-256-GCM";
  kdf: typeof KDF;
  salt: string;
  iv: string;
  ciphertext: string;
}
export interface Session {
  key: CryptoKey;
  salt: string;
}
export const MAX_BACKUP = 4_000_000;
export const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  if (
    typeof s !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(s) ||
    s.length % 4 !== 0
  )
    throw Error("Invalid encoding.");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const header = (e: Omit<Envelope, "ciphertext">) => ({
  format: e.format,
  version: e.version,
  cipher: e.cipher,
  kdf: {
    name: e.kdf.name,
    version: e.kdf.version,
    memory: e.kdf.memory,
    iterations: e.kdf.iterations,
    parallelism: e.kdf.parallelism,
  },
  salt: e.salt,
  iv: e.iv,
});
export function parseEnvelope(raw: string): Envelope {
  if (raw.length > MAX_BACKUP) throw Error("Backup is too large.");
  let e: Envelope;
  try {
    e = JSON.parse(raw) as Envelope;
  } catch {
    throw Error("Invalid backup JSON.");
  }
  if (
    !e ||
    e.format !== "stillkey-vault" ||
    e.version !== 1 ||
    e.cipher !== "AES-256-GCM" ||
    !e.kdf ||
    Object.keys(KDF).some(
      (k) => e.kdf[k as keyof typeof KDF] !== KDF[k as keyof typeof KDF],
    )
  )
    throw Error("Unsupported backup format or encryption settings.");
  if (
    unb64(e.salt).length !== 16 ||
    unb64(e.iv).length !== 12 ||
    unb64(e.ciphertext).length < 16
  )
    throw Error("Invalid encrypted vault.");
  return e;
}
export async function derive(password: string, salt: string): Promise<Session> {
  if (password.length > 1024) throw Error("Password is too long.");
  const bytes = await argon2id({
    password,
    salt: unb64(salt),
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "binary",
  });
  try {
    return {
      salt,
      key: await crypto.subtle.importKey(
        "raw",
        new Uint8Array(bytes),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
      ),
    };
  } finally {
    bytes.fill(0);
  }
}
export async function newSession(password: string): Promise<Session> {
  if (password.length < 12)
    throw Error("Use at least 12 characters for your master password.");
  return derive(password, b64(crypto.getRandomValues(new Uint8Array(16))));
}
export async function seal(
  data: VaultData,
  session: Session,
): Promise<Envelope> {
  validateVault(data);
  const h = header({
    format: "stillkey-vault",
    version: 1,
    cipher: "AES-256-GCM",
    kdf: KDF,
    salt: session.salt,
    iv: b64(crypto.getRandomValues(new Uint8Array(12))),
  });
  const plain = new TextEncoder().encode(JSON.stringify(data));
  try {
    const cipher = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: unb64(h.iv),
        additionalData: new TextEncoder().encode(JSON.stringify(h)),
        tagLength: 128,
      },
      session.key,
      plain,
    );
    const envelope = { ...h, ciphertext: b64(new Uint8Array(cipher)) };
    if (JSON.stringify(envelope).length > MAX_BACKUP)
      throw Error(
        "Vault is too large. Remove accounts or shorten labels before saving.",
      );
    return envelope;
  } finally {
    plain.fill(0);
  }
}
export async function open(
  envelope: Envelope,
  password: string,
): Promise<{ data: VaultData; session: Session }> {
  const e = parseEnvelope(JSON.stringify(envelope));
  const session = await derive(password, e.salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unb64(e.iv),
        additionalData: new TextEncoder().encode(JSON.stringify(header(e))),
        tagLength: 128,
      },
      session.key,
      unb64(e.ciphertext),
    );
  } catch {
    throw Error(
      "Unable to unlock. Check the password; the vault may also be damaged.",
    );
  }
  try {
    return {
      session,
      data: validateVault(JSON.parse(new TextDecoder().decode(plain))),
    };
  } finally {
    new Uint8Array(plain).fill(0);
  }
}
class Database extends Dexie {
  vault!: Table<{ id: string; revision: number; envelope: Envelope }, string>;
  constructor() {
    super("stillkey");
    this.version(1).stores({ vault: "id" });
  }
}
export const db = new Database();
export async function readVault() {
  return db.vault.get("main");
}
export async function writeVault(
  envelope: Envelope,
  expected: number,
): Promise<number> {
  return db.transaction("rw", db.vault, async () => {
    const current = await readVault();
    if ((current?.revision ?? 0) !== expected)
      throw Error(
        "Vault changed in another tab. Lock and unlock to reload it.",
      );
    const revision = expected + 1;
    await db.vault.put({ id: "main", revision, envelope });
    return revision;
  });
}
