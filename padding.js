/**
 * OptiPress · padding.js
 * Push an encoded file up to an exact byte budget using metadata that decoders
 * ignore (JPEG comment, PNG tEXt, WebP JUNK, AVIF free box, PDF comment, GIF
 * comment, SVG comment). Pure bytes in, pure bytes out — testable in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OptiPadding = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function ascii(text) {
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  function readAscii(bytes, start, length) {
    var text = '';
    for (var i = 0; i < length; i++) text += String.fromCharCode(bytes[start + i]);
    return text;
  }

  function concat(parts) {
    var total = 0;
    parts.forEach(function (part) {
      total += part.length;
    });
    var out = new Uint8Array(total);
    var offset = 0;
    parts.forEach(function (part) {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function lastIndexOf(bytes, pattern) {
    for (var i = bytes.length - pattern.length; i >= 0; i--) {
      var match = true;
      for (var j = 0; j < pattern.length; j++) {
        if (bytes[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  function setUint32BE(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  function setUint32LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function result(out, added, supported, extra) {
    return {
      bytes: out,
      added: added,
      supported: supported !== false,
      exact: true,
      structural: extra || null
    };
  }

  /** Trailing zeros are tolerated by most decoders but not formally valid. */
  function append(bytes, delta) {
    if (delta <= 0) return result(bytes, 0, true);
    var out = new Uint8Array(bytes.length + delta);
    out.set(bytes);
    return result(out, delta, false);
  }

  function padJpeg(bytes, delta) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return append(bytes, delta);
    if (delta < 4) return append(bytes, delta);

    var segments = 1;
    while (delta - 4 * segments > 65533 * segments) segments++;
    var payloadLeft = delta - 4 * segments;
    var parts = [bytes.subarray(0, 2)];

    for (var i = 0; i < segments; i++) {
      var size = Math.min(65533, payloadLeft);
      payloadLeft -= size;
      var seg = new Uint8Array(4 + size);
      seg[0] = 0xff;
      seg[1] = 0xfe;
      seg[2] = ((size + 2) >>> 8) & 0xff;
      seg[3] = (size + 2) & 0xff;
      seg.fill(0x20, 4);
      parts.push(seg);
    }
    parts.push(bytes.subarray(2));
    return result(concat(parts), delta, true);
  }

  function padPng(bytes, delta) {
    var signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (var i = 0; i < 8; i++) if (bytes[i] !== signature[i]) return append(bytes, delta);
    if (readAscii(bytes, 12, 4) !== 'IHDR') return append(bytes, delta);

    var keyword = 'Comment';
    var overhead = 12 + keyword.length + 1;
    if (delta < overhead) return append(bytes, delta);

    var textLength = delta - overhead;
    var type = ascii('tEXt');
    var data = new Uint8Array(keyword.length + 1 + textLength);
    data.set(ascii(keyword), 0);
    data[keyword.length] = 0;
    data.fill(0x41, keyword.length + 1); // 'A'

    var chunk = new Uint8Array(12 + data.length);
    setUint32BE(chunk, 0, data.length);
    chunk.set(type, 4);
    chunk.set(data, 8);
    var crc = crc32(chunk.subarray(4, 8 + data.length));
    setUint32BE(chunk, 8 + data.length, crc);

    var insertAt = 8 + 25; // signature + IHDR (4 + 4 + 13 + 4)
    var out = concat([bytes.subarray(0, insertAt), chunk, bytes.subarray(insertAt)]);
    return result(out, delta, true);
  }

  function padWebp(bytes, delta) {
    if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
      return append(bytes, delta);
    }
    if (delta < 8) return append(bytes, delta);

    var payload = delta - 8;
    if (payload % 2 === 1) payload -= 1;
    var chunkTotal = 8 + payload;
    var extra = delta - chunkTotal;
    var out = new Uint8Array(bytes.length + delta);
    out.set(bytes, 0);

    var at = bytes.length;
    out.set(ascii('JUNK'), at);
    setUint32LE(out, at + 4, payload);
    // Payload is already zero-filled by the Uint8Array allocation.
    if (extra) out[out.length - 1] = 0;

    setUint32LE(out, 4, out.length - 8);
    return result(out, delta, true, extra ? 'trailing-byte' : null);
  }

  function padIsoBmff(bytes, delta) {
    if (delta < 8) return append(bytes, delta);
    var box = new Uint8Array(delta);
    setUint32BE(box, 0, delta);
    box.set(ascii('free'), 4);
    var out = concat([bytes, box]);
    return result(out, delta, true);
  }

  function padPdf(bytes, delta) {
    if (delta < 3) return append(bytes, delta);
    var eof = lastIndexOf(bytes, ascii('%%EOF'));
    var insertAt = eof >= 0 ? eof : bytes.length;
    var comment = new Uint8Array(delta);
    comment[0] = 0x0a; // newline
    comment[1] = 0x25; // %
    comment.fill(0x41, 2, delta - 1); // A…
    comment[delta - 1] = 0x0a;
    var out = concat([bytes.subarray(0, insertAt), comment, bytes.subarray(insertAt)]);
    return result(out, delta, true);
  }

  function padGif(bytes, delta) {
    var trailer = -1;
    for (var i = bytes.length - 1; i >= 0; i--) {
      if (bytes[i] === 0x3b) {
        trailer = i;
        break;
      }
    }
    if (trailer < 0) return append(bytes, delta);

    var blocks = -1;
    var data = 0;
    for (var b = 1; b <= 255; b++) {
      var candidate = delta - 3 - b;
      if (candidate >= 1 && candidate <= 255 * b) {
        blocks = b;
        data = candidate;
        break;
      }
    }
    if (blocks < 0) return append(bytes, delta);

    var parts = [bytes.subarray(0, trailer), new Uint8Array([0x21, 0xfe])];
    var left = data;
    for (var n = 0; n < blocks; n++) {
      var size = Math.min(255, Math.max(1, left - (blocks - n - 1)));
      left -= size;
      var block = new Uint8Array(1 + size);
      block[0] = size;
      block.fill(0x41, 1);
      parts.push(block);
    }
    parts.push(new Uint8Array([0x00]), bytes.subarray(trailer));
    return result(concat(parts), delta, true);
  }

  function padSvg(bytes, delta) {
    if (delta < 7) return append(bytes, delta);
    var close = lastIndexOf(bytes, ascii('</svg>'));
    var insertAt = close >= 0 ? close : bytes.length;
    var comment = new Uint8Array(delta);
    comment.set(ascii('<!--'), 0);
    comment.fill(0x41, 4, delta - 3);
    comment.set(ascii('-->'), delta - 3);
    var out = concat([bytes.subarray(0, insertAt), comment, bytes.subarray(insertAt)]);
    return result(out, delta, true);
  }

  function padBytes(input, mime, targetBytes) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var target = Math.round(Number(targetBytes) || 0);
    var delta = target - bytes.length;
    if (delta <= 0) {
      return { bytes: bytes, added: 0, supported: true, exact: delta === 0, structural: null };
    }
    if (mime === 'image/jpeg') return padJpeg(bytes, delta);
    if (mime === 'image/png') return padPng(bytes, delta);
    if (mime === 'image/webp') return padWebp(bytes, delta);
    if (mime === 'image/avif' || mime === 'image/heic' || mime === 'image/heif') return padIsoBmff(bytes, delta);
    if (mime === 'application/pdf') return padPdf(bytes, delta);
    if (mime === 'image/gif') return padGif(bytes, delta);
    if (mime === 'image/svg+xml') return padSvg(bytes, delta);
    return append(bytes, delta);
  }

  return {
    crc32: crc32,
    padBytes: padBytes
  };
});
