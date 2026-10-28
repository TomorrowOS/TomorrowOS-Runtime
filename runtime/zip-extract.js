(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  function readU16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32(bytes, offset) {
    return (
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
      0
    );
  }

  function normalizeZipPath(name) {
    const value = String(name || "").replace(/\\/g, "/");
    if (!value || value.endsWith("/")) return null;
    const parts = [];
    for (const part of value.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") return null;
      parts.push(part);
    }
    return parts.length ? parts.join("/") : null;
  }

  function findEocd(bytes) {
    const min = Math.max(0, bytes.length - (65535 + 22));
    for (let i = bytes.length - 22; i >= min; i -= 1) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        return i;
      }
    }
    return -1;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("Compressed packages need DecompressionStream, which this environment does not provide");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extractZip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error("Package is not a valid zip archive");

    const entryCount = readU16(bytes, eocd + 10);
    const centralOffset = readU32(bytes, eocd + 16);
    if (readU32(bytes, eocd + 12) === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64 packages are not supported");
    }

    const files = new Map();
    let cursor = centralOffset;
    const decoder = new TextDecoder("utf-8");

    for (let index = 0; index < entryCount; index += 1) {
      if (readU32(bytes, cursor) !== 0x02014b50) {
        throw new Error("Package central directory is invalid");
      }
      const flags = readU16(bytes, cursor + 8);
      const method = readU16(bytes, cursor + 10);
      const compressedSize = readU32(bytes, cursor + 20);
      const nameLength = readU16(bytes, cursor + 28);
      const extraLength = readU16(bytes, cursor + 30);
      const commentLength = readU16(bytes, cursor + 32);
      const localOffset = readU32(bytes, cursor + 42);
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const rawName = decoder.decode(nameBytes);
      cursor += 46 + nameLength + extraLength + commentLength;

      const path = normalizeZipPath(rawName);
      if (!path) continue;
      if (flags & 1) throw new Error("Encrypted packages are not supported");
      if (method !== 0 && method !== 8) {
        throw new Error(`Unsupported zip compression method ${method}`);
      }
      if (compressedSize === 0xffffffff) throw new Error("ZIP64 packages are not supported");

      if (readU32(bytes, localOffset) !== 0x04034b50) {
        throw new Error("Package local header is invalid");
      }
      const localNameLength = readU16(bytes, localOffset + 26);
      const localExtraLength = readU16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? compressed : await inflateRaw(compressed);
      files.set(path, data);
    }

    return files;
  }

  function findZipEntry(files, entry) {
    const direct = normalizeZipPath(entry);
    if (!direct) return null;
    if (files.has(direct)) return direct;

    const baseName = direct.split("/").pop();
    let best = null;
    for (const key of files.keys()) {
      if (key !== baseName && !key.endsWith(`/${baseName}`)) continue;
      if (!best || key.length < best.length) best = key;
    }
    return best;
  }

  RT.normalizeZipPath = normalizeZipPath;
  RT.extractZip = extractZip;
  RT.findZipEntry = findZipEntry;
})(typeof globalThis !== "undefined" ? globalThis : this);
