import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../dist/", import.meta.url);
const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const html = await readFile(new URL("index.html", root), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const worker = await readFile(new URL("sw.js", root), "utf8");

assert.match(html, /Content-Security-Policy/i);
assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.equal(manifest.display, "standalone");
const manifestHref = html.match(/rel=["']manifest["'][^>]+href=["']([^"']+)["']/i)?.[1];
assert.ok(manifestHref, "manifest link is missing");
assert.doesNotMatch(manifestHref, /\/assets\//, "manifest must stay at the app root so its relative start URL cannot resolve to an assets folder");
const documentUrl = new URL("https://example.test/lakshmi/");
const manifestUrl = new URL(manifestHref, documentUrl);
const deploymentRoot = new URL(".", manifestUrl);
assert.equal(new URL(manifest.start_url, manifestUrl).pathname, "/lakshmi/", "manifest start URL must resolve to the GitHub Pages project root");
for (const icon of manifest.icons) await access(new URL(icon.src, root));
const appleIcon = html.match(/rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i)?.[1];
assert.ok(appleIcon, "apple touch icon link is missing");
const appleWebUrl = new URL(appleIcon, documentUrl);
assert.ok(appleWebUrl.pathname.startsWith(deploymentRoot.pathname), "apple touch icon must remain inside the deployed app root");
await access(new URL(appleWebUrl.pathname.slice(deploymentRoot.pathname.length), root));
await access(new URL(".nojekyll", root));
assert.match(worker, new RegExp(`lakshmi-v${packageData.version.replaceAll(".", "-")}-`));

const assetsMatch = worker.match(/const ASSETS=(\[[^;]+\]);/);
assert.ok(assetsMatch, "service worker precache list is missing");
const assets = JSON.parse(assetsMatch[1]);
for (const asset of assets) {
  if (asset === "./") continue;
  await access(new URL(asset.replace(/^\.\//, ""), root));
}

console.log(`Verified GitHub Pages build with ${assets.length} offline assets.`);
