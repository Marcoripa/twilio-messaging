const { app, BrowserWindow, ipcMain  } = require('electron');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(app.getAppPath(), '.env') });
const PORT = process.env.PORT || 5001;

const expressApp = require('./server/index'); 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't show until ready
    icon: path.join(app.getAppPath(), 'public/favicon.ico'),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isPackaged = app.isPackaged;
  const indexPath = isPackaged
    ? path.join(__dirname, 'browser/index.html')
    : path.join(__dirname, 'dist/twilio-messaging/browser/index.html');

  mainWindow.loadFile(indexPath).catch((err) => {
    console.error('Failed to load index.html:', indexPath, err);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!isPackaged) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}


app.on('ready', () => {
  try {
    const server = expressApp.listen(PORT, () => {
      console.log(`[Electron] Express server running on http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      console.error('[Electron] Server failed to start:', err);
    });
  } catch (err) {
    console.error('[Electron] Fatal server error:', err);
  }

  createWindow();
});

ipcMain.on('channel-name', (event, data) => {
  console.log('Data from Angular:', data);

  // Reply back to renderer
  event.sender.send('reply-channel', { status: 'ok', received: data });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});