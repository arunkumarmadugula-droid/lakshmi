import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const worker = await readFile(new URL("sw.js", root), "utf8");

assert.match(html, /Content-Security-Policy/i);
assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) await access(new URL(icon.src, root));
await access(new URL("apple-touch-icon.png", root));
await access(new URL(".nojekyll", root));

const assetsMatch = worker.match(/const ASSETS=(\[[^;]+\]);/);
assert.ok(assetsMatch, "service worker precache list is missing");
const assets = JSON.parse(assetsMatch[1]);
for (const asset of assets) {
  if (asset === "./") continue;
  await access(new URL(asset.replace(/^\.\//, ""), root));
}

console.log(`Verified GitHub Pages build with ${assets.length} offline assets.`);
