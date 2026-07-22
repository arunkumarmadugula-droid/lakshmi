import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile shell reaches every viewport edge and does not double the iPhone safe area", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const mobile = css.slice(css.indexOf("@media (max-width: 520px)"));
  assert.match(css, /body\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
  assert.match(mobile, /\.app-stage\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
  assert.match(mobile, /\.app-shell\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
  assert.match(mobile, /\.bottom-nav\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;/);
  assert.doesNotMatch(mobile, /bottom:\s*auto;/);
  assert.match(mobile, /calc\(env\(safe-area-inset-bottom\) - 14px\)/);
  assert.doesNotMatch(`${css}\n${main}`, /--app-viewport-height/);
});
