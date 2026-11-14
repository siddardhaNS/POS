// The only bridge between the counter screen and the computer: network calls, printers, printing, app info.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tiffin", {
  http: (req) => ipcRenderer.invoke("http", req),
  printers: () => ipcRenderer.invoke("printers"),
  print: (job) => ipcRenderer.invoke("print", job),
  info: () => ipcRenderer.invoke("app-info"),
});
