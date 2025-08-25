const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
let win;
function createWindow(){
  win = new BrowserWindow({
    width: 420, height: 220,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false }
  })
  // load dev or production
  const devUrl = 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, 'dist', 'index.html'));

  ipcMain.handle('set-always-on-top', (_, on)=>{ win.setAlwaysOnTop(!!on); return true });
  ipcMain.handle('set-ignore-mouse', (_, on)=>{ win.setIgnoreMouseEvents(!!on, { forward: true }); return true });
}
app.whenReady().then(createWindow)
app.on('window-all-closed', ()=>{ if(process.platform !== 'darwin') app.quit() })