import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(
  join(pdfjsRoot, "legacy", "build", "pdf.worker.min.mjs"),
  join(root, "public", "pdf.worker.min.mjs"),
);
