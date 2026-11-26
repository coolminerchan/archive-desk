const platform = process.env.OVERFIELD_NATIVE_BRIDGE === '1'
  ? await import('./native-platform.mjs') : await import('electron')
export const { app, BrowserWindow, dialog, ipcMain, shell } = platform
