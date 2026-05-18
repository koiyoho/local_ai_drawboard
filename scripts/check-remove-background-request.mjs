import { readFile } from "node:fs/promises";

const source = await readFile("src/components/BoardWorkspace.tsx", "utf8");

if (!source.includes('modeLabel: "remove_background"')) {
  throw new Error("remove_background action metadata is missing");
}

if (!source.includes('operation: "remove_background"')) {
  throw new Error("remove-background requests must send an explicit operation flag");
}

if (!source.includes("transparent PNG") || !source.includes("Do not change")) {
  throw new Error("remove-background prompt must explicitly require a transparent PNG and preserve subject colors");
}

console.log("remove-background request check passed");
