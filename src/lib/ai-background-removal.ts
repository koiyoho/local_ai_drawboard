import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function getPythonPath() {
  return process.env.BGREMOVE_PYTHON ?? [process.cwd(), ".venv-bgremove", "bin", "python"].join(path.sep);
}

function getScriptPath() {
  return [process.cwd(), "scripts", "remove-background-ai.py"].join(path.sep);
}

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
    const child = spawn(getPythonPath(), [getScriptPath(), inputPath, outputPath], {
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
