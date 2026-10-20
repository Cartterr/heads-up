// Overlay host: one transparent, click-through window pinned to the top-centre of the primary display.
// It only ever loads the local index.html (no remote content), so the renderer may use Node for the socket and audio.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const W = 760, H = 300; // window is a fixed transparent stage; the notch is drawn inside it and never exceeds it
let win, rebuild, shown = false;

function makeWindow() {
  win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadFile(join(__dirname, 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit(); // a second daemon would fight over the pipe
else {
  app.dock?.hide();
  app.whenReady().then(() => {
    makeWindow();
    // A transparent window created while the displays are still being set up (right after boot, a hot-plug, a virtual
    // display appearing) can end up visible but never painted. Rebuild it whenever the display setup changes.
    // ponytail: a rebuild drops a line that is mid-speech; displays change rarely enough that this is fine.
    rebuild = () => { win.destroy(); makeWindow(); }; // old first: its renderer owns the pipe
    // Boot: displays and the GPU may still be settling when the daemon starts. If nothing has been shown yet, rebuild once.
    setTimeout(() => { if (!shown) rebuild(); }, 20_000);
    let t;
    for (const e of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(e, () => { clearTimeout(t); t = setTimeout(rebuild, 1500); });
    }
  });
}

app.on('window-all-closed', () => {}); // the daemon outlives its window: a rebuild closes the old one first

ipcMain.on('show', (e) => {
  if (e.sender !== win.webContents) return; // a window being replaced
  const b = screen.getPrimaryDisplay().bounds; // re-read every time: the user may have changed their main display
  win.setBounds({ x: Math.round(b.x + (b.width - W) / 2), y: b.y, width: W, height: H });
  win.showInactive();
  shown = true;
});
ipcMain.on('hide', (e) => { if (e.sender === win.webContents) win.hide(); });
ipcMain.on('quit', () => app.quit());
ipcMain.on('rebuild', () => rebuild?.()); // {type:'reset'} from a client; also handy when testing
let snapping = false; // frames arriving while a capture is in flight are dropped
ipcMain.on('snap', async (_e, file) => { // HEADSUP_DEBUG_DIR / HEADSUP_RECORD_DIR only
  if (snapping) return;
  snapping = true;
  try { writeFileSync(file, (await win.webContents.capturePage()).toPNG()); } finally { snapping = false; }
});
