(function attachZipWriter(root) {
  // Standard CRC-32/ISO-HDLC lookup table (reflected polynomial 0xEDB88320).
  const CRC_TABLE = (function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Fixed DOS date/time for deterministic output (1980-01-01 00:00:00).
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x0021;

  const LOCAL_HEADER_SIGNATURE = 0x04034b50;
  const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
  const EOCD_SIGNATURE = 0x06054b50;
  const GENERAL_PURPOSE_FLAG = 0x0800; // bit 11 = UTF-8 filename.
  const VERSION = 20;

  function buildZip(entries, options) {
    const opts = options || {};
    const dosTime = typeof opts.dosTime === "number" ? opts.dosTime : DOS_TIME;
    const dosDate = typeof opts.dosDate === "number" ? opts.dosDate : DOS_DATE;
    const encoder = new TextEncoder();

    const prepared = (entries || []).map((entry) => {
      const nameBytes = encoder.encode(entry.name);
      const data = entry.data || new Uint8Array(0);
      return {
        nameBytes,
        data,
        crc: crc32(data),
        size: data.length
      };
    });

    // Compute total output size up front.
    let localSize = 0;
    let centralSize = 0;
    for (const item of prepared) {
      localSize += 30 + item.nameBytes.length + item.size;
      centralSize += 46 + item.nameBytes.length;
    }
    const totalSize = localSize + centralSize + 22;

    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);
    let offset = 0;

    function writeU16(value) {
      view.setUint16(offset, value & 0xffff, true);
      offset += 2;
    }
    function writeU32(value) {
      view.setUint32(offset, value >>> 0, true);
      offset += 4;
    }
    function writeBytes(bytes) {
      out.set(bytes, offset);
      offset += bytes.length;
    }

    // Local file headers followed by raw file data.
    for (const item of prepared) {
      item.localOffset = offset;
      writeU32(LOCAL_HEADER_SIGNATURE);
      writeU16(VERSION);
      writeU16(GENERAL_PURPOSE_FLAG);
      writeU16(0); // compression method = store.
      writeU16(dosTime);
      writeU16(dosDate);
      writeU32(item.crc);
      writeU32(item.size); // compressed size.
      writeU32(item.size); // uncompressed size.
      writeU16(item.nameBytes.length);
      writeU16(0); // extra field length.
      writeBytes(item.nameBytes);
      writeBytes(item.data);
    }

    const centralStart = offset;

    // Central directory headers.
    for (const item of prepared) {
      writeU32(CENTRAL_HEADER_SIGNATURE);
      writeU16(VERSION); // version made by.
      writeU16(VERSION); // version needed.
      writeU16(GENERAL_PURPOSE_FLAG);
      writeU16(0); // compression method.
      writeU16(dosTime);
      writeU16(dosDate);
      writeU32(item.crc);
      writeU32(item.size); // compressed size.
      writeU32(item.size); // uncompressed size.
      writeU16(item.nameBytes.length);
      writeU16(0); // extra field length.
      writeU16(0); // file comment length.
      writeU16(0); // disk number start.
      writeU16(0); // internal attributes.
      writeU32(0); // external attributes.
      writeU32(item.localOffset); // relative offset of local header.
      writeBytes(item.nameBytes);
    }

    // End of central directory record.
    writeU32(EOCD_SIGNATURE);
    writeU16(0); // disk number.
    writeU16(0); // disk with central dir.
    writeU16(prepared.length); // entries on this disk.
    writeU16(prepared.length); // total entries.
    writeU32(centralSize); // size of central directory.
    writeU32(centralStart); // offset of central directory.
    writeU16(0); // comment length.

    return out;
  }

  const api = { crc32, buildZip };
  root.NuiiZipWriter = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
