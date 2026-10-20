#!/usr/bin/env node
// heads-up: make any AI agent (or script) speak to you out loud, with a notch on screen showing what it says.
import { parseArgs } from 'node:util';
import { readFileSync, statSync, writeFileSync, utimesSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters } from './adapters.mjs';
import { speak } from './speak.mjs';
import { openNotch } from './notch.mjs';

const HELP = `heads-up "<what to say>"   speak a heads-up (the voice model words it in its own persona)

  --wait              block until the line has been spoken (default: returns once the audio is streaming)
  --detach            return immediately and speak in the background
  --debounce key:sec  skip if the same key spoke in the last <sec> seconds (default 45), e.g. --debounce screen:30
  --hook <agent>      read an agent's hook JSON on stdin instead of text (agents: ${Object.keys(adapters).join(', ')}); debounced, never fails
  --no-notch          audio only, no overlay
  --voice <name>      voice (default marin, env HEADSUP_VOICE)
  --model <id>        Realtime model (default gpt-realtime-2.1, env HEADSUP_MODEL)
  --persona "<text>"  replace the system prompt, e.g. a polite butler (env HEADSUP_PERSONA)
  --stop              close the overlay daemon

Key: OPENAI_API_KEY, or HEADSUP_KEY_FILE=<path>, or ~/.heads-up/key`;

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' }, wait: { type: 'boolean' }, detach: { type: 'boolean' }, stop: { type: 'boolean' },
    'no-notch': { type: 'boolean' }, hook: { type: 'string' }, debounce: { type: 'string' },
    voice: { type: 'string' }, model: { type: 'string' }, persona: { type: 'string' },
  },
});

const logDir = join(homedir(), '.heads-up');
const log = (m) => { mkdirSync(logDir, { recursive: true }); appendFileSync(join(logDir, 'heads-up.log'), new Date().toISOString() + ' ' + m + '\n'); };

function debounced(key, seconds) {
  const f = join(tmpdir(), 'heads-up-' + key.replace(/\W/g, '_'));
  try {
    if (Date.now() - statSync(f).mtimeMs < seconds * 1000) return true;
    utimesSync(f, new Date(), new Date());
  } catch { writeFileSync(f, ''); }
  return false;
}

if (v.help) { console.log(HELP); process.exit(0); }
if (v.stop) {
  const link = await openNotch({ start: false });
  link?.send({ type: 'quit' });
  await link?.close();
  process.exit(0);
}

try {
  let text = positionals.join(' '), key = null, seconds = 45;
  if (v.hook) {
    const adapt = adapters[v.hook];
    if (!adapt) throw new Error('unknown agent for --hook: ' + v.hook);
    [key, text] = adapt(JSON.parse(readFileSync(0, 'utf8')));
  } else if (v.debounce) {
    let s; [key, s] = v.debounce.split(':'); seconds = Number(s) || 45;
  }
  if (!text) { console.error(HELP); process.exit(1); }
  if (key && debounced(key, seconds)) process.exit(0);

  const opts = {
    notch: !v['no-notch'], wait: v.wait,
    voice: v.voice ?? process.env.HEADSUP_VOICE, model: v.model ?? process.env.HEADSUP_MODEL, persona: v.persona ?? process.env.HEADSUP_PERSONA,
  };
  if (v.detach || (v.hook && !v.wait)) { // hooks must return instantly unless the agent should wait for the speech
    const pass = ['voice', 'model', 'persona'].flatMap((k) => (v[k] ? ['--' + k, v[k]] : [])).concat(v['no-notch'] ? ['--no-notch'] : []);
    spawn(process.execPath, [fileURLToPath(import.meta.url), ...pass, text], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    process.exit(0);
  }
  await speak(text, opts);
} catch (e) {
  log(e.message);
  if (!v.hook) console.error('heads-up: ' + e.message);
  process.exit(v.hook ? 0 : 1); // a failing hook must never block the agent (exit code 2 would)
}
process.exit(0);
