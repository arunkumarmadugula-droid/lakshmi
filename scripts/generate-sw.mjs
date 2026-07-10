import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const root = new URL("../dist/", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(.:\/)/, "$1");

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "sw.js") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

const files = await filesUnder(rootPath);
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const cacheName = `lakshmi-v7-${hash.digest("hex").slice(0, 12)}`;
const assets = files.map((file) => `./${relative(rootPath, file).replaceAll("\\", "/")}`);
assets.unshift("./");

const source = `const CACHE=${JSON.stringify(cacheName)};
const ASSETS=${JSON.stringify(assets)};
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(!response||response.status!==200||response.type==="opaque")return response;const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});return response;})).catch(()=>event.request.mode==="navigate"?caches.match("./index.html"):Response.error()));});
`;

await writeFile(join(rootPath, "sw.js"), source);
console.log(`Generated ${cacheName} with ${assets.length} assets.`);
