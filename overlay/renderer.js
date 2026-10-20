'use strict';
// The notch: queue + gapless audio playback + a spring-driven canvas, all clocked by requestAnimationFrame.
// Every animated value is a spring integrated against the real elapsed frame time (in sub-steps of <= 2 ms), so the
// motion looks the same at 60 Hz and at 500 Hz: it simply gets more frames, up to whatever the display does.
const { ipcRenderer } = require('electron');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { align } = require('./align.cjs');

const PIPE = process.env.HEADSUP_PIPE;
const DEBUG = process.env.HEADSUP_DEBUG_DIR; // set it to get notch.png + stats.json (measured fps) written there
const RECORD = process.env.HEADSUP_RECORD_DIR; // set it to dump timestamped frames (used to make the README GIFs)
const W = 760, H = 300, CX = W / 2;
const FONT = '500 17px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
const LH = 24, PADX = 24, PADY = 13, BARS = 52, TEXT_MAX = 400; // layout, px
const HOLD = 1400, FADE = 220, IDLE_QUIT = 30 * 60_000; // ms
const LEAD = 0.25, HOP = 240, VOICED = 0.01; // word reveal lead (s); 10 ms hop at 24 kHz; RMS above this counts as voice

const cv = document.getElementById('c');
const dpr = window.devicePixelRatio || 1;
cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
const g = cv.getContext('2d');
g.scale(dpr, dpr);

class Spring {
  constructor(v, k, c) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.c = c; }
  step(dt) { this.vel += (this.k * (this.t - this.v) - this.c * this.vel) * dt; this.v += this.vel * dt; }
}
const sw = new Spring(120, 300, 26), sh = new Spring(0, 220, 22); // width / height, a touch of overshoot each

// ---- audio: chunks are scheduled back to back on the audio clock, so playback is gapless and sample-accurate
let ac, an, anBuf;
function audio() {
  if (!ac) {
    ac = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    an = ac.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0; an.connect(ac.destination);
    anBuf = new Uint8Array(an.fftSize);
  }
  if (ac.state !== 'running') ac.resume();
}
function feed(u) {
  while (u.chunks.length) {
    const bin = atob(u.chunks.shift()), n = bin.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { const s = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); f[i] = (s > 32767 ? s - 65536 : s) / 32768; }
    for (let i = 0; i < n; i += HOP) { // 10 ms hops: where each starts and how much of it carries voice (drives word timing)
      const m = Math.min(HOP, n - i);
      let s = 0;
      for (let j = 0; j < m; j++) s += f[i + j] * f[i + j];
      u.hops.push({ t: (u.samples + i) / 24000, v: Math.sqrt(s / m) > VOICED ? m / 24000 : 0 });
    }
    u.samples += n;
    if (DEBUG) u.pcm.push(f);
    const b = ac.createBuffer(1, n, 24000); b.copyToChannel(f, 0);
    const src = ac.createBufferSource(); src.buffer = b; src.connect(an);
    const t = Math.max(ac.currentTime + 0.06, u.nextT); src.start(t);
    if (u.playStart === null) u.playStart = t;
    u.nextT = t + b.duration; u.audioDur += b.duration;
  }
}

// ---- queue: one socket connection = one utterance; they are spoken strictly one after another
const queue = [];
let cur = null, lastActive = Date.now();

function onMsg(u, m) {
  if (m.type === 'quit') return ipcRenderer.send('quit');
  if (!u.queued) { u.queued = true; queue.push(u); pump(); }
  if (m.type === 'audio') u.chunks.push(m.b64);
  else if (m.type === 'text') { u.text += m.delta; u.dirty = true; }
  else if (m.type === 'end') u.ended = true;
}
function pump() {
  lastActive = Date.now();
  if (!cur && queue.length) { cur = queue.shift(); wake(); }
}
if (process.platform !== 'win32') { try { fs.unlinkSync(PIPE); } catch { /* no stale socket */ } }
net.createServer((sock) => {
  const u = { sock, queued: false, text: '', chunks: [], ended: false, audioDur: 0, playStart: null, nextT: 0, finished: false,
    dirty: true, words: [], pos: [], cum: [], shownAt: [], nLines: 1, textW: 0, hops: [], samples: 0, shown: 0, wordT: null, pcm: [] };
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { onMsg(u, JSON.parse(line)); } catch { /* ignore junk */ } }
  });
  sock.on('close', () => { u.ended = true; }); // finished or aborted: no more data either way
  sock.on('error', () => {});
}).listen(PIPE);
setInterval(() => { if (!cur && !queue.length && Date.now() - lastActive > IDLE_QUIT) ipcRenderer.send('quit'); }, 15_000);

