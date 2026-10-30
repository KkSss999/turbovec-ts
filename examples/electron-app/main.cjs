// oxlint-disable unicorn/require-post-message-target-origin
const path = require('node:path');
const { app, utilityProcess } = require('electron');

let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  console.log(`SMOKE_EXIT ${code}`);
  app.exit(code);
}

(async () => {
  await app.whenReady();

  const worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'));

  worker.on('spawn', () => worker.postMessage({ type: 'run' }));
  worker.on('message', (message) => {
    console.log(`SMOKE_MESSAGE ${JSON.stringify(message)}`);
    finish(message && message.ok ? 0 : 1);
  });
  worker.on('error', (error) => {
    console.error('worker error', error);
    finish(1);
  });
  worker.on('exit', (code) => {
    if (!finished) {
      console.error(`worker exited ${code}`);
      finish(1);
    }
  });
})().catch((error) => {
  console.error('smoke error', error);
  finish(1);
});

setTimeout(() => {
  console.error('smoke timeout');
  finish(1);
}, 20_000);

app.on('window-all-closed', () => app.quit());
