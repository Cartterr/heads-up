// Offline smoke test: hook mapping and key lookup. Run with `npm test`. Makes no network calls.
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCode } from '../src/adapters.mjs';
import { resolveKey } from '../src/voice.mjs';

assert.deepEqual(claudeCode({ hook_event_name: 'Notification', message: 'needs permission' }), ['need', 'The agent needs you: needs permission']);
assert.equal(claudeCode({ tool_name: 'AskUserQuestion' })[0], 'need');
assert.match(claudeCode({ tool_name: 'mcp__x__computer', tool_input: { action: 'screenshot' } })[1], /screenshot/);
assert.match(claudeCode({ tool_name: 'mcp__x__Screenshot' })[1], /screenshot/);
assert.match(claudeCode({ tool_name: 'mcp__x__gif_creator' })[1], /record/);
assert.match(claudeCode({ tool_name: 'mcp__x__Click' })[1], /mouse and keyboard/);

const dir = mkdtempSync(join(tmpdir(), 'heads-up-test-'));
const file = join(dir, 'key');
writeFileSync(file, '  sk-from-file \n');
assert.equal(resolveKey({ HEADSUP_KEY_FILE: file }), 'sk-from-file');
assert.equal(resolveKey({ OPENAI_API_KEY: 'sk-from-env' }), 'sk-from-env');
assert.equal(resolveKey({ HEADSUP_KEY_FILE: file, OPENAI_API_KEY: 'sk-from-env' }), 'sk-from-file'); // explicit file wins
assert.equal(resolveKey({ HEADSUP_KEY_FILE: join(dir, 'missing'), OPENAI_API_KEY: 'sk-from-env' }), 'sk-from-env');
assert.throws(() => resolveKey({ HEADSUP_KEY_FILE: join(dir, 'missing') }), /No OpenAI key/);
rmSync(dir, { recursive: true });

console.log('smoke test passed');