// ---- text layout: greedy word wrap, measured once per transcript change
function layout(u) {
  g.font = FONT;
  const sp = g.measureText(' ').width;
  let line = 0, x = 0, maxW = 0, total = 0;
  const toks = [...u.text.matchAll(/(\S+?[—–])(?=\S)|\S+/g)]; // an em dash glued between words ("three—please") ends its word
  u.words = toks.map((m) => m[0]);
  u.cum = [];
  let gap = 0; // space after the previous word (none after a glued dash)
  u.pos = toks.map((m) => {
    const w = m[0], ww = g.measureText(w).width;
    if (x > 0 && x + ww > TEXT_MAX) { maxW = Math.max(maxW, x - gap); line++; x = 0; }
    const p = { w, line, x };
    gap = m[1] !== undefined ? 0 : sp;
    x += ww + gap; total += w.length + 1; u.cum.push(total);
    return p;
  });
  u.nLines = line + 1; u.textW = Math.max(maxW, x - gap, 0); u.dirty = false;
}
// Each word is revealed LEAD seconds before it is heard, so it has finished fading in by the time it is spoken.
function shownCount(u) {
  if (u.finished || u.collapsing) return u.words.length;
  if (u.playStart === null) return 0;
  const el = ac.currentTime - (ac.outputLatency || 0) - u.playStart + LEAD; // where the ear is now, plus the lead
  if (u.ended && u.wordT?.length !== u.words.length) u.wordT = align(u.words, u.hops);
  let n = u.shown;
  if (u.wordT) while (n < u.words.length && u.wordT[n] <= el) n++;
  else while (n < u.words.length && 0.1 + (u.cum[n] - u.words[n].length - 1) / 16 <= el) n++; // still streaming: ~16 chars/s guess
  return (u.shown = n);
}
function dump(u) { // HEADSUP_DEBUG_DIR only: raw audio + our word times, so the timing can be checked against a transcriber
  const f = new Int16Array(u.pcm.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of u.pcm) for (let i = 0; i < c.length; i++) f[o++] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32768)));
  fs.writeFileSync(path.join(DEBUG, 'speech.pcm'), Buffer.from(f.buffer));
  const cps = u.cum[u.cum.length - 1] / u.audioDur; // what the old chars-per-second reveal used
  fs.writeFileSync(path.join(DEBUG, 'align.json'), JSON.stringify({ words: u.words, wordT: u.wordT, lead: LEAD,
    oldT: u.words.map((_, i) => (u.cum[i] - 2) / cps) }, null, 1));
}
function targets(u) {
  if (!u || u.collapsing) return [120, 0];
  if (!u.words.length) return [190, 40]; // thinking: a small pill with a breathing waveform
  return [Math.max(190, u.textW + PADX * 2 + BARS), Math.max(46, u.nLines * LH + PADY * 2)];
}

// ---- draw: pure black notch flush with the top edge, concave "ears" at the top, rounded bottom corners
function notchPath(w, h) {
  const L = CX - w / 2, R = CX + w / 2, rt = Math.min(12, h * 0.4), rb = Math.min(26, h / 2, w / 2), P = Math.PI;
  g.beginPath();
  g.moveTo(L - rt, 0); g.lineTo(R + rt, 0);
  g.arc(R + rt, rt, rt, -P / 2, -P, true);          // right ear (curves into the side wall)
  g.lineTo(R, h - rb);
  g.arc(R - rb, h - rb, rb, 0, P / 2, false);       // bottom right
  g.lineTo(L + rb, h);
  g.arc(L + rb, h - rb, rb, P / 2, P, false);       // bottom left
  g.lineTo(L, rt);
  g.arc(L - rt, rt, rt, 0, -P / 2, true);           // left ear
  g.closePath();
  return L;
}
let level = 0;
function draw(now) {
  g.clearRect(0, 0, W, H);
  if (RECORD) { // a dark gradient so the black notch reads in a recording
    const bg = g.createLinearGradient(0, 0, W, 0); bg.addColorStop(0, '#2b1055'); bg.addColorStop(1, '#0f4c81');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
  } else if (DEBUG) { g.fillStyle = '#6f8fb0'; g.fillRect(0, 0, W, H); } // so the black notch is visible in the debug PNG
  const w = sw.v, h = sh.v;
  if (h < 0.5) return;
  const L = notchPath(w, h);
  g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 24; g.shadowOffsetY = 8; g.fillStyle = '#000'; g.fill(); g.restore();
  g.save(); g.clip();
  const amp = 0.15 + level * 0.85;
  g.fillStyle = 'rgba(255,255,255,.92)';
  for (let i = 0; i < 5; i++) { // waveform bars: level from the real output signal, phase-shifted so they dance
    const bh = 4 + amp * (Math.sin(now * 0.011 * (1 + i * 0.31) + i * 1.9) * 0.5 + 0.5) * 20 * (i % 2 ? 0.8 : 1);
    g.beginPath(); g.roundRect(L + PADX + 6 + i * 7, h / 2 - bh / 2, 3.5, bh, 1.75); g.fill();
  }
  const u = cur;
  if (u && u.words.length) {
    const fade = u.collapsing ? Math.max(0, 1 - (now - u.collapseAt) / FADE) : 1;
    const x0 = L + PADX + BARS, y0 = (h - u.nLines * LH) / 2, n = shownCount(u);
    g.font = FONT; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    for (let i = 0; i < n; i++) {
      u.shownAt[i] ??= now;
      const a = Math.min(1, (now - u.shownAt[i]) / 150), e = 1 - (1 - a) ** 3; // each word eases in, rising 5 px
      g.globalAlpha = e * fade;
      g.fillText(u.pos[i].w, x0 + u.pos[i].x, y0 + (u.pos[i].line + 0.5) * LH + (1 - e) * 5);
    }
    g.globalAlpha = 1;
    u.allShown = n === u.words.length;
  }
  g.restore();
}

