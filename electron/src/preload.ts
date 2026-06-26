import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openExternal:    (url: string)  => ipcRenderer.invoke("open-external", url),
  saveConfig:      (cfg: unknown) => ipcRenderer.invoke("save-config", cfg),
  startLocalServer:(cfg: unknown) => ipcRenderer.invoke("start-local-server", cfg),
  launch:          (url: string)  => ipcRenderer.invoke("launch", url),
  checkForUpdate:  ()             => ipcRenderer.invoke("check-for-update"),
  installUpdate:   ()             => ipcRenderer.invoke("install-update"),
  getAppVersion:   ()             => ipcRenderer.invoke("get-app-version"),
});
