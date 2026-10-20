<h1 align="center">🔔 heads-up</h1>

<p align="center">
  <strong>Your AI agent talks to you before it acts.</strong><br>
  <em>"About to take a screenshot, so get your shit ready." A notch drops from the top of your screen and types along.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square" alt="MIT license">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-3b82f6?style=flat-square" alt="Node 22+">
  <img src="https://img.shields.io/badge/voice-OpenAI%20Realtime-10b981?style=flat-square" alt="OpenAI Realtime voice">
  <img src="https://img.shields.io/badge/notch-499.7%20fps-f59e0b?style=flat-square" alt="499.7 fps measured">
  <img src="https://img.shields.io/badge/works%20with-any%20agent-ec4899?style=flat-square" alt="Works with any agent">
  <img src="https://img.shields.io/badge/tested%20on-Windows%2011-0ea5e9?style=flat-square" alt="Tested on Windows 11">
</p>

<p align="center">
  <img src="docs/hero.gif" width="640" alt="The notch dropping from the top of the screen and typing out a spoken heads-up">
</p>

---

Agents screenshot your screen, record it, grab your mouse and ask for approvals while you're looking at something
else. **heads-up** is one command that makes them say so, out loud, a beat before they do it. The words fade in on
a notch at the top of your main display, just ahead of the voice.

```bash
heads-up --wait "about to record your screen"
```

## ✨ What you get

| | |
|---|---|
| 🗣️ **Live voice** | OpenAI's Realtime API (`gpt-realtime-2.1`). You pass a plain description, the model words it in its own persona, and speech starts streaming in about a second. Friendly and foul-mouthed by default, fully swappable. |
| 🪟 **A buttery notch** | Pure black, flush with the top edge, concave ears, rounded bottom corners. Springs integrated against real frame time: the same motion at 60 Hz, and **499.7 fps average (2.2 ms p99)** on a 499 Hz OLED. |
| ⏱️ **Words before the voice** | Each word fades in about 0.25 s *before* it is spoken, timed on the real audio's pauses. |
| 🔌 **Any agent** | It's a CLI. Claude Code, Codex, Gemini CLI, Aider, OpenCode, cron, shell scripts. A Claude Code hook adapter is built in. |
| 🧠 **It remembers** | It knows what it said recently, and which session said it, so it reacts instead of repeating itself: *"Damn, it's grabbing your mouse again, same shit, different moment."* Session titles are picked up automatically in Claude Code. |
| 🚦 **A queue** | Several agents talking at once never overlap. Lines play one after another, gapless. |
| 🛡️ **Safe by default** | Your key never touches the repo, the overlay loads one local file under a strict CSP, hooks never fail loudly. |

<p align="center">
  <img src="docs/ask.gif" width="640" alt="A longer heads-up wrapping onto two lines in the notch">
</p>

## 🚀 Quick start

Needs Node 22+ and an [OpenAI API key](https://platform.openai.com/api-keys). The notch is built and tested on
Windows 11.

```bash
git clone https://github.com/Cartterr/heads-up.git
cd heads-up
npm install
```

Give it a key, any one of these:

```bash
export OPENAI_API_KEY=sk-...                 # env var
export HEADSUP_KEY_FILE=/path/to/keyfile     # a file containing only the key
mkdir -p ~/.heads-up && echo sk-... > ~/.heads-up/key
```

Say something (the first run downloads Electron, about 100 MB):

```bash
node src/cli.mjs --wait "the build just finished"
```

Optional: `npm link` for a global `heads-up` command.

## 🤖 Plug it into your agent

**Any agent.** Put this in its instructions file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`...):

```md
Before anything that needs me physically (a button to press, a login, a recording, taking over my mouse), run
`heads-up --wait "<one plain sentence with the real details>"`. Never for routine progress.
```

**Claude Code, automatically.** Announce screenshots, computer use, questions and permission prompts with hooks in
`~/.claude/settings.json` (adjust the matcher to your tools):

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "AskUserQuestion|mcp__.*__(Screenshot|Snapshot|Click|Type|computer)",
      "hooks": [{ "type": "command", "command": "node /path/to/heads-up/src/cli.mjs --hook claude-code --wait", "timeout": 25 }]
    }],
    "Notification": [{
      "hooks": [{ "type": "command", "command": "node /path/to/heads-up/src/cli.mjs --hook claude-code", "timeout": 10 }]
    }]
  }
}
```

`--wait` on `PreToolUse` makes the agent hold for the speech, so you really do get ready first. A burst of clicks
announces once (debounced 45 s per kind). The adapter never exits non-zero, so a failure can never block the agent.

Another agent with hooks? Add a function to [`src/adapters.mjs`](src/adapters.mjs) that maps its payload to
`[debounce key, text]`, or just call `heads-up "text"` from its hook.

## 🔁 Always on (survives reboots)

The daemon costs nothing while silent: about 0.5% of one core, a few hundred MB of RAM for the hidden Electron
window, and **zero API tokens**. Only speaking is billed. Start it at logon so the first line is instant:

```powershell
# Windows: a hidden logon task (adjust the paths)
$a = New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument '"C:path	oheads-upsrccli.mjs" --start'
Register-ScheduledTask -TaskName 'heads-up overlay' -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) `
  -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden) -RunLevel Limited
