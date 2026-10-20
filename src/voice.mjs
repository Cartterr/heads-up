// Streams one spoken line from OpenAI's Realtime API: text in, 24 kHz mono PCM16 audio + transcript out.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_MODEL = 'gpt-realtime-2.1';
export const DEFAULT_VOICE = 'marin';
export const PERSONA =
  "You are the voice of the user's AI coding assistant: a warm, foul-mouthed best friend. You get a short heads-up " +
  "about something about to happen on the user's computer, or something that needs them. Say it out loud in ONE " +
  "short sentence (under 18 words) with friendly, affectionate swearing (fuck, shit, damn, hell, ass; never insults " +
  "aimed at the user, no slurs). Keep the real information clear. Answer in the language of the heads-up. Never " +
  "read it verbatim, never add greetings or extra commentary.";

// Key lookup order: HEADSUP_KEY_FILE, OPENAI_API_KEY, ~/.heads-up/key. The key is never logged or echoed.
export function resolveKey(env = process.env) {
  const file = env.HEADSUP_KEY_FILE || (env.OPENAI_API_KEY ? null : join(homedir(), '.heads-up', 'key'));
  if (file) {
    try { return readFileSync(file, 'utf8').trim(); } catch { /* fall through to the error below */ }
  }
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY.trim();
  throw new Error('No OpenAI key: set OPENAI_API_KEY, or HEADSUP_KEY_FILE=<path>, or save it in ~/.heads-up/key');
}

/** Resolves once the full line has streamed. onAudio gets base64 PCM16 chunks, onText gets transcript deltas. */
export function realtime(text, { key, model = DEFAULT_MODEL, voice = DEFAULT_VOICE, persona = PERSONA, onAudio, onText }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=' + encodeURIComponent(model), {
      headers: { Authorization: 'Bearer ' + key },
    });
    const send = (o) => ws.send(JSON.stringify(o));
    let gotAudio = false, gotText = false, finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ws.onerror = ws.onclose = null;
      try { ws.close(); } catch { /* already closed */ }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('timed out talking to the Realtime API')), 25_000);
    ws.onerror = () => finish(new Error('could not reach the Realtime API (bad key, model, or network)'));
    ws.onclose = () => finish(new Error('Realtime API closed the connection early'));
    ws.onmessage = ({ data }) => {
      const e = JSON.parse(data);
      if (e.type === 'session.created') {
        send({ type: 'session.update', session: { type: 'realtime', instructions: persona, output_modalities: ['audio'],
          audio: { output: { voice, format: { type: 'audio/pcm', rate: 24000 } } } } });
        send({ type: 'conversation.item.create', item: { type: 'message', role: 'user',
          content: [{ type: 'input_text', text: 'Heads-up to announce: ' + text }] } });
        send({ type: 'response.create' });
      } else if (/^response\.(output_)?audio\.delta$/.test(e.type)) {
        gotAudio = true; onAudio?.(e.delta);
      } else if (/^response\.(output_)?audio_transcript\.delta$/.test(e.type)) {
        gotText = true; onText?.(e.delta);
      } else if (/^response\.(output_)?audio_transcript\.done$/.test(e.type) && !gotText) {
        gotText = true; onText?.(e.transcript ?? '');
      } else if (e.type === 'error') {
        finish(new Error('Realtime API error: ' + (e.error?.message ?? 'unknown')));
      } else if (e.type === 'response.done') {
        gotAudio ? finish() : finish(new Error('Realtime API returned no audio'));
      }
    };
  });
}
