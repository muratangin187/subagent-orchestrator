const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  microphoneAccess: () => ipcRenderer.invoke("microphone-access"),
  connection: () => ipcRenderer.invoke("connection"),
  connectLocal: () => ipcRenderer.invoke("connect-local"),
  importConnection: () => ipcRenderer.invoke("import-connection"),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  request: (path, body) => ipcRenderer.invoke("request", path, body),
  openLink: (url) => ipcRenderer.invoke("open-link", url),
  saveAttachment: (id) => ipcRenderer.invoke("save-attachment", id),
  openAttachment: (id) => ipcRenderer.invoke("open-attachment", id),
  notify: (id) => ipcRenderer.invoke("notify", id),
  onCommand: (fn) => {
    const cb = (_, cmd) => fn(cmd);
    ipcRenderer.on("command", cb);
    return () => ipcRenderer.removeListener("command", cb);
  },
});
