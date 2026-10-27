import * as OTPAuth from "otpauth";
export interface TotpAccount {
  id: string;
  issuer: string;
  accountName: string;
  displayLabel: string;
  secretBase32: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export interface Settings {
  theme: "system" | "light" | "dark";
  sorting: "manual" | "alphabetical";
  autoLock: number;
  backgroundLock: boolean;
  showIdentifiers: boolean;
}
export interface VaultData {
  schemaVersion: 1;
  accounts: TotpAccount[];
  settings: Settings;
  changedAt: string;
  backedUpAt: string | null;
}
export const defaults: Settings = {
  theme: "system",
  sorting: "manual",
  autoLock: 5,
  backgroundLock: false,
  showIdentifiers: true,
};
export const emptyVault = (): VaultData => ({
  schemaVersion: 1,
  accounts: [],
  settings: { ...defaults },
  changedAt: new Date().toISOString(),
  backedUpAt: null,
});
export function cleanText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    Array.from(value).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    throw Error("Labels must be plain text, up to 200 characters.");
  return value.trim();
}
export function normalizeSecret(value: string): string {
  const secret = value.replace(/\s/g, "").toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]{16,1024}$/.test(secret))
    throw Error("Enter a valid Base32 secret (at least 16 characters).");
  const decoded = OTPAuth.Secret.fromBase32(secret);
  if (decoded.base32 !== secret) throw Error("Invalid Base32 encoding.");
  return secret;
}
export function validateAccount(a: TotpAccount): TotpAccount {
  if (!a || typeof a !== "object") throw Error("Invalid account.");
  if (!["SHA1", "SHA256", "SHA512"].includes(a.algorithm))
    throw Error("Unsupported algorithm.");
  if (a.digits !== 6 && a.digits !== 8) throw Error("Use 6 or 8 digits.");
  if (!Number.isInteger(a.period) || a.period < 5 || a.period > 300)
    throw Error("Period must be between 5 and 300 seconds.");
  if (
    typeof a.id !== "string" ||
    a.id.length > 100 ||
    !a.id ||
    !Number.isFinite(a.sortOrder) ||
    !Number.isFinite(Date.parse(a.createdAt)) ||
    !Number.isFinite(Date.parse(a.updatedAt))
  )
    throw Error("Invalid account metadata.");
  return {
    ...a,
    issuer: cleanText(a.issuer),
    accountName: cleanText(a.accountName),
    displayLabel:
      cleanText(a.displayLabel) ||
      cleanText(a.issuer) ||
      cleanText(a.accountName) ||
      "Account",
    secretBase32: normalizeSecret(a.secretBase32),
  };
}
export function newAccount(input: Partial<TotpAccount>): TotpAccount {
  const now = new Date().toISOString();
  return validateAccount({
    id: crypto.randomUUID(),
    issuer: "",
    accountName: "",
    displayLabel: "",
    secretBase32: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...input,
  });
}
export function generateCode(a: TotpAccount, time = Date.now()): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(a.secretBase32),
    algorithm: a.algorithm,
    digits: a.digits,
    period: a.period,
  }).generate({ timestamp: time });
}
export function accountUri(a: TotpAccount): string {
  return new OTPAuth.TOTP({
    issuer: a.issuer,
    label: a.accountName || a.displayLabel,
    secret: OTPAuth.Secret.fromBase32(a.secretBase32),
    algorithm: a.algorithm,
    digits: a.digits,
    period: a.period,
  }).toString();
}
export function duplicateKey(a: TotpAccount): string {
  return `${a.secretBase32}:${a.algorithm}:${a.digits}:${a.period}`;
}
export function mergeAccounts(
  current: TotpAccount[],
  incoming: TotpAccount[],
): TotpAccount[] {
  const result = [...current],
    seen = new Set(current.map(duplicateKey));
  for (const a of incoming) {
    if (!seen.has(duplicateKey(a))) {
      result.push({ ...a, id: crypto.randomUUID(), sortOrder: result.length });
      seen.add(duplicateKey(a));
    }
  }
  if (result.length > 2000) throw Error("Vault limit is 2,000 accounts.");
  return result;
}
export function validateVault(raw: unknown): VaultData {
  const d = raw as VaultData;
  if (!d || d.schemaVersion !== 1)
    throw Error(
      "Unsupported vault schema. Update the app before opening this vault.",
    );
  if (!Array.isArray(d.accounts) || d.accounts.length > 2000)
    throw Error("Invalid vault.");
  const accounts = d.accounts.map(validateAccount);
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length)
    throw Error("Duplicate account IDs.");
  const s = d.settings;
  if (
    !s ||
    !["light", "dark", "system"].includes(s.theme) ||
    !["manual", "alphabetical"].includes(s.sorting) ||
    ![1, 5, 15, 30, 60].includes(s.autoLock) ||
    typeof s.backgroundLock !== "boolean" ||
    typeof s.showIdentifiers !== "boolean" ||
    !Number.isFinite(Date.parse(d.changedAt)) ||
    (d.backedUpAt !== null && !Number.isFinite(Date.parse(d.backedUpAt)))
  )
    throw Error("Invalid vault settings.");
  return {
    schemaVersion: 1,
    accounts,
    settings: { ...s },
    changedAt: d.changedAt,
    backedUpAt: d.backedUpAt,
  };
}
