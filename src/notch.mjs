// Client for the notch overlay: a small Electron daemon that owns the speakers, the queue and the on-screen notch.
// One socket connection = one utterance. Messages (newline-delimited JSON): {type:'audio',b64} {type:'text',delta} {type:'end'}.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { userInfo, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const user = userInfo().username;
export const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\heads-up-' + user : join(tmpdir(), 'heads-up-' + user + '.sock');
const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'overlay', 'main.cjs');

const tryConnect = () => new Promise((res) => {
  const s = net.connect(PIPE);
  s.once('connect', () => res(s));
  s.once('error', () => res(null));
});

/** Connects to the overlay daemon, starting it if needed. Resolves null when Electron isn't installed or can't start. */
export async function openNotch({ start = true, waitMs = 8000 } = {}) {
  let sock = await tryConnect();
  if (!sock && start) {
    let exe;
    try { exe = (await import('electron')).default; } catch { return null; }
    const env = { ...process.env, HEADSUP_PIPE: PIPE };
    delete env.ELECTRON_RUN_AS_NODE; // set when launched from an Electron host; would turn the overlay into plain Node
    spawn(exe, [MAIN], { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
    for (let i = 0; i < waitMs / 50 && !sock; i++) { // 8 s by default; --start waits longer, a cold boot can be slow
      await new Promise((r) => setTimeout(r, 50));
      sock = await tryConnect();
    }
  }
  if (!sock) return null;
  sock.on('error', () => {});
  let finished; const done = new Promise((r) => (finished = r)); // daemon replies {"type":"done"} when the line has been spoken
  sock.on('close', finished);
  sock.setEncoding('utf8');
  sock.on('data', (d) => d.includes('"done"') && finished());
  return {
    send: (o) => sock.write(JSON.stringify(o) + '\n'),
    done,
    close: () => new Promise((r) => sock.end(r)),
  };
}
