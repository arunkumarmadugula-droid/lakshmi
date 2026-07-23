import assert from "node:assert/strict";
import test from "node:test";
import { APP_VERSION, compareVersions } from "../src/lib/version.js";

test("published version comparisons distinguish newer, current, and older builds", () => {
  assert.equal(APP_VERSION, "8.5.2");
  assert.equal(compareVersions("8.5.3", APP_VERSION), 1);
  assert.equal(compareVersions("8.5.2", APP_VERSION), 0);
  assert.equal(compareVersions("8.5.1", APP_VERSION), -1);
});
