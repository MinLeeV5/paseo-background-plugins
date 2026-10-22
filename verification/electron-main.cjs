const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-background-electron-"));
app.setPath("userData", profile);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    useContentSize: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
