import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const distDirectory = path.resolve(process.argv[2] ?? "dist");
const entries = await readdir(distDirectory, {
  recursive: true,
  withFileTypes: true,
});
const JavaScriptFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => path.join(entry.parentPath, entry.name));

if (JavaScriptFiles.length === 0) {
  throw new Error(`No JavaScript assets were found under ${distDirectory}.`);
}

for (const filePath of JavaScriptFiles) {
  const source = await readFile(filePath, "utf8");
  if (/\beval\s*\(/u.test(source)) {
    throw new Error(
      `CSP-unsafe eval() remains in ${path.relative(process.cwd(), filePath)}.`,
    );
  }
}

console.log(
  `Verified ${JavaScriptFiles.length} built JavaScript assets contain no eval().`,
);
