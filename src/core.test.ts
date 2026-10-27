import { describe, it, expect } from "vitest";
import { Secret } from "otpauth";
import { Writer } from "protobufjs/minimal.js";
import {
  generateCode,
  newAccount,
  emptyVault,
  mergeAccounts,
  validateAccount,
} from "./model";
import { newSession, seal, open, parseEnvelope } from "./vault";
import { parseImport, decodeMigration, addBatch } from "./imports";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const account = () => newAccount({ secretBase32: secret, issuer: "Test" });
describe("RFC 6238", () => {
  const times = [
    59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000,
  ];
  const vectors = {
    SHA1: [
      "94287082",
      "07081804",
      "14050471",
      "89005924",
      "69279037",
      "65353130",
    ],
    SHA256: [
      "46119246",
      "68084774",
      "67062674",
      "91819424",
      "90698825",
      "77737706",
    ],
    SHA512: [
      "90693936",
      "25091201",
      "99943326",
      "93441116",
      "38618901",
      "47863826",
    ],
  };
  for (const algorithm of ["SHA1", "SHA256", "SHA512"] as const) {
    const length = algorithm === "SHA1" ? 20 : algorithm === "SHA256" ? 32 : 64;
    const ascii = "1234567890".repeat(7).slice(0, length);
    for (const [i, time] of times.entries())
      it(`${algorithm} at ${time}`, () => {
        const a = newAccount({
          secretBase32: Secret.fromUTF8(ascii).base32,
          algorithm,
          digits: 8,
        });
        expect(generateCode(a, time * 1000)).toBe(vectors[algorithm][i]);
        expect(generateCode({ ...a, digits: 6 }, time * 1000)).toBe(
          vectors[algorithm][i].slice(-6),
        );
      });
  }
  it("changes exactly at the boundary", () => {
    expect(generateCode(account(), 29999)).toBe(generateCode(account(), 0));
    expect(generateCode(account(), 30000)).not.toBe(
      generateCode(account(), 29999),
    );
  });
  it("rejects malformed secrets and algorithms", () => {
    expect(() => newAccount({ secretBase32: "bad!" })).toThrow();
    expect(() =>
      validateAccount({ ...account(), algorithm: "MD5" as "SHA1" }),
    ).toThrow();
  });
});
describe("imports", () => {
  it("parses standard URI", () => {
    const result = parseImport(
      `otpauth://totp/Test:demo?secret=${secret}&issuer=Test&algorithm=SHA256&digits=8&period=60`,
    );
    expect(result.kind).toBe("standard");
    if (result.kind === "standard")
      expect(result.accounts[0]).toMatchObject({
        issuer: "Test",
        accountName: "demo",
        period: 60,
        digits: 8,
        algorithm: "SHA256",
      });
  });
  it("rejects unsupported and conflicting fields", () => {
    for (const uri of [
      `otpauth://hotp/Test?secret=${secret}`,
      `otpauth://totp/Test?secret=${secret}&algorithm=MD5`,
      `otpauth://totp/A:B?secret=${secret}&issuer=C`,
    ])
      expect(() => parseImport(uri)).toThrow();
  });
  it("detects duplicates", () =>
    expect(mergeAccounts([account()], [account()])).toHaveLength(1));
  it("decodes protobuf and requires consistent complete batches", () => {
    const entry = Writer.create()
      .uint32(10)
      .bytes(new Uint8Array(20).fill(49))
      .uint32(18)
      .string("demo")
      .uint32(26)
      .string("Test")
      .uint32(32)
      .int32(1)
      .uint32(40)
      .int32(1)
      .uint32(48)
      .int32(2)
      .finish();
    const payload = Writer.create()
      .uint32(10)
      .bytes(entry)
      .uint32(16)
      .int32(1)
      .uint32(24)
      .int32(2)
      .uint32(32)
      .int32(0)
      .uint32(40)
      .int32(7)
      .finish();
    const part = decodeMigration(Buffer.from(payload).toString("base64"));
    expect(part.accounts).toHaveLength(1);
    expect(part.batchSize).toBe(2);
    expect(addBatch([part], { ...part, batchIndex: 1 })).toHaveLength(2);
    expect(() => addBatch([part], part)).toThrow();
    expect(() => addBatch([part], { ...part, batchId: 8 })).toThrow();
  });
});
describe("encrypted vault", () => {
  it("round trips, authenticates metadata and rejects wrong passwords", async () => {
    const data = emptyVault();
    data.accounts = [account()];
    const session = await newSession("synthetic test password");
    const envelope = await seal(data, session);
    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(
      (
        await open(
          parseEnvelope(JSON.stringify(envelope)),
          "synthetic test password",
        )
      ).data,
    ).toEqual(data);
    await expect(open(envelope, "incorrect password")).rejects.toThrow();
    await expect(
      open({ ...envelope, iv: "AAAAAAAAAAAAAAAA" }, "synthetic test password"),
    ).rejects.toThrow();
    expect((await seal(data, session)).iv).not.toBe(envelope.iv);
  }, 20000);
  it("bounds KDF and backup versions before deriving", () => {
    expect(() =>
      parseEnvelope(JSON.stringify({ format: "stillkey-vault", version: 99 })),
    ).toThrow();
  });
});

describe("defensive input validation", () => {
  it("rejects oversized, malformed, duplicate parameters and invalid periods", () => {
    for (const uri of [
      "x".repeat(100001),
      `otpauth://totp/Test?secret=${secret}&secret=${secret}`,
      `otpauth://totp/Test?secret=${secret}&period=0`,
      `otpauth://totp/Test?secret=${secret}&digits=7`,
      `otpauth://totp/Test%00?secret=${secret}`,
    ])
      expect(() => parseImport(uri)).toThrow();
  });
  it("bounds protobuf and batch metadata", () => {
    expect(() => decodeMigration("%%%%")).toThrow();
    const bytes = Writer.create()
      .uint32(16)
      .int32(1)
      .uint32(24)
      .int32(101)
      .finish();
    expect(() =>
      decodeMigration(Buffer.from(bytes).toString("base64")),
    ).toThrow();
    expect(() =>
      decodeMigration(Buffer.from([10, 127, 1]).toString("base64")),
    ).toThrow();
  });
  it("rejects hostile KDF parameters before hashing", async () => {
    const s = await newSession("synthetic test password");
    const envelope = await seal(emptyVault(), s);
    expect(() =>
      parseEnvelope(
        JSON.stringify({
          ...envelope,
          kdf: { ...envelope.kdf, memory: 2147483647 },
        }),
      ),
    ).toThrow();
    expect(() => parseEnvelope("not JSON")).toThrow("Invalid backup JSON");
    const tampered = {
      ...envelope,
      ciphertext:
        (envelope.ciphertext[0] === "A" ? "B" : "A") +
        envelope.ciphertext.slice(1),
    };
    await expect(open(tampered, "synthetic test password")).rejects.toThrow(
      "Unable to unlock",
    );
  });
});
