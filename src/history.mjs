// A short memory of recent heads-ups (including ones that stayed quiet), fed to the voice model so it can react
// ("darn, the computer again?") instead of repeating itself. Lives in ~/.heads-up/history.jsonl, last 100 lines.
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.heads-up'), FILE = join(DIR, 'history.jsonl');

/** entry: {ts, session, event, said?, silent?} */
export function record(entry) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(FILE, JSON.stringify(entry) + '\n');
  try { // ponytail: trims by rewriting the file; two simultaneous trims could drop one line, which only costs a little context
    const lines = readFileSync(FILE, 'utf8').trim().split('\n');
    if (lines.length > 200) writeFileSync(FILE, lines.slice(-100).join('\n') + '\n');
  } catch { /* history is best effort */ }
}

export function recent(max = 10, withinMs = 2 * 3600_000, now = Date.now()) {
  try {
    return readFileSync(FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => now - e.ts < withinMs).slice(-max);
  } catch { return []; }
}

const ago = (ms) => (ms < 90_000 ? Math.round(ms / 1000) + ' s' : ms < 90 * 60_000 ? Math.round(ms / 60_000) + ' min' : Math.round(ms / 3600_000) + ' h') + ' ago';

/** Text block for the model; '' when there is nothing recent. */
export function describe(entries, now = Date.now()) {
  if (!entries.length) return '';
  const lines = entries.map((e) => `- ${ago(now - e.ts)}${e.session ? `, session "${e.session}"` : ''}: ${e.event}` +
    (e.silent ? ' (you stayed quiet)' : e.said ? ` -> you said: "${e.said}"` : ''));
  return 'Recent heads-ups, oldest first:\n' + lines.join('\n') + '\n';
}
