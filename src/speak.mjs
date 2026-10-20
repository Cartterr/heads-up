// Orchestrates one heads-up: stream the line from the voice model into the notch overlay, or play it natively.
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realtime, resolveKey } from './voice.mjs';
import { openNotch } from './notch.mjs';
import { record, recent, describe } from './history.mjs';

const MAX_CHARS = 300; // keeps a runaway agent from burning credits on a speech

export async function speak(text, { notch = true, wait = false, session, ...voice } = {}) {
  text = text.slice(0, MAX_CHARS);
  const key = resolveKey();
  const linkP = (notch ? openNotch() : Promise.resolve(null)).catch(() => null);
  const pcm = []; // kept so we can still speak if the overlay isn't available
  let said = '';
  const context = describe(recent());
  try {
    await realtime(text, {
      key, ...voice, session, context,
      onAudio: (b64) => { pcm.push(Buffer.from(b64, 'base64')); linkP.then((l) => l?.send({ type: 'audio', b64 })); },
      onText: (delta) => { said += delta; linkP.then((l) => l?.send({ type: 'text', delta })); },
    });
  } catch (e) {
    await (await linkP)?.close();
    throw e;
  }
  record({ ts: Date.now(), session, event: text, said: said.trim() });
  const link = await linkP;
  if (!link) return playNative(Buffer.concat(pcm));
  link.send({ type: 'end' });
  if (wait) await link.done;
  await link.close();
}

// Audio-only fallback (no Electron). ponytail: Windows queues parallel speakers with a mutex; mac/linux just overlap.
function playNative(pcm) {
  if (process.platform === 'linux') return spawnSync('aplay', ['-q', '-f', 'S16_LE', '-r', '24000', '-c', '1'], { input: pcm });
  const h = Buffer.alloc(44); // 24 kHz mono 16-bit WAV header
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const wav = join(tmpdir(), 'heads-up-' + process.pid + '.wav');
  writeFileSync(wav, Buffer.concat([h, pcm]));
  try {
    if (process.platform === 'darwin') spawnSync('afplay', [wav]);
    else spawnSync('powershell', ['-NoProfile', '-Command',
      "$m=New-Object Threading.Mutex($false,'heads-up');[void]$m.WaitOne(60000);" +
      "try{(New-Object Media.SoundPlayer $env:W).PlaySync()}finally{$m.ReleaseMutex()}"],
    { env: { ...process.env, W: wav }, windowsHide: true });
  } finally { unlinkSync(wav); }
}
