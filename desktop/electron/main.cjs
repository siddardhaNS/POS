// Tiffin Counter: the Electron shell. It opens the counter screen, makes network calls on the screen's behalf (no
// browser cross-site rules, works with any server address), and prints receipts straight to a printer.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: "Tiffin Counter",
    backgroundColor: "#f6f3ee",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const dev = process.env.TIFFIN_DEV_URL;
  if (dev) win.loadURL(dev);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  // Links open in the normal browser, never inside the till.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!dev || !url.startsWith(dev)) e.preventDefault();
  });
}

// Network requests from the counter screen. Only http(s), with a timeout, and the answer comes back as text.
ipcMain.handle("http", async (_e, req) => {
  const { url, method = "GET", headers = {}, body, timeoutMs = 15000 } = req || {};
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return { ok: false, status: 0, text: "", error: "Bad address" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: String(err && err.message ? err.message : err) };
  } finally {
    clearTimeout(t);
  }
});

// Printers on this computer, and silent printing of a receipt / kitchen ticket (HTML) to one of them.
ipcMain.handle("printers", async () => {
  try {
    return (await win.webContents.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault }));
  } catch {
    return [];
  }
});

ipcMain.handle("print", async (_e, { html, printer, widthMm = 80 }) => {
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await pw.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return await new Promise((resolve) => {
      pw.webContents.print(
        { silent: true, printBackground: true, deviceName: printer || undefined, margins: { marginType: "none" },
          pageSize: { width: widthMm * 1000, height: 297000 } },
        (ok, reason) => resolve({ ok, error: ok ? "" : reason || "Couldn't print" }),
      );
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    setTimeout(() => pw.destroy(), 2000);
  }
});

ipcMain.handle("app-info", () => ({ version: app.getVersion(), platform: process.platform }));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
