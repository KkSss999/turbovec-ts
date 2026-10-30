// oxlint-disable unicorn/require-post-message-target-origin
const path = require('node:path');
const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron');

let finished = false;
let run = 0;
let restarting = false;
let requestId = 0;
let worker = null;
const pending = new Map();

function finish(code) {
  if (finished) return;
  finished = true;
  console.log(`SMOKE_EXIT ${code}`);
  app.exit(code);
}

function requestWorker(message) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('worker is not running'));
      return;
    }
    requestId += 1;
    const id = requestId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`worker request ${id} timed out`));
    }, 5000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    worker.postMessage({ id, ...message });
  });
}

function spawnWorker() {
  run += 1;
  console.log(`SMOKE_RUN ${run}`);
  worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'));

  worker.on('spawn', () => worker.postMessage({ type: 'run', run }));
  worker.on('message', (message) => {
    if (message && message.requestId && pending.has(message.requestId)) {
      const request = pending.get(message.requestId);
      pending.delete(message.requestId);
      if (message.ok) request.resolve(message);
      else request.reject(new Error(message.error ?? 'worker request failed'));
      return;
    }

    console.log(`SMOKE_MESSAGE ${JSON.stringify(message)}`);
    if (!message || !message.ok) {
      finish(1);
      return;
    }

    if (run === 1) {
      console.log('SMOKE_WORKER_RESTART');
      restarting = true;
      worker.kill();
      return;
    }

    void testRendererReload();
  });
  worker.on('error', (error) => {
    console.error('worker error', error);
    finish(1);
  });
  worker.on('exit', (code) => {
    if (restarting) {
      restarting = false;
      spawnWorker();
      return;
    }
    if (!finished) {
      console.error(`worker exited ${code}`);
      finish(1);
    }
  });
}

async function testRendererReload() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
  });

  await window.loadFile(path.join(__dirname, 'renderer.html'));

  const first = await window.webContents.executeJavaScript('window.smoke.search()');
  console.log(`SMOKE_RENDERER_1 ${JSON.stringify(first)}`);
  if (!first || first.id !== '42') {
    throw new Error('first renderer search failed');
  }

  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });

  const second = await window.webContents.executeJavaScript('window.smoke.search()');
  console.log(`SMOKE_RENDERER_2 ${JSON.stringify(second)}`);
  if (!second || second.id !== '42') {
    throw new Error('second renderer search failed');
  }

  window.destroy();
  const disposed = await requestWorker({ type: 'dispose' });
  console.log(`SMOKE_DISPOSE ${JSON.stringify(disposed)}`);
  finish(0);
}

ipcMain.handle('smoke:search', async () => {
  const result = await requestWorker({ type: 'search' });
  return { id: result.id, length: result.length };
});

(async () => {
  await app.whenReady();
  spawnWorker();
})().catch((error) => {
  console.error('smoke error', error);
  finish(1);
});

setTimeout(() => {
  console.error('smoke timeout');
  finish(1);
}, 30_000);

app.on('window-all-closed', () => app.quit());
