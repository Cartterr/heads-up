// Overlay host: one transparent, click-through window pinned to the top-centre of the primary display.
// It only ever loads the local index.html (no remote content), so the renderer may use Node for the socket and audio.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const W = 760, H = 300; // window is a fixed transparent stage; the notch is drawn inside it and never exceeds it
let win;

if (!app.requestSingleInstanceLock()) app.quit(); // a second daemon would fight over the pipe
else {
  app.dock?.hide();
  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: W, height: H, show: false, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.loadFile(join(__dirname, 'index.html'));
  });
}

ipcMain.on('show', () => {
  const b = screen.getPrimaryDisplay().bounds; // re-read every time: the user may have changed their main display
  win.setBounds({ x: Math.round(b.x + (b.width - W) / 2), y: b.y, width: W, height: H });
  win.showInactive();
});
ipcMain.on('hide', () => win.hide());
ipcMain.on('quit', () => app.quit());
let snapping = false; // frames arriving while a capture is in flight are dropped
ipcMain.on('snap', async (_e, file) => { // HEADSUP_DEBUG_DIR / HEADSUP_RECORD_DIR only
  if (snapping) return;
  snapping = true;
  try { writeFileSync(file, (await win.webContents.capturePage()).toPNG()); } finally { snapping = false; }
});
