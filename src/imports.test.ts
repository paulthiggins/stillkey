import { describe, expect, it } from "vitest";
import { Writer } from "protobufjs/minimal.js";
import { addBatch, parseImport, type Migration } from "./imports";

function exportUri(version: number, batchSize = 1, batchIndex = 0): string {
  const account = Writer.create()
    .uint32(10)
    .bytes(new Uint8Array(20).fill(49))
    .uint32(18)
    .string("demo@example.test")
    .uint32(26)
    .string("Synthetic migration")
    .uint32(32)
    .int32(1)
    .uint32(40)
    .int32(1)
    .uint32(48)
    .int32(2)
    .finish();
  // Match the sample's metadata: a single-part v2 export omits batch_id.
  const payload = Writer.create()
    .uint32(10)
    .bytes(account)
    .uint32(16)
    .int32(version)
    .uint32(24)
    .int32(batchSize)
    .uint32(32)
    .int32(batchIndex)
    .finish();
  return (
    "otpauth-migration://offline?data=" +
    encodeURIComponent(Buffer.from(payload).toString("base64"))
  );
}
function migration(version: number, size = 1, index = 0): Migration {
  const part = parseImport(exportUri(version, size, index));
  if (part.kind !== "migration") throw Error("Expected migration export");
  return part.migration;
}

describe("Google Authenticator export versions", () => {
  it.each([1, 2])(
    "imports a single-part version %i export without a batch ID",
    (version) => {
      const part = migration(version);
      expect(part).toMatchObject({
        version,
        batchSize: 1,
        batchIndex: 0,
        batchId: 0,
        skipped: [],
      });
      expect(part.accounts).toHaveLength(1);
      expect(part.accounts[0]).toMatchObject({
        issuer: "Synthetic migration",
        accountName: "demo@example.test",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secretBase32: "GEYTCMJRGEYTCMJRGEYTCMJRGEYTCMJR",
      });
    },
  );
  it("collects all version 2 batch parts", () => {
    const first = migration(2, 2, 0),
      second = migration(2, 2, 1);
    expect(addBatch([first], second).map((part) => part.batchIndex)).toEqual([
      0, 1,
    ]);
    expect(() => addBatch([first], first)).toThrow("already been scanned");
  });
  it("rejects mixed-version batches", () => {
    expect(() => addBatch([migration(1, 2, 0)], migration(2, 2, 1))).toThrow(
      "different export batch",
    );
  });
  it.each([0, 3, 99])("rejects unsupported export version %i", (version) => {
    expect(() => migration(version)).toThrow(
      "Unsupported Google Authenticator export version",
    );
  });
  it("still validates batch indexes for version 2", () => {
    expect(() => migration(2, 1, 1)).toThrow(
      "Invalid migration batch metadata",
    );
  });
});
