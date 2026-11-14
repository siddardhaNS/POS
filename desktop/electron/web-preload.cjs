// Bridge for the full Tiffin POS website running inside the desktop app. Deliberately small: printing and app
// info only. The website never gets the network or file access the offline screen has.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tiffinDesktop", {
  print: (job) => ipcRenderer.invoke("print", job),
  printers: () => ipcRenderer.invoke("printers"),
  info: () => ipcRenderer.invoke("app-info"),
});
