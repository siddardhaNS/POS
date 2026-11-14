// Bridge for the offline billing screen (packaged with the app): network calls, printing, the sign-in and menu saved
// while the full POS was online, and switching back to the full POS when the internet returns.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tiffin", {
  http: (req) => ipcRenderer.invoke("http", req),
  printers: () => ipcRenderer.invoke("printers"),
  print: (job) => ipcRenderer.invoke("print", job),
  info: () => ipcRenderer.invoke("app-info"),
  cached: () => ipcRenderer.invoke("cached"),
  goFull: () => ipcRenderer.invoke("go-full"),
  savePrinter: (p) => ipcRenderer.invoke("save-printer", p),
  onOnline: (fn) => {
    const h = (_e, v) => fn(v);
    ipcRenderer.on("server-online", h);
    return () => ipcRenderer.removeListener("server-online", h);
  },
});
