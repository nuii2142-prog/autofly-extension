const test = require("node:test");
const assert = require("node:assert/strict");

const { crc32, buildZip } = require("../src/shared/zip-writer.js");

const enc = (str) => new TextEncoder().encode(str);

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function indexOfSequence(haystack, needle, start = 0) {
  outer: for (let i = start; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function findEocd(bytes) {
  const sig = [0x50, 0x4b, 0x05, 0x06];
  // EOCD is near the end; comment length is 0 so it is the last 22 bytes.
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (
      bytes[i] === sig[0] &&
      bytes[i + 1] === sig[1] &&
      bytes[i + 2] === sig[2] &&
      bytes[i + 3] === sig[3]
    ) {
      return i;
    }
  }
  return -1;
}

test("crc32 of empty input is 0", () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("crc32 of '123456789' is 0xCBF43926", () => {
  assert.equal(crc32(enc("123456789")), 0xcbf43926);
});

test("crc32 of the quick brown fox is 0x414FA339", () => {
  assert.equal(
    crc32(enc("The quick brown fox jumps over the lazy dog")),
    0x414fa339
  );
});

test("crc32 returns an unsigned 32-bit integer", () => {
  const value = crc32(enc("The quick brown fox jumps over the lazy dog"));
  assert.ok(value >= 0);
  assert.equal(value, value >>> 0);
});

test("buildZip with a single entry produces a valid archive", () => {
  const data = enc("hello");
  const zip = buildZip([{ name: "a.txt", data }]);

  assert.ok(zip instanceof Uint8Array);

  // Starts with local file header signature PK\x03\x04.
  assert.deepEqual(Array.from(zip.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);

  // Contains the EOCD signature PK\x05\x06.
  assert.ok(indexOfSequence(zip, [0x50, 0x4b, 0x05, 0x06]) !== -1);

  // Filename and data appear in the bytes.
  assert.ok(indexOfSequence(zip, Array.from(enc("a.txt"))) !== -1);
  assert.ok(indexOfSequence(zip, Array.from(enc("hello"))) !== -1);

  // EOCD total-entries field = 1.
  const eocd = findEocd(zip);
  assert.notEqual(eocd, -1);
  assert.equal(readUint16LE(zip, eocd + 10), 1);
});

test("buildZip writes correct crc32 and sizes in the local header", () => {
  const data = enc("hello");
  const zip = buildZip([{ name: "a.txt", data }]);

  // Local file header layout: crc32 at offset 14, sizes at 18 and 22.
  assert.equal(readUint32LE(zip, 14), crc32(data));
  assert.equal(readUint32LE(zip, 18), data.length); // compressed size
  assert.equal(readUint32LE(zip, 22), data.length); // uncompressed size
});

test("buildZip with two entries sets EOCD totals and central dir offset", () => {
  const a = { name: "a.txt", data: enc("hello") };
  const b = { name: "second.bin", data: enc("world!!") };
  const zip = buildZip([a, b]);

  const eocd = findEocd(zip);
  assert.notEqual(eocd, -1);

  // entries on this disk and total entries.
  assert.equal(readUint16LE(zip, eocd + 8), 2);
  assert.equal(readUint16LE(zip, eocd + 10), 2);

  // Central directory offset = combined local headers + data.
  const LFH = 30; // fixed local file header size before filename/extra.
  const expectedOffset =
    LFH + enc(a.name).length + a.data.length +
    LFH + enc(b.name).length + b.data.length;

  assert.equal(readUint32LE(zip, eocd + 16), expectedOffset);

  // First entry's local header crc32 and sizes.
  assert.equal(readUint32LE(zip, 14), crc32(a.data));
  assert.equal(readUint32LE(zip, 18), a.data.length);
  assert.equal(readUint32LE(zip, 22), a.data.length);
});
