import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

// Maps an agent's hook payload to [debounce key, heads-up text]. Add one function per agent; anything else can
// simply call `heads-up "text"` from a shell.

/** Claude Code hook JSON (PreToolUse / Notification) -> [key, text]. */
export function claudeCode(h) {
  const tool = h.tool_name ?? '', action = h.tool_input?.action;
  if (h.hook_event_name === 'Notification') return ['need', 'The agent needs you: ' + (h.message ?? 'attention please')];
  if (tool === 'AskUserQuestion') return ['need', 'The agent is asking you a question and needs an answer'];
  if (/screenshot|snapshot/i.test(tool) || action === 'screenshot') return ['screen', 'About to take a screenshot of your screen'];
  if (/gif_creator|record/i.test(tool)) return ['screen', 'About to record your screen'];
  return ['screen', 'About to take over your mouse and keyboard to use the computer'];
}

export const adapters = { 'claude-code': claudeCode };

// The last "customTitle" in a Claude Code transcript is the session's title as shown in the app.
export const lastTitle = (text) => {
  const i = text.lastIndexOf('"customTitle":"');
  if (i < 0) return null;
  try { return JSON.parse('"' + text.slice(i + 15).match(/^(?:[^"\\]|\\.)*/)[0] + '"'); } catch { return null; }
};

/** {id, title} of the Claude Code session behind a hook payload or, for plain calls, the CLAUDE_CODE_SESSION_ID env var. */
export function claudeSession(payload = {}, env = process.env) {
  const id = payload.session_id ?? env.CLAUDE_CODE_SESSION_ID;
  if (!id) return null;
  let file = payload.transcript_path;
  if (!file || !existsSync(file)) {
    const root = join(homedir(), '.claude', 'projects');
    try { file = readdirSync(root).map((d) => join(root, d, id + '.jsonl')).find(existsSync); } catch { file = null; }
  }
  let title = null;
  if (file) {
    try { // the title is usually near the end; fall back to the whole file (capped) if it is not
      const size = statSync(file).size, n = Math.min(size, 1 << 20), buf = Buffer.alloc(n), fd = openSync(file, 'r');
      readSync(fd, buf, 0, n, size - n); closeSync(fd);
      title = lastTitle(buf.toString('utf8')) ?? (size <= 64 << 20 ? lastTitle(readFileSync(file, 'utf8')) : null);
    } catch { /* fall through to the folder name */ }
  }
  return { id, title: title ?? basename(payload.cwd ?? process.cwd()) };
}

export const sessions = { 'claude-code': claudeSession };
