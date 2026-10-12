// Builds the files served at the plugin URL: dist/index.js and dist/manifest.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("./", import.meta.url);
const meta = JSON.parse(await readFile(new URL("plugin.json", root), "utf8"));
const js = await readFile(new URL("src/index.js", root), "utf8");

// Revenge wraps the source in `return`, so a leading comment would make it return nothing.
if (!/^\s*\(/.test(js)) throw new Error("src/index.js must start with the IIFE");

const manifest = {
    name: meta.name,
    description: meta.description,
    authors: meta.authors,
    main: "index.js",
    // Revenge re-downloads index.js when this changes.
    hash: createHash("sha256").update(js).digest("hex"),
    vendetta: { icon: meta.icon },
};

await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/index.js", root), js);
await writeFile(new URL("dist/manifest.json", root), JSON.stringify(manifest, null, 2));
console.log(`${manifest.name}: ${manifest.hash.slice(0, 12)} (${js.length} bytes)`);
