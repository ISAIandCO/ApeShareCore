import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (!entry.name.endsWith(".js")) throw new Error(`Unexpected runtime file: ${file}`);
    const source = await readFile(file, "utf8");
    if (/\b(?:browser|chrome|localStorage|sessionStorage|indexedDB|KumApe|MaxPatrol)\b|event_src\.|kuma-section/.test(source)) throw new Error(`Product dependency in ${file}`);
    if (/\bimport\s*\(/.test(source)) throw new Error(`Dynamic dependency in ${file}`);
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\s+(?:(?:[^;]*?)\sfrom\s*)?["']([^"']+)["']/gm)) {
      const target = path.resolve(path.dirname(file), specifier);
      if (!specifier.startsWith(".") || !target.startsWith(path.join(root, "src") + path.sep)) throw new Error(`Non-local runtime dependency: ${specifier}`);
    }
  }
}
await scan(path.join(root, "src"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
for (const [name, target] of Object.entries(pkg.exports)) {
  if (name === "./package.json" || !target.endsWith(".js")) continue;
  await import(pathToFileURL(path.join(root, target)));
}
console.log("Module boundaries and public entry points verified without browser or DOM globals");
