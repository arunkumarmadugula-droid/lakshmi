import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { analyzeDocument } from "../src/lib/openai.js";

globalThis.File = File;

test("document analysis uses a private low-detail PDF request with structured output", async () => {
  const priorFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        bank: "Example Bank",
        cardName: "Visa",
        last4: "1234",
        statementDate: "2026-07-01",
        dueDate: "2026-07-21",
        statementBalance: 125,
        minimumPayment: 10,
        warnings: [],
      }) }] }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 40 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const pdf = new File(["%PDF synthetic"], "statement.pdf", { type: "application/pdf" });
    const result = await analyzeDocument({ apiKey: "sk-test", prepared: { text: "", mimeType: "application/pdf", analysisFile: pdf }, kind: "card" });
    assert.equal(result.draft.last4, "1234");
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.body.store, false);
    assert.equal(request.body.reasoning.effort, "none");
    assert.equal(request.body.text.format.type, "json_schema");
    assert.equal(request.body.text.format.strict, true);
    const fileInput = request.body.input[1].content.find((item) => item.type === "input_file");
    assert.equal(fileInput.detail, "low");
    assert.match(fileInput.file_data, /^data:application\/pdf;base64,/);
    assert.equal(result.usage.inputTokens, 100);
    assert.ok(result.usage.estimatedUsd > 0);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
