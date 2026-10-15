import * as THREE from 'three';

// Visual relief, estimated from the existing colour atlas. The input is not
// measured elevation: coastlines, lunar maria and Martian terrain are stylized.
const SURFACES = {
  earth: { gradient: 2.1, normalScale: .7 },
  moon: { gradient: 3.4, normalScale: .85 },
  mars: { gradient: 2.8, normalScale: .8 }
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smoothstep = (start, end, value) => {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

function makeCanvasTexture(image) {
  const texture = new THREE.CanvasTexture(image);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Build tangent-space normal and (for Earth) ocean/land roughness maps from an
 * equirectangular colour texture. Limits generated detail to 768 × 384 pixels
 * so phones do not need the full-resolution albedo again in GPU memory.
 */
export function createSurfaceDetailMaps(id, colorTexture) {
  const config = SURFACES[id];
  const image = colorTexture?.image;
  const sourceWidth = image?.naturalWidth || image?.width;
  const sourceHeight = image?.naturalHeight || image?.height;
  if (!config || !sourceWidth || !sourceHeight) return null;

  const width = Math.min(768, sourceWidth);
  const height = Math.max(2, Math.min(384, Math.round(width * sourceHeight / sourceWidth)));
  const input = document.createElement('canvas');
  input.width = width;
  input.height = height;
  const inputContext = input.getContext('2d', { willReadFrequently: true });
  if (!inputContext) return null;
  inputContext.drawImage(image, 0, 0, width, height);
  const colors = inputContext.getImageData(0, 0, width, height).data;

  const heights = new Float32Array(width * height);
  const oceans = id === 'earth' ? new Float32Array(width * height) : null;
  for (let pixel = 0; pixel < heights.length; pixel++) {
    const index = pixel * 4;
    const red = colors[index];
    const green = colors[index + 1];
    const blue = colors[index + 2];
    const brightness = (red * .299 + green * .587 + blue * .114) / 255;
    if (oceans) {
      // Deep blue water stays smooth; colour-defined land receives mild relief.
      const blueExcess = (blue - Math.max(red, green)) / 255;
      const saturation = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
      const ocean = smoothstep(.012, .115, blueExcess) * smoothstep(.08, .24, saturation);
      oceans[pixel] = ocean;
      heights[pixel] = (1 - ocean) * (.25 + brightness * .48);
    } else {
      heights[pixel] = .12 + brightness * (id === 'moon' ? .82 : .68);
    }
  }

  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const outputContext = output.getContext('2d');
  if (!outputContext) return null;
  const normalPixels = outputContext.createImageData(width, height);
  const roughnessPixels = oceans ? outputContext.createImageData(width, height) : null;

  for (let y = 0; y < height; y++) {
    const previousY = Math.max(0, y - 1);
    const nextY = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const previousX = (x + width - 1) % width;
      const nextX = (x + 1) % width;
      const index = y * width + x;
      const normalX = (heights[y * width + previousX] - heights[y * width + nextX]) * config.gradient;
      const normalY = (heights[previousY * width + x] - heights[nextY * width + x]) * config.gradient;
      const inverseLength = 1 / Math.hypot(normalX, normalY, 1);
      const offset = index * 4;
      normalPixels.data[offset] = Math.round((normalX * inverseLength + 1) * 127.5);
      normalPixels.data[offset + 1] = Math.round((normalY * inverseLength + 1) * 127.5);
      normalPixels.data[offset + 2] = Math.round((inverseLength + 1) * 127.5);
      normalPixels.data[offset + 3] = 255;

      if (roughnessPixels) {
        const roughness = Math.round(255 * (.96 - oceans[index] * .57));
        roughnessPixels.data[offset] = roughness;
        roughnessPixels.data[offset + 1] = roughness;
        roughnessPixels.data[offset + 2] = roughness;
        roughnessPixels.data[offset + 3] = 255;
      }
    }
  }

  outputContext.putImageData(normalPixels, 0, 0);
  const normalMap = makeCanvasTexture(output);
  let roughnessMap = null;
  if (roughnessPixels) {
    const roughnessCanvas = document.createElement('canvas');
    roughnessCanvas.width = width;
    roughnessCanvas.height = height;
    const roughnessContext = roughnessCanvas.getContext('2d');
    if (roughnessContext) {
      roughnessContext.putImageData(roughnessPixels, 0, 0);
      roughnessMap = makeCanvasTexture(roughnessCanvas);
    }
  }
  return { normalMap, roughnessMap, normalScale: config.normalScale };
}
