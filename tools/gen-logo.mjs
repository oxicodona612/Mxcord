// Renders assets/mxcord-logo.svg to a PNG and embeds it in src/index.js.
// Run `npm run logo` after changing the SVG.
import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const SIZE_PX = 64;
const BEGIN = "    // @generated-logo-begin";
const END = "    // @generated-logo-end";

const svg = await readFile(new URL("../assets/mxcord-logo.svg", import.meta.url), "utf8");
const png = new Resvg(svg, { fitTo: { mode: "height", value: SIZE_PX } }).render().asPng();
const block = [
    BEGIN,
    `    const LOGO_PNG_B64 = "${Buffer.from(png).toString("base64")}";`,
    END,
].join("\n");

const target = new URL("../src/index.js", import.meta.url);
const js = await readFile(target, "utf8");
const start = js.indexOf(BEGIN);
const stop = js.indexOf(END);
if (start < 0 || stop < 0) throw new Error("src/index.js is missing the @generated-logo markers");
await writeFile(target, js.slice(0, start) + block + js.slice(stop + END.length));
console.log(`Embedded ${png.length}-byte logo`);
