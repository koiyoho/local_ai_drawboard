import sharp from "sharp";

type Rgb = { r: number; g: number; b: number };

const DEFAULT_TOLERANCE = 42;
const DEFAULT_EDGE_SAMPLE_STEP = 4;

export async function removePureColorBackground(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const background = sampleEdgeBackgroundColor(data, info.width, info.height, info.channels);
  const output = Buffer.from(data);
  const visited = new Uint8Array(info.width * info.height);
  const queue: Array<[number, number]> = [];

  function enqueue(x: number, y: number) {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
    const pixelIndex = y * info.width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;
    queue.push([x, y]);
  }

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, info.height - 1);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(0, y);
    enqueue(info.width - 1, y);
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const [x, y] = queue[cursor];
    cursor += 1;
    const offset = (y * info.width + x) * info.channels;
    if (!isNearBackground(data, offset, background, DEFAULT_TOLERANCE)) continue;

    output[offset + 3] = 0;
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  featherAlphaEdges(output, info.width, info.height, info.channels);

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

function sampleEdgeBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): Rgb {
  const samples: Rgb[] = [];

  function sample(x: number, y: number) {
    const offset = (y * width + x) * channels;
    samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
  }

  for (let x = 0; x < width; x += DEFAULT_EDGE_SAMPLE_STEP) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += DEFAULT_EDGE_SAMPLE_STEP) {
    sample(0, y);
    sample(width - 1, y);
  }

  return {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function isNearBackground(data: Buffer, offset: number, background: Rgb, tolerance: number) {
  const distance = Math.sqrt(
    (data[offset] - background.r) ** 2 +
      (data[offset + 1] - background.g) ** 2 +
      (data[offset + 2] - background.b) ** 2,
  );
  return distance <= tolerance;
}

function featherAlphaEdges(data: Buffer, width: number, height: number, channels: number) {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      alpha[y * width + x] = data[(y * width + x) * channels + 3];
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixelIndex = y * width + x;
      if (alpha[pixelIndex] !== 255) continue;
      const hasTransparentNeighbor =
        alpha[pixelIndex - 1] === 0 ||
        alpha[pixelIndex + 1] === 0 ||
        alpha[pixelIndex - width] === 0 ||
        alpha[pixelIndex + width] === 0;
      if (hasTransparentNeighbor) {
        data[pixelIndex * channels + 3] = 220;
      }
    }
  }
}