```

`--start` keeps the daemon alive until `--stop`. If it ever dies, the next `heads-up` call restarts it.

## 🎛️ CLI

```
heads-up "<what to say>"
  --wait              block until the line has been spoken (default: returns once the audio is streaming)
  --detach            return immediately and speak in the background
  --debounce key:sec  skip if the same key spoke in the last <sec> seconds (default 45)
  --hook <agent>      read an agent's hook JSON on stdin instead of text (claude-code); debounced, never fails
  --no-notch          audio only, no overlay
  --voice <name>      voice (default marin, env HEADSUP_VOICE)
  --model <id>        Realtime model (default gpt-realtime-2.1, env HEADSUP_MODEL)
  --persona "<text>"  replace the system prompt (env HEADSUP_PERSONA)
  --start             start the overlay daemon now (kept alive until --stop) and exit; run it at logon
  --session "<title>"  which session/agent is speaking, so the voice can tell them apart (env HEADSUP_SESSION)
  --stop              close the overlay daemon
```

Lines are capped at 300 characters. The overlay daemon starts on first use, queues speech and quits itself after 30
idle minutes (`HEADSUP_IDLE_MIN=0` to never quit).

### 🎭 Personas

The default is a warm, foul-mouthed best friend. Prefer something calmer:

```bash
heads-up --persona "You are a polite British butler. Announce the heads-up in one short, courteous sentence." "about to record your screen"
```

## ⚙️ How it works

```
agent ──▶ heads-up CLI ──▶ OpenAI Realtime (WebSocket)
                │              audio + transcript deltas stream back
                ▼
        overlay daemon (Electron, local named pipe)
        queue ▸ gapless Web Audio ▸ spring-driven canvas notch
```

- **Streaming.** The CLI forwards audio and transcript chunks to the daemon as they arrive. The daemon plays them
  back to back on the audio clock, sample-accurate, no gaps.
- **One canvas, no CSS animation.** The notch is redrawn every animation frame. Width and height are springs stepped
  in sub-2 ms slices of real elapsed time, so it renders at whatever your display does.
- **Word timing.** The API gives no word timestamps, so [`overlay/align.cjs`](overlay/align.cjs) works them out from
  the audio: commas, colons and dashes snap to the real pauses in the speech, and inside each phrase words share the
  voiced time by length. Against Whisper word timestamps on 75 words it had about 0.21 s of jitter, so with a 0.25 s
  lead roughly 97% of words appear before they are heard (mean 0.33 s ahead). For roughly the first second, until the
  whole line has arrived, it falls back to a flat 16 characters per second.
- **No Electron?** It falls back to audio only: Windows `SoundPlayer`, macOS `afplay`, Linux `aplay`. Only Windows is
  tested; the notch on macOS and Linux is untested.

### 🧠 Memory and sessions

Every heads-up (and every one the debounce silenced) is logged to `~/.heads-up/history.jsonl` (last 100). The most recent
ten from the past two hours go to the voice model with each new line, so it can tease a repeat or announce something
plainly after a long gap. Claude Code sessions are identified from the hook payload (or `CLAUDE_CODE_SESSION_ID`) and
titled from the session's transcript; other agents pass `--session "<title>"` or set `HEADSUP_SESSION`. The model
nickname-shortens titles and names the session only when it changes. Delete the file to forget everything.

## 🔒 Security and privacy

- The API key is read from your env or a file you point at. It is never logged, printed or sent anywhere except
  OpenAI. The repo ignores `.env`, `*.key` and `openaikey*`.
- The text you pass, what the model says back, session titles and your last ten heads-ups go to OpenAI, and the history stays in `~/.heads-up/` on your machine. Don't pipe secrets through it.
- The daemon listens on a local named pipe (`\\.\pipe\heads-up-<user>` on Windows, a socket in the temp dir
  elsewhere). Any local process of yours can make it speak; that's all it can do.
- The overlay window loads only its own `index.html` under a strict CSP. It has Node access for the socket and
  audio, so never point it at remote content.
- Each line costs a little (Realtime audio output is billed per token; check OpenAI's pricing). Lines are capped at
  300 characters and hook announcements are debounced.

## 🩺 Troubleshooting

- **Nothing plays:** check `~/.heads-up/heads-up.log`.
- **Measure the frame rate:** set `HEADSUP_DEBUG_DIR=<dir>` and speak once. It writes `notch.png` and `stats.json`.
- **Slow the first time:** Electron is downloading. Run any `heads-up --wait "test"` once.
- **Make your own GIFs:** set `HEADSUP_RECORD_DIR=<dir>` to dump timestamped frames, then stitch them with ffmpeg.

## 🧪 Tests

```bash
npm test
```

An offline smoke test covering the hook mapping, key lookup and the word-timing function. Audio and the notch need a
real key and a display, so those are checked by hand.

## 📄 License

MIT. Use it, fork it, make your agents swear at you.
