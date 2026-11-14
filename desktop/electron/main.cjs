// Tiffin Counter: the desktop app.
// - Online: the window shows the full Tiffin POS website (every feature, always up to date) and prints silently.
// - Offline: it switches to the billing screen packaged with the app, which uses the sign-in, menu, prices and taxes
//   saved while online, queues sales, and switches back once they've been sent.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config.cjs");

let win = null;
let mode = null; // "full" | "counter"
let misses = 0;
let lastBoot = 0;
const CACHE = () => path.join(app.getPath("userData"), "tiffin-cache.json");

/* ---------- Saved sign-in and menu (what offline billing runs on) ---------- */

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE(), "utf8")); } catch { return {}; }
}
function writeCache(patch) {
  const next = { ...readCache(), ...patch };
  fs.writeFileSync(CACHE(), JSON.stringify(next));
  return next;
}

async function reachable() {
  try {
    const r = await fetch(`${cfg.api}/health`, { signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** While the full POS is showing: copy its sign-in, and refresh the offline menu every 5 minutes. */
async function capture() {
  if (mode !== "full" || !win) return;
  try {
    const raw = await win.webContents.executeJavaScript(
      "JSON.stringify({ device: localStorage.getItem('tiffin.device'), staff: localStorage.getItem('tiffin.session') })", true);
    const { device, staff } = JSON.parse(raw);
    const d = device ? JSON.parse(device) : null;
    const s = staff ? JSON.parse(staff) : null;
    if (!d || !d.tenant) return;
    writeCache({ device: d, staff: s && s.tenant && s.tenant.id === d.tenant.id ? s : null });
    if (Date.now() - lastBoot > 5 * 60_000) {
      const token = (s && s.token) || d.token;
      const r = await fetch(`${cfg.api}/counter/bootstrap`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      if (r.ok) {
        writeCache({ boot: { ...(await r.json()), fetched_at: new Date().toISOString() } });
        lastBoot = Date.now();
      }
    }
  } catch { /* page still loading, or not signed in yet */ }
}

/* ---------- Windows ---------- */

function makeWindow(preload) {
  const w = new BrowserWindow({
    width: 1366, height: 860, minWidth: 1024, minHeight: 680, title: "Tiffin Counter", backgroundColor: "#f6f3ee",
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, preload), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(cfg.web)) shell.openExternal(url);
    return { action: "deny" };
  });
  return w;
}

function swap(next) {
  const old = win;
  win = next;
  if (old) {
    const b = old.getBounds();
    next.setBounds(b);
    if (old.isMaximized()) next.maximize();
  }
  next.once("ready-to-show", () => { next.show(); if (old && !old.isDestroyed()) old.destroy(); });
  next.on("closed", () => { if (win === next) { win = null; app.quit(); } });
}

function openFull() {
  console.log("[tiffin] full POS:", `${cfg.web}/pos`);
  mode = "full";
  misses = 0;
  const w = makeWindow("web-preload.cjs");
  // Stay on the Tiffin site; anything else opens in the normal browser.
  w.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(cfg.web)) { e.preventDefault(); shell.openExternal(url); }
  });
  w.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && mode === "full") openCounter(`Couldn't open ${url}`); // -3 = navigation aborted
  });
  w.webContents.on("did-finish-load", () => { console.log("[tiffin] loaded", w.webContents.getURL()); setTimeout(capture, 3000); });
  swap(w);
  w.loadURL(`${cfg.web}/pos`);
}

function openCounter() {
  console.log("[tiffin] offline billing");
  mode = "counter";
  const w = makeWindow("preload.cjs");
  w.webContents.on("will-navigate", (e, url) => {
    if (!process.env.TIFFIN_DEV_URL || !url.startsWith(process.env.TIFFIN_DEV_URL)) e.preventDefault();
  });
  swap(w);
  if (process.env.TIFFIN_DEV_URL) w.loadURL(process.env.TIFFIN_DEV_URL);
  else w.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

/** Every 15 s: is the server there? Two misses in a row while on the full POS switch to offline billing; the offline
 * screen is told when it's back (it switches back itself once its sales are sent and no bill is open). */
async function watch() {
  const ok = await reachable();
  if (mode === "full") {
    misses = ok ? 0 : misses + 1;
    if (misses >= 2) openCounter();
    else if (ok) await capture();
  } else if (mode === "counter" && win) {
    win.webContents.send("server-online", ok);
  }
}

/* ---------- Bridge handlers ---------- */

// Network calls for the offline screen (only to the Tiffin API).
ipcMain.handle("http", async (_e, req) => {
  const { url, method = "GET", headers = {}, body, timeoutMs = 15000 } = req || {};
  if (typeof url !== "string" || !url.startsWith(cfg.api + "/")) return { ok: false, status: 0, text: "", error: "Not a Tiffin address" };
  try {
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("save-printer", (_e, p) => { writeCache({ printer: { name: String(p?.name || ""), widthMm: Number(p?.widthMm) || 80 } }); return true; });
ipcMain.handle("cached", () => ({ ...readCache(), apiUrl: cfg.api, webUrl: cfg.web }));
ipcMain.handle("go-full", async () => {
  if (await reachable()) { openFull(); return true; }
  return false;
});

ipcMain.handle("printers", async () => {
  try { return (await win.webContents.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault })); } catch { return []; }
});

ipcMain.handle("print", async (_e, { html, printer, widthMm = 80 }) => {
  if (typeof html !== "string" || html.length > 2_000_000) return { ok: false, error: "Nothing to print" };
  const saved = readCache().printer || {};
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await pw.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return await new Promise((resolve) => {
      pw.webContents.print(
        { silent: true, printBackground: true, deviceName: printer || saved.name || undefined, margins: { marginType: "none" },
          pageSize: { width: (widthMm || saved.widthMm || 80) * 1000, height: 297000 } },
        (ok, reason) => resolve({ ok, error: ok ? "" : reason || "Couldn't print" }),
      );
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    setTimeout(() => pw.destroy(), 2000);
  }
});

ipcMain.handle("app-info", () => ({ version: app.getVersion(), platform: process.platform, mode }));

/* ---------- Start ---------- */

app.whenReady().then(async () => {
  if (process.env.TIFFIN_COUNTER_ONLY) openCounter(); // developing the offline screen on its own
  else if (await reachable()) openFull();
  else openCounter();
  setInterval(watch, 15_000);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
