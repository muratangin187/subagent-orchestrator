const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  createReport: (html) => ipcRenderer.invoke("create-report", html),
  releaseReport: (url) => ipcRenderer.invoke("release-report", url),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  microphoneAccess: () => ipcRenderer.invoke("microphone-access"),
  connection: () => ipcRenderer.invoke("connection"),
  connectLocal: () => ipcRenderer.invoke("connect-local"),
  importConnection: () => ipcRenderer.invoke("import-connection"),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  request: (path, body) => ipcRenderer.invoke("request", path, body),
  openLink: (url) => ipcRenderer.invoke("open-link", url),
  saveAttachment: (id, automatic = false) =>
    ipcRenderer.invoke("save-attachment", id, automatic),
  openAttachment: (id) => ipcRenderer.invoke("open-attachment", id),
  notify: (id) => ipcRenderer.invoke("notify", id),
  onCommand: (fn) => {
    const cb = (_, cmd) => fn(cmd);
    ipcRenderer.on("command", cb);
    return () => ipcRenderer.removeListener("command", cb);
  },
});
