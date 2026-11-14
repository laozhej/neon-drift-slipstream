// Just enough PNG decoding (8-bit RGB/RGBA, non-interlaced) to measure screenshots.
import { inflateSync } from 'node:zlib';

export function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6) || body[12] !== 0) throw new Error('Unsupported PNG format');
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= channels ? up[i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = (line[i] + predicted) & 255;
    }
  }
  return { width, height, channels, data };
}

// Mean colour and perceptual luminance (0–255) of a rectangle.
export function sample(image, x, y, w = 1, h = 1) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let py = Math.max(0, y); py < Math.min(image.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(image.width, x + w); px++) {
      const i = (py * image.width + px) * image.channels;
      r += image.data[i]; g += image.data[i + 1]; b += image.data[i + 2];
      count++;
    }
  }
  r /= count; g /= count; b /= count;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), luma: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) };
}
