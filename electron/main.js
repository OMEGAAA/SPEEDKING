// スピード王計測アプリ (Electron メインプロセス)
// witty-display.html を単体ウィンドウで表示し、WebHID で Witty タイマーと通信する。

const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const WITTY_VENDOR_ID = 0x16d0;  // Microgate Witty (タイマー本体/光電管 共通)
const WITTY_TIMER_PID = 0x0de1;  // タイマー本体 "WITTY01" (計測開始コマンドを受け付けるのはこちら)

function setupWebHid(ses) {
  // requestDevice() のデバイス選択: Witty を自動選択し、選択ダイアログを出さない
  // 光電管(PID 0x06BE)も同じVIDで列挙されるため、タイマー本体を優先する
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const wittys = details.deviceList.filter((d) => d.vendorId === WITTY_VENDOR_ID);
    const witty = wittys.find((d) => d.productId === WITTY_TIMER_PID) || wittys[0];
    callback(witty ? witty.deviceId : undefined);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'hid') return true;
    if (permission === 'media') return !details?.mediaType || details.mediaType === 'video';
    return false;
  });

  // ローカル画面からのWebカメラ映像のみ許可する。マイク音声は録音しない。
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'media') return callback(false);
    const mediaTypes = details?.mediaTypes || [];
    callback(mediaTypes.length === 0 || (mediaTypes.includes('video') && !mediaTypes.includes('audio')));
  });

  // 再起動・再列挙後も許可を維持する (connect イベントでの自動再接続に必要)
  ses.setDevicePermissionHandler((details) => {
    return details.deviceType === 'hid' && details.device.vendorId === WITTY_VENDOR_ID;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: '#07090c',
  });
  win.loadFile(path.join(__dirname, '..', 'witty-display.html'));
}

app.whenReady().then(() => {
  setupWebHid(session.defaultSession);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
