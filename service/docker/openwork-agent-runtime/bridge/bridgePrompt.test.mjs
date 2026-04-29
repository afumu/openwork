import assert from "node:assert/strict";
import { test } from "node:test";

import { getOpenWorkSystemPromptConfig, OPENWORK_GLOBAL_MEMORY } from "./bridgePrompt.mjs";

test("configures Claude Code preset with OpenWork lifecycle instructions", () => {
  const config = getOpenWorkSystemPromptConfig();

  assert.equal(config.type, "preset");
  assert.equal(config.preset, "claude_code");
  assert.match(config.append, /openwork templates --json/);
  assert.match(config.append, /openwork init/);
  assert.match(config.append, /\/workspace/);
});

test("global memory documents OpenWork CLI without workspace files", () => {
  assert.match(OPENWORK_GLOBAL_MEMORY, /OpenWork/);
  assert.match(OPENWORK_GLOBAL_MEMORY, /openwork templates --json/);
  assert.match(OPENWORK_GLOBAL_MEMORY, /openwork init/);
});