// ---- frame loop
let running = false, last = 0, dts = [], lastRec;
function wake() {
  lastActive = Date.now();
  if (running) return;
  running = true; last = performance.now(); dts = [];
  ipcRenderer.send('show');
  requestAnimationFrame(frame);
}
function stats() {
  if (!DEBUG || dts.length < 20) return;
  const s = dts.slice(5).sort((a, b) => a - b), at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  fs.writeFileSync(path.join(DEBUG, 'stats.json'), JSON.stringify({ frames: s.length, avg_fps: 1000 / (s.reduce((a, b) => a + b, 0) / s.length),
    p50_ms: at(0.5), p99_ms: at(0.99), max_ms: s[s.length - 1] }, null, 1));
}
function frame(now) {
  const raw = now - last, dt = Math.min(raw / 1000, 0.05);
  last = now;
  const u = cur;
  if (u) {
    dts.push(raw); lastActive = Date.now();
    audio(); feed(u);
    if (u.dirty) layout(u);
    if (!u.finished && u.ended && !u.chunks.length && (u.playStart === null || ac.currentTime >= u.nextT)) {
      u.finished = true; u.finishedAt = now;
      if (DEBUG && u.wordT) dump(u);
      try { u.sock.write('{"type":"done"}\n'); } catch { /* client already gone */ }
    }
    if (u.finished && !u.collapsing && now - u.finishedAt > HOLD) {
      if (queue.length) { u.sock.end(); cur = null; pump(); } // next line morphs straight in
      else { u.collapsing = true; u.collapseAt = now; }
    }
    if (u.collapsing && sh.v < 0.6) { u.sock.end(); cur = null; }
  }
  [sw.t, sh.t] = targets(cur);
  for (let i = 0, n = Math.ceil(dt / 0.002) || 1; i < n; i++) { sw.step(dt / n); sh.step(dt / n); }

  let lvl = 0;
  if (an && cur && !cur.finished && cur.playStart !== null && ac.currentTime >= cur.playStart) {
    an.getByteTimeDomainData(anBuf);
    let s = 0;
    for (const b of anBuf) { const x = (b - 128) / 128; s += x * x; }
    lvl = Math.min(1, Math.sqrt(s / anBuf.length) * 3.2);
  }
  level += (lvl - level) * (1 - Math.exp(-dt * (lvl > level ? 45 : 10))); // fast attack, slower release
  draw(now);
  if (RECORD && now - (lastRec ?? -1e9) >= 33) { lastRec = now; ipcRenderer.send('snap', path.join(RECORD, 'f_' + Date.now() + '.png')); }

  if (DEBUG && cur && cur.allShown && !cur.snapped && Math.abs(sh.v - sh.t) < 0.5 && Math.abs(sw.v - sw.t) < 0.5) {
    cur.settledAt ??= now;
    if (now - cur.settledAt > 300) { cur.snapped = true; ipcRenderer.send('snap', path.join(DEBUG, 'notch.png')); }
  }
  if (!cur && !queue.length && sh.v < 0.6) { running = false; stats(); ipcRenderer.send('hide'); return; }
  requestAnimationFrame(frame);
}
