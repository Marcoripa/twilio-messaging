const { app, BrowserWindow, ipcMain  } = require('electron');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
const PORT = process.env.PORT;

const expressApp = require('./server/index'); 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Points to a preload script if you need to bridge Node APIs to Angular
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isPackaged = app.isPackaged;

  // In Dev: dist/twilio-messaging/browser/index.html
  // In Prod: browser/index.html (because of the mapping above)
  const indexPath = isPackaged
    ? path.join(__dirname, 'browser/index.html')
    : path.join(__dirname, 'dist/twilio-messaging/browser/index.html');

  mainWindow.loadFile(indexPath).catch((err) => {
    // If it fails, this will tell us exactly where it looked
    console.error('Path attempted:', indexPath);
    console.error('Error:', err);
  });


  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}


app.on('ready', () => {
  expressApp.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });

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