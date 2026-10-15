/**
 * Offline ETC1-compatible ETC2 RGB8 encoder for this project's opaque atlases.
 *
 * Input: existing local JPGs. Output: KTX2 (native ETC2 blocks + Zstd), with
 * mipmaps and a generated manifest. Requires ffmpeg/ffprobe and Node >= 22.15.
 * No executable or encoding dependency is downloaded by this script.
 *
 * Earth, Moon and Mars intentionally remain JPG so the runtime-generated T02
 * relief can continue to sample the original HTMLImageElement pixels.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import {
  createDefaultContainer, read, write,
  KHR_DF_MODEL_ETC2, KHR_DF_PRIMARIES_BT709, KHR_DF_TRANSFER_SRGB,
  KHR_SUPERCOMPRESSION_ZSTD, VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK
} from 'three/addons/libs/ktx-parse.module.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const atlasRoot = join(root, 'public', 'textures');
const outputRoot = join(atlasRoot, 'ktx2');
const manifestPath = join(root, 'src', 'data', 'compressedTextures.json');
const atlases = [
  'sun', 'mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune',
  'satellites/io', 'satellites/europa', 'satellites/ganymede',
  'satellites/callisto', 'satellites/titan', 'satellites/triton'
];

const modifierTables = [
  [2, 8, -2, -8], [5, 17, -5, -17], [9, 29, -9, -29],
  [13, 42, -13, -42], [18, 60, -18, -60], [24, 80, -24, -80],
  [33, 106, -33, -106], [47, 183, -47, -183]
];
const clamp = value => Math.min(255, Math.max(0, value));

function run(command, args, maxBuffer = 256 * 1024 * 1024) {
  const result = spawnSync(command, args, { cwd: root, maxBuffer });
  if (result.error || result.status !== 0) {
    throw new Error(`${command}: ${result.error?.message || result.stderr?.toString() || 'failed'}`);
  }
  return result.stdout;
}

function decodeJpg(file) {
  const dimensions = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=s=x:p=0', file
  ]).toString().trim().match(/^(\d+)x(\d+)$/);
  if (!dimensions) throw new Error(`Cannot determine dimensions for ${file}`);
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  const bytes = run('ffmpeg', [
    '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo',
    '-pix_fmt', 'rgb24', '-vcodec', 'rawvideo', 'pipe:1'
  ]);
  if (bytes.length !== width * height * 3) throw new Error(`Invalid raw RGB length for ${file}`);

  // JPG TextureLoader uses flipY=true on the HTML image. Compressed textures
  // are uploaded without WebGL's UNPACK_FLIP_Y flag, so invert source rows.
  const reversed = new Uint8Array(bytes.length);
  const stride = width * 3;
  for (let y = 0; y < height; y++) {
    reversed.set(bytes.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return { pixels: reversed, width, height };
}

function packEtc1Block(rgb, width, height, blockX, blockY, buffer, offset) {
  const block = new Uint8Array(48);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = Math.min(blockX * 4 + x, width - 1);
      const py = Math.min(blockY * 4 + y, height - 1);
      const src = (py * width + px) * 3;
      const dst = (y * 4 + x) * 3;
      block[dst] = rgb[src];
      block[dst + 1] = rgb[src + 1];
      block[dst + 2] = rgb[src + 2];
    }
  }

  let bestError = Infinity;
  let bestHigh = 0;
  let bestLow = 0;
  for (let flip = 0; flip < 2; flip++) {
    const halves = [];
    let errorSum = 0;
    for (let half = 0; half < 2; half++) {
      const locations = [];
      const sum = [0, 0, 0];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        if ((flip ? y >> 1 : x >> 1) !== half) continue;
        const index = y * 4 + x;
        locations.push(index);
        const pos = index * 3;
        sum[0] += block[pos];
        sum[1] += block[pos + 1];
        sum[2] += block[pos + 2];
      }
      let best = null;
      // ETC1 individual mode uses two RGB444 endpoints, with signed modifiers.
      // A small luminance search improves quality of smooth orbital textures.
      for (const bias of [-1, 0, 1]) {
        const channels = sum.map(value => Math.max(0, Math.min(15, Math.round(value / 8 / 17) + bias)));
        const base = channels.map(value => value * 17);
        for (let table = 0; table < modifierTables.length; table++) {
          let error = 0;
          let selectors = 0;
          for (const index of locations) {
            const src = index * 3;
            let pixelError = Infinity;
            let selected = 0;
            for (let code = 0; code < 4; code++) {
              const modifier = modifierTables[table][code];
              const dr = block[src] - clamp(base[0] + modifier);
              const dg = block[src + 1] - clamp(base[1] + modifier);
              const db = block[src + 2] - clamp(base[2] + modifier);
              const cost = dr * dr + dg * dg + db * db;
              if (cost < pixelError) { pixelError = cost; selected = code; }
            }
            error += pixelError;
            const columnMajor = (index % 4) * 4 + (index >> 2);
            selectors |= (selected & 1) << columnMajor;
            selectors |= (selected >> 1) << (columnMajor + 16);
          }
          if (!best || error < best.error) best = { error, channels, table, selectors };
        }
      }
      halves.push(best);
      errorSum += best.error;
    }
    if (errorSum < bestError) {
      const [first, second] = halves;
      const [r1, g1, b1] = first.channels;
      const [r2, g2, b2] = second.channels;
      bestError = errorSum;
      bestHigh = ((r1 << 28) | (r2 << 24) | (g1 << 20) | (g2 << 16) |
        (b1 << 12) | (b2 << 8) | (first.table << 5) | (second.table << 2) | flip) >>> 0;
      bestLow = (first.selectors | second.selectors) >>> 0;
    }
  }

  buffer.writeUInt32BE(bestHigh, offset);
  buffer.writeUInt32BE(bestLow, offset + 4);
  return bestError;
}

function encodeLevel(pixels, width, height) {
  const cols = Math.ceil(width / 4);
  const rows = Math.ceil(height / 4);
  const output = Buffer.alloc(cols * rows * 8);
  let error = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      error += packEtc1Block(pixels, width, height, x, y, output, (y * cols + x) * 8);
    }
  }
  return { bytes: output, squaredError: error };
}

function downsample(input, width, height) {
  const nextWidth = Math.max(1, Math.floor(width / 2));
  const nextHeight = Math.max(1, Math.floor(height / 2));
  const output = new Uint8Array(nextWidth * nextHeight * 3);
  for (let y = 0; y < nextHeight; y++) for (let x = 0; x < nextWidth; x++) {
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sourceX = Math.min(width - 1, x * 2 + dx);
        const sourceY = Math.min(height - 1, y * 2 + dy);
        sum += input[(sourceY * width + sourceX) * 3 + channel];
      }
      output[(y * nextWidth + x) * 3 + channel] = Math.round(sum / 4);
    }
  }
  return { pixels: output, width: nextWidth, height: nextHeight };
}

function encodeContainer(image) {
  const container = createDefaultContainer();
  container.vkFormat = VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK;
  container.pixelWidth = image.width;
  container.pixelHeight = image.height;
  container.typeSize = 1;
  container.supercompressionScheme = KHR_SUPERCOMPRESSION_ZSTD;
  container.keyValue.KTXorientation = 'ru';
  container.dataFormatDescriptor[0] = {
    vendorId: 0, descriptorType: 0, versionNumber: 2,
    colorModel: KHR_DF_MODEL_ETC2, colorPrimaries: KHR_DF_PRIMARIES_BT709,
    transferFunction: KHR_DF_TRANSFER_SRGB, flags: 0,
    texelBlockDimension: [3, 3, 0, 0],
    bytesPlane: [8, 0, 0, 0, 0, 0, 0, 0],
    samples: [{
      bitOffset: 0, bitLength: 63, channelType: 0,
      samplePosition: [0, 0, 0, 0], sampleLower: 0, sampleUpper: 255
    }]
  };

  let current = image;
  let encodedSize = 0;
  let baseError = 0;
  while (true) {
    const level = encodeLevel(current.pixels, current.width, current.height);
    if (!container.levels.length) baseError = level.squaredError;
    encodedSize += level.bytes.byteLength;
    const zstd = zstdCompressSync(level.bytes);
    container.levels.push({ levelData: zstd, uncompressedByteLength: level.bytes.length });
    if (current.width === 1 && current.height === 1) break;
    current = downsample(current.pixels, current.width, current.height);
  }
  container.levelCount = container.levels.length;
  const encoded = write(container);
  const parsed = read(encoded);
  if (parsed.vkFormat !== VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK ||
    parsed.pixelWidth !== image.width || parsed.pixelHeight !== image.height ||
    parsed.levelCount !== container.levelCount) throw new Error('KTX2 round-trip failed');
  return {
    encoded,
    encodedSize,
    psnr: 10 * Math.log10(255 * 255 * image.width * image.height * 3 / Math.max(1, baseError)),
    mipLevels: container.levelCount
  };
}

if (typeof zstdCompressSync !== 'function') {
  throw new Error('Node.js with built-in Zstd support is required (Node 22.15+ recommended).');
}

mkdirSync(outputRoot, { recursive: true });
const enabled = [];
const report = [];
for (const id of atlases) {
  const source = join(atlasRoot, `${id}.jpg`);
  if (!existsSync(source)) throw new Error(`Missing source JPG: ${source}`);
  const jpgSize = readFileSync(source).byteLength;
  const decoded = decodeJpg(source);
  const { encoded, encodedSize, psnr, mipLevels } = encodeContainer(decoded);
  const ktxSize = encoded.byteLength;
  // Keep native KTX2 only when it beats the existing JPG in download size
  // and retains adequate colour quality. Avoid GPU wins at a network cost.
  const eligible = psnr >= 27 && ktxSize <= jpgSize * .95;
  const target = join(outputRoot, `${id}.ktx2`);
  if (eligible) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, encoded);
    enabled.push(id);
  } else if (existsSync(target)) rmSync(target);
  report.push({
    id, width: decoded.width, height: decoded.height, jpgBytes: jpgSize,
    ktx2Bytes: ktxSize, gpuEtc2Bytes: encodedSize,
    psnrDb: Number(psnr.toFixed(2)), mipLevels, enabled: eligible
  });
  console.log(`${eligible ? 'ETC2' : 'JPG '} ${id.padEnd(21)} ${jpgSize} -> ${ktxSize} bytes, ${psnr.toFixed(1)} dB`);
}

writeFileSync(manifestPath, JSON.stringify({
  description: 'Native ETC2 / KTX2 atlases pre-encoded offline; fallback JPG for unsupported hardware.',
  format: 'ETC2_RGB8_SRGB_ZSTD', enabled, report
}, null, 2) + '\n');
const adopted = report.filter(entry => entry.enabled);
const jpgTotal = adopted.reduce((sum, row) => sum + row.jpgBytes, 0);
const ktxTotal = adopted.reduce((sum, row) => sum + row.ktx2Bytes, 0);
const gpuTotal = adopted.reduce((sum, row) => sum + row.gpuEtc2Bytes, 0);
const rgbaTotal = adopted.reduce((sum, row) => sum + row.width * row.height * 4 * 4 / 3, 0);
console.log(`Selected ${adopted.length}/${atlases.length} textures; download ${jpgTotal} -> ${ktxTotal} bytes`);
console.log(`Estimated mipmapped ETC2 GPU blocks: ${gpuTotal} vs RGBA8 ~${Math.round(rgbaTotal)} bytes`);
