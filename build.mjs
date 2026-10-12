// Builds the files served at the plugin URL: the Revenge plugin (index.js, manifest.json)
// and the homepage. The desktop plugin is built by Vencord; see tools/install-vencord.mjs.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("./", import.meta.url);
const meta = JSON.parse(await readFile(new URL("plugin.json", root), "utf8"));

const result = await build({
    entryPoints: [fileURLToPath(new URL("mobile/index.js", root))],
    bundle: true,
    format: "iife",
    globalName: "mxcord",
    target: "es2020",
    charset: "utf8",
    legalComments: "none",
    write: false,
});

// Revenge evaluates the file as `vendetta => { return <file> }`, so it must be a single
// expression that evaluates to the plugin.
const js = result.outputFiles[0].text
    .replace(/^var mxcord = /, "")
    .replace(/;\s*$/, "")
    + ".default\n";
if (!js.startsWith("(")) throw new Error("bundle must start with the IIFE");

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
await copyFile(new URL("site/index.html", root), new URL("dist/index.html", root));
await copyFile(new URL("assets/mxcord-logo.svg", root), new URL("dist/logo.svg", root));
console.log(`${manifest.name}: ${manifest.hash.slice(0, 12)} (${js.length} bytes)`);
