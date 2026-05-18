# Local AI Matting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current local pure-color background removal flow to prefer local AI matting while preserving the pure-color remover as fallback.

**Architecture:** Create a project-local Python virtual environment for `rembg`/ONNXRuntime and a small Python CLI that removes backgrounds from an input image into a transparent PNG. Add a TypeScript wrapper that calls this CLI from the existing Next.js API route. Keep the existing `sharp` pure-color remover as an automatic fallback if AI matting is unavailable or fails.

**Tech Stack:** Next.js App Router, TypeScript, Node `child_process`, Python 3.12 virtualenv, `rembg`, `onnxruntime`, Pillow, NumPy, existing `sharp` fallback.

---

## File Structure

- Create `scripts/setup-bgremove-venv.sh`: installs/updates `.venv-bgremove` with Python AI matting dependencies.
- Create `scripts/remove-background-ai.py`: CLI wrapper around `rembg.remove`.
- Create `src/lib/ai-background-removal.ts`: TypeScript wrapper that invokes the Python CLI.
- Modify `src/app/api/assets/[assetId]/remove-background/route.ts`: call AI matting first, fallback to `removePureColorBackground`.
- Modify `scripts/check-background-removal.mjs`: verify route source uses AI-first fallback and optionally smoke-test the Python CLI when env exists.
- Modify `package.json`: add setup/check scripts.

### Task 1: Python AI Matting Environment

**Files:**
- Create: `scripts/setup-bgremove-venv.sh`
- Create: `scripts/remove-background-ai.py`
- Modify: `package.json`

- [ ] **Step 1: Add setup script**

Create `scripts/setup-bgremove-venv.sh` with this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

python3 -m venv .venv-bgremove
.venv-bgremove/bin/python -m pip install --upgrade pip setuptools wheel
.venv-bgremove/bin/python -m pip install rembg onnxruntime pillow numpy

echo "AI background removal environment ready at .venv-bgremove"
```

- [ ] **Step 2: Add Python CLI**

Create `scripts/remove-background-ai.py` with this content:

```python
#!/usr/bin/env python3
import sys
from pathlib import Path

from rembg import remove, new_session


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: remove-background-ai.py <input> <output>", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    output_path.parent.mkdir(parents=True, exist_ok=True)
    session = new_session("u2net")
    output = remove(input_path.read_bytes(), session=session)
    output_path.write_bytes(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Add package scripts**

Modify `package.json` scripts to include:

```json
"setup:bgremove": "bash scripts/setup-bgremove-venv.sh",
"check:bgremove-ai": ".venv-bgremove/bin/python scripts/remove-background-ai.py tmp/background-removal-check/input.png tmp/background-removal-check/ai-output.png"
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm run setup:bgremove
```

Expected: completes with `AI background removal environment ready at .venv-bgremove`.

- [ ] **Step 5: Smoke-test CLI**

Run the existing synthetic image generator first:

```bash
npm run check:background-removal
```

Then run:

```bash
npm run check:bgremove-ai
```

Expected: creates `tmp/background-removal-check/ai-output.png`. The first run may take longer while `rembg` downloads the model.

### Task 2: Node Wrapper and Fallback Contract

**Files:**
- Create: `src/lib/ai-background-removal.ts`
- Modify: `scripts/check-background-removal.mjs`

- [ ] **Step 1: Add failing static check**

Append this block before the final `console.log` in `scripts/check-background-removal.mjs`:

```js
const aiWrapperSource = await readFile("src/lib/ai-background-removal.ts", "utf8");
if (!aiWrapperSource.includes("removeBackgroundWithLocalAi")) {
  throw new Error("AI background removal wrapper must export removeBackgroundWithLocalAi");
}
if (!aiWrapperSource.includes("remove-background-ai.py")) {
  throw new Error("AI wrapper must call scripts/remove-background-ai.py");
}
```

- [ ] **Step 2: Run check to verify it fails**

Run:

```bash
npm run check:background-removal
```

Expected: FAIL because `src/lib/ai-background-removal.ts` does not exist.

- [ ] **Step 3: Implement TypeScript wrapper**

Create `src/lib/ai-background-removal.ts` with this content:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const pythonPath = path.join(process.cwd(), ".venv-bgremove", "bin", "python");
const scriptPath = path.join(process.cwd(), "scripts", "remove-background-ai.py");

export async function removeBackgroundWithLocalAi(input: Buffer) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tldraw-bgremove-"));
  const inputPath = path.join(tempDir, "input.png");
  const outputPath = path.join(tempDir, "output.png");
  try {
    await writeFile(inputPath, input);
    await runPython(inputPath, outputPath);
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function runPython(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(pythonPath, [scriptPath, inputPath, outputPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `AI background removal failed with code ${code}`));
    });
  });
}
```

- [ ] **Step 4: Run check to verify it passes**

Run:

```bash
npm run check:background-removal
```

Expected: PASS with `background removal check passed`.

### Task 3: Route Uses AI First, Sharp Fallback

**Files:**
- Modify: `src/app/api/assets/[assetId]/remove-background/route.ts`
- Modify: `scripts/check-background-removal.mjs`

- [ ] **Step 1: Add failing route static check**

Append this block before the final `console.log` in `scripts/check-background-removal.mjs`:

```js
if (!routeSource.includes("removeBackgroundWithLocalAi")) {
  throw new Error("remove-background route must try local AI matting first");
}
if (!routeSource.includes("removePureColorBackground")) {
  throw new Error("remove-background route must keep pure-color fallback");
}
```

- [ ] **Step 2: Run check to verify it fails**

Run:

```bash
npm run check:background-removal
```

Expected: FAIL because the route does not call `removeBackgroundWithLocalAi` yet.

- [ ] **Step 3: Update route implementation**

Modify `src/app/api/assets/[assetId]/remove-background/route.ts`:

Add import:

```ts
import { removeBackgroundWithLocalAi } from "@/lib/ai-background-removal";
```

Replace:

```ts
const output = await removePureColorBackground(bytes);
```

with:

```ts
let output: Buffer;
try {
  output = await removeBackgroundWithLocalAi(bytes);
} catch (error) {
  console.warn("AI background removal failed; falling back to pure-color removal", error);
  output = await removePureColorBackground(bytes);
}
```

- [ ] **Step 4: Run check to verify it passes**

Run:

```bash
npm run check:background-removal
```

Expected: PASS with `background removal check passed`.

### Task 4: Final Verification and Restart

**Files:**
- No additional source files.

- [ ] **Step 1: Verify local checks**

Run:

```bash
npm run check:background-removal
```

Expected: PASS with `background removal check passed`.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS with `✓ Compiled successfully` and route list including `/api/assets/[assetId]/remove-background`.

- [ ] **Step 4: Restart service**

Run:

```bash
pkill -f "next start --port 3333" || true
pkill -f "next-server" || true
nohup npm run start -- --port 3333 > /tmp/tldraw-ai-board-3333.log 2>&1 &
```

Expected: new `next-server` process listens on port `3333`.

- [ ] **Step 5: Verify service**

Run:

```bash
curl -I http://localhost:3333
```

Expected: `HTTP/1.1 307 Temporary Redirect` with `location: /login`.

## Self-Review

- Spec coverage: covers dependency setup, Python CLI, Node wrapper, route fallback, checks, build, and restart.
- Placeholder scan: no placeholders or vague steps remain.
- Type consistency: `removeBackgroundWithLocalAi(input: Buffer)` returns `Promise<Buffer>` and the route falls back to `removePureColorBackground(input: Buffer)`.
- Scope check: focused only on local AI matting and fallback; no UI changes beyond existing right-click entry are needed.
