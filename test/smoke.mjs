// Offline smoke test: hook mapping and key lookup. Run with `npm test`. Makes no network calls.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { claudeCode, claudeSession, lastTitle } from '../src/adapters.mjs';
import { describe } from '../src/history.mjs';
import { resolveKey } from '../src/voice.mjs';

const { align } = createRequire(import.meta.url)('../overlay/align.cjs');

assert.deepEqual(claudeCode({ hook_event_name: 'Notification', message: 'needs permission' }), ['need', 'The agent needs you: needs permission']);
assert.equal(claudeCode({ tool_name: 'AskUserQuestion' })[0], 'need');
assert.match(claudeCode({ tool_name: 'mcp__x__computer', tool_input: { action: 'screenshot' } })[1], /screenshot/);
assert.match(claudeCode({ tool_name: 'mcp__x__Screenshot' })[1], /screenshot/);
assert.match(claudeCode({ tool_name: 'mcp__x__gif_creator' })[1], /record/);
assert.match(claudeCode({ tool_name: 'mcp__x__Click' })[1], /mouse and keyboard/);

// word timing: 1.0 s of voice, a 0.3 s pause, 1.0 s of voice. The word after the comma must start where the voice resumes.
const hops = Array.from({ length: 230 }, (_, k) => ({ t: k / 100, v: k < 100 || k >= 130 ? 0.01 : 0 }));
const t = align(['Hello', 'there,', 'my', 'friend'], hops);
assert.equal(t[0], 0);
assert.ok(Math.abs(t[2] - 1.3) < 0.011, 'word after the pause starts at 1.3 s, got ' + t[2]);
assert.ok(Math.abs(t[3] - 1.63) < 0.02, 'last word starts at ~1.63 s, got ' + t[3]);
assert.deepEqual(t, [...t].sort((a, b) => a - b));
assert.deepEqual(align(['a', 'b'], hops.map((h) => ({ ...h, v: 0 }))), [0, 0]); // silence must not crash

const dir = mkdtempSync(join(tmpdir(), 'heads-up-test-'));
const file = join(dir, 'key');
writeFileSync(file, '  sk-from-file \n');
assert.equal(resolveKey({ HEADSUP_KEY_FILE: file }), 'sk-from-file');
assert.equal(resolveKey({ OPENAI_API_KEY: 'sk-from-env' }), 'sk-from-env');
assert.equal(resolveKey({ HEADSUP_KEY_FILE: file, OPENAI_API_KEY: 'sk-from-env' }), 'sk-from-file'); // explicit file wins
assert.equal(resolveKey({ HEADSUP_KEY_FILE: join(dir, 'missing'), OPENAI_API_KEY: 'sk-from-env' }), 'sk-from-env');
assert.throws(() => resolveKey({ HEADSUP_KEY_FILE: join(dir, 'missing') }), /No OpenAI key/);
rmSync(dir, { recursive: true });

// session titles: the last customTitle in a transcript wins, with escapes decoded; no transcript falls back to the folder name
const transcript = join(mkdtempSync(join(tmpdir(), 'heads-up-test-')), 's.jsonl');
writeFileSync(transcript, '{"type":"custom-title","customTitle":"Old name"}\n{"type":"x"}\n{"type":"custom-title","customTitle":"Fix \\"notch\\" lag"}\n');
assert.equal(lastTitle(readFileSync(transcript, 'utf8')), 'Fix "notch" lag');
assert.equal(claudeSession({ session_id: 'abc', transcript_path: transcript }).title, 'Fix "notch" lag');
assert.equal(claudeSession({ session_id: 'no-such-session', cwd: 'C:\\work\\my-app' }).title, 'my-app');
assert.equal(claudeSession({}, {}), null);

// history block for the model: relative times, session titles, quiet events marked
const now = 1_000_000_000;
const block = describe([{ ts: now - 20_000, session: 'A', event: 'screenshot', said: 'say cheese' }, { ts: now - 5 * 60_000, event: 'mouse', silent: true }], now);
assert.match(block, /20 s ago, session "A": screenshot -> you said: "say cheese"/);
assert.match(block, /5 min ago: mouse \(you stayed quiet\)/);
assert.equal(describe([], now), '');

console.log('smoke test passed');
