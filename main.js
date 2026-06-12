const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Start the existing Express API server
require('./server.js');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        title: "NetDash - Network Dashboard",
        icon: path.join(__dirname, 'icon.ico'), // Optional icon
        autoHideMenuBar: true, // Hides the top menu bar to make it look native and clean
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // We wait a tiny bit to ensure the express server is bound to port 3000
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 500);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
