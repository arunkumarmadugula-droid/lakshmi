import sharp from "sharp";
import { readdir, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../public/icon.svg", import.meta.url));
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const versionTag = `v${String(packageData.version).replace(/\D/g, "")}`;
const baseTargets = [
  [180, "apple-touch-icon.png"],
  [192, "icon-192.png"],
  [512, "icon-512.png"],
  [512, "icon-maskable-512.png"],
];
const targets = [...baseTargets, ...baseTargets.map(([size, name]) => [size, name.replace(".png", `-${versionTag}.png`)])];

for (const name of await readdir(publicDirectory)) {
  if (/^(?:apple-touch-icon|icon-(?:192|512)|icon-maskable-512)-v\d+\.png$/.test(name) && !name.endsWith(`-${versionTag}.png`)) {
    await unlink(fileURLToPath(new URL(`../public/${name}`, import.meta.url)));
  }
}

for (const [size, name] of targets) {
  await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL(`../public/${name}`, import.meta.url)));
}

console.log(`Generated Lakshmi PWA icons for ${packageData.version}.`);
