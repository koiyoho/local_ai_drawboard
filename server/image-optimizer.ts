export type ImageOptimizationResult = {
  bytes: Buffer;
  mimeType: string;
};

export async function optimizeGeneratedImage(input: {
  bytes: Buffer;
  filename: string;
  log?: { warn: (payload: unknown, message?: string) => void };
  mimeType: string;
}): Promise<ImageOptimizationResult> {
  const endpoint = process.env.IMAGE_OPTIMIZER_URL?.trim();
  const token = process.env.IMAGE_OPTIMIZER_TOKEN?.trim();
  if (!endpoint || !token) return { bytes: input.bytes, mimeType: input.mimeType };

  const form = new FormData();
  const arrayBuffer = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: input.mimeType });
  form.append("file", blob, input.filename);
  appendOptimizerOptions(form);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      body: form,
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
      signal: AbortSignal.timeout(getOptimizerTimeoutMs()),
    });
  } catch (error) {
    input.log?.warn({ err: error }, "image optimization request failed");
    return { bytes: input.bytes, mimeType: input.mimeType };
  }

  if (!response.ok) {
    input.log?.warn({
      body: await readOptimizerError(response),
      status: response.status,
    }, "image optimization returned non-success status");
    return { bytes: input.bytes, mimeType: input.mimeType };
  }

  const optimizedBytes = Buffer.from(await response.arrayBuffer());
  if (optimizedBytes.length === 0) {
    input.log?.warn({ status: response.status }, "image optimization returned empty body");
    return { bytes: input.bytes, mimeType: input.mimeType };
  }

  return {
    bytes: optimizedBytes,
    mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || input.mimeType,
  };
}

function appendOptimizerOptions(form: FormData) {
  form.append("denoise", process.env.IMAGE_OPTIMIZER_DENOISE?.trim() || "soft");
  form.append("strength", process.env.IMAGE_OPTIMIZER_STRENGTH?.trim() || "35");
  form.append("radius", process.env.IMAGE_OPTIMIZER_RADIUS?.trim() || "3");
  const sigma = process.env.IMAGE_OPTIMIZER_SIGMA?.trim();
  if (sigma) form.append("sigma", sigma);
}

function getOptimizerTimeoutMs() {
  const configured = Number(process.env.IMAGE_OPTIMIZER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
}

async function readOptimizerError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}
