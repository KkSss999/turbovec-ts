// oxlint-disable unicorn/require-post-message-target-origin
const path = require('node:path');
const { app, utilityProcess } = require('electron');

let finished = false;
let run = 0;
let restarting = false;

function finish(code) {
  if (finished) return;
  finished = true;
  console.log(`SMOKE_EXIT ${code}`);
  app.exit(code);
}

function spawnWorker() {
  run += 1;
  console.log(`SMOKE_RUN ${run}`);
  const worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'));

  worker.on('spawn', () => worker.postMessage({ type: 'run', run }));
  worker.on('message', (message) => {
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

    finish(0);
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
}, 20_000);

app.on('window-all-closed', () => app.quit());
