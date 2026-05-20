import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("platform", {
  os: process.platform,
  arch: process.arch,
})
