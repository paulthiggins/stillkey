import { Reader } from "protobufjs/minimal.js";
import { Secret } from "otpauth";
import { newAccount, type TotpAccount } from "./model";
export interface Migration {
  batchId: number;
  batchSize: number;
  batchIndex: number;
  version: number;
  accounts: TotpAccount[];
  skipped: string[];
}
export type ImportPart =
  | { kind: "standard"; accounts: TotpAccount[] }
  | { kind: "migration"; migration: Migration };
export function parseImport(text: string): ImportPart {
  if (text.length > 100_000) throw Error("Import is too large.");
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw Error("Paste a valid otpauth or migration URI.");
  }
  if (url.protocol === "otpauth-migration:") {
    if (url.hostname !== "offline") throw Error("Unsupported migration URI.");
    return {
      kind: "migration",
      migration: decodeMigration(url.searchParams.get("data") ?? ""),
    };
  }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp")
    throw Error(
      "Only TOTP accounts are supported. HOTP accounts cannot be imported.",
    );
  const p = url.searchParams;
  for (const key of ["secret", "issuer", "algorithm", "digits", "period"])
    if (p.getAll(key).length > 1) throw Error("Duplicate URI parameters.");
  const label = decodeURIComponent(url.pathname.slice(1));
  const separator = label.indexOf(":");
  const labelIssuer = separator < 0 ? "" : label.slice(0, separator);
  const issuer = p.get("issuer") ?? labelIssuer;
  if (labelIssuer && p.has("issuer") && labelIssuer !== issuer)
    throw Error("Issuer does not match the account label.");
  return {
    kind: "standard",
    accounts: [
      newAccount({
        issuer,
        accountName: separator < 0 ? label : label.slice(separator + 1).trim(),
        displayLabel: issuer || label,
        secretBase32: p.get("secret") ?? "",
        algorithm: (
          p.get("algorithm") ?? "SHA1"
        ).toUpperCase() as TotpAccount["algorithm"],
        digits: Number(p.get("digits") ?? 6) as 6 | 8,
        period: Number(p.get("period") ?? 30),
      }),
    ],
  };
}
function entry(
  r: Reader,
  end: number,
): { account?: TotpAccount; skipped?: string } {
  let secret = new Uint8Array(),
    name = "",
    issuer = "",
    algorithm = 0,
    digits = 0,
    type = 0;
  let counter = "0";
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1:
        secret = new Uint8Array(r.bytes());
        break;
      case 2:
        name = r.string();
        break;
      case 3:
        issuer = r.string();
        break;
      case 4:
        algorithm = r.int32();
        break;
      case 5:
        digits = r.int32();
        break;
      case 6:
        type = r.int32();
        break;
      case 7:
        counter = r.uint64().toString();
        break;
      default:
        r.skipType(tag & 7);
    }
  }
  if (r.pos !== end) throw Error("Malformed migration entry.");
  if (type === 1)
    return {
      skipped: `${issuer || name || "Account"}: HOTP (counter ${counter}) is not supported.`,
    };
  if (type !== 2 || ![1, 2, 3].includes(algorithm) || ![1, 2].includes(digits))
    return {
      skipped: `${issuer || name || "Account"}: unsupported OTP type, algorithm, or digits.`,
    };
  return {
    account: newAccount({
      issuer,
      accountName: name,
      displayLabel: issuer || name,
      secretBase32: new Secret({ buffer: secret.buffer }).base32,
      algorithm: ({ 1: "SHA1", 2: "SHA256", 3: "SHA512" } as const)[
        algorithm as 1 | 2 | 3
      ],
      digits: digits === 1 ? 6 : 8,
    }),
  };
}
export function decodeMigration(encoded: string): Migration {
  if (
    !encoded ||
    encoded.length > 100_000 ||
    !/^[A-Za-z0-9+/=_-]+$/.test(encoded)
  )
    throw Error("Invalid migration data.");
  const bytes = Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const r = Reader.create(bytes),
    result: Migration = {
      batchId: 0,
      batchSize: 1,
      batchIndex: 0,
      version: 0,
      accounts: [],
      skipped: [],
    };
  while (r.pos < r.len) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: {
        const length = r.uint32(),
          end = r.pos + length;
        if (end > r.len) throw Error("Truncated migration payload.");
        const value = entry(r, end);
        if (value.account) result.accounts.push(value.account);
        if (value.skipped) result.skipped.push(value.skipped);
        break;
      }
      case 2:
        result.version = r.int32();
        break;
      case 3:
        result.batchSize = r.int32();
        break;
      case 4:
        result.batchIndex = r.int32();
        break;
      case 5:
        result.batchId = r.int32();
        break;
      default:
        r.skipType(tag & 7);
    }
    if (result.accounts.length + result.skipped.length > 2000)
      throw Error("Too many accounts.");
  }
  // Google exports use both versions with the account fields decoded above.
  // Keep an explicit allowlist so unknown future formats still fail closed.
  if (![1, 2].includes(result.version))
    throw Error(
      "Unsupported Google Authenticator export version. Supported versions: 1 and 2.",
    );
  if (
    result.batchSize < 1 ||
    result.batchSize > 100 ||
    result.batchIndex < 0 ||
    result.batchIndex >= result.batchSize
  )
    throw Error("Invalid migration batch metadata.");
  return result;
}
export function addBatch(parts: Migration[], next: Migration): Migration[] {
  if (
    parts.reduce((sum, p) => sum + p.accounts.length + p.skipped.length, 0) +
      next.accounts.length +
      next.skipped.length >
    2000
  )
    throw Error("Import limit is 2,000 accounts.");
  const first = parts[0];
  if (
    first &&
    (first.batchId !== next.batchId ||
      first.batchSize !== next.batchSize ||
      first.version !== next.version)
  )
    throw Error(
      "This QR belongs to a different export batch. Clear the preview first.",
    );
  if (parts.some((p) => p.batchIndex === next.batchIndex))
    throw Error("This batch part has already been scanned.");
  return [...parts, next].sort((a, b) => a.batchIndex - b.batchIndex);
}
