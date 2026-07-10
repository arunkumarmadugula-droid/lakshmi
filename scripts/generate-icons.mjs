import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../public/icon.svg", import.meta.url));
const targets = [
  [180, "apple-touch-icon.png"],
  [192, "icon-192.png"],
  [512, "icon-512.png"],
  [512, "icon-maskable-512.png"],
];

for (const [size, name] of targets) {
  await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL(`../public/${name}`, import.meta.url)));
}

console.log("Generated Lakshmi PWA icons.");
