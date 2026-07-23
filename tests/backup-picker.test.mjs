import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("encrypted Lakshmi imports remain selectable in the iOS Files picker", async () => {
  const [gate, shell, vault] = await Promise.all([
    readFile(new URL("../src/components/ProfileGate.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Shell.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/vaultDb.js", import.meta.url), "utf8"),
  ]);

  const importPickers = [
    gate.match(/<FileButton[^>]*onFile=\{onImport\}[^>]*>/)?.[0],
    shell.match(/<FileButton[^>]*onFile=\{importBackup\}[^>]*>/)?.[0],
    shell.match(/<FileButton[^>]*onFile=\{receiveUpdate\}[^>]*>/)?.[0],
    shell.match(/<FileButton[^>]*onFile=\{receiveJointUpdate\}[^>]*>/)?.[0],
  ];

  for (const picker of importPickers) {
    assert.ok(picker, "expected encrypted import picker");
    assert.doesNotMatch(picker, /\baccept=/, "custom file imports must not be hidden by iOS type filtering");
  }

  assert.match(vault, /200 \* 1024 \* 1024/);
  assert.match(vault, /not a supported encrypted Lakshmi backup/);
});
