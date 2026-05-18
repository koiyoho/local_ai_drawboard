import { readFileSync } from "node:fs";

const layout = readFileSync("src/app/layout.tsx", "utf8");

if (layout.includes("next/font/google")) {
  throw new Error("src/app/layout.tsx must not depend on next/font/google");
}

console.log("No next/font/google dependency found");
