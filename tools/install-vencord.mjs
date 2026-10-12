// Copies the desktop plugin into a Vencord source checkout as src/userplugins/mxcord.
// The shared core is copied alongside it, so the plugin builds with Vencord's normal build.
//
// Usage: node tools/install-vencord.mjs <path-to-Vencord>
// Then, in the Vencord folder: pnpm build && pnpm inject
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vencord = process.argv[2];
if (!vencord) {
    console.error("Usage: node tools/install-vencord.mjs <path-to-Vencord>");
    process.exit(1);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const userplugins = join(resolve(vencord), "src", "userplugins");
try {
    await stat(join(resolve(vencord), "src", "Vencord.ts"));
} catch {
    console.error(`${vencord} is not a Vencord source checkout`);
    process.exit(1);
}

const target = join(userplugins, "mxcord");
await rm(target, { recursive: true, force: true });
await mkdir(join(target, "core"), { recursive: true });
await cp(join(root, "core"), join(target, "core"), { recursive: true });
for (const file of await readdir(join(root, "desktop"))) {
    const source = await readFile(join(root, "desktop", file), "utf8");
    // In this repository the core sits next to desktop/; in Vencord it is inside the plugin folder.
    await writeFile(join(target, file), source.replaceAll("\"../core/", "\"./core/"));
}
console.log(`Installed Mxcord to ${target}`);
