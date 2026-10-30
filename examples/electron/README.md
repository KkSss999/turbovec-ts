# Electron utility process example

Load the native addon in a long-lived `utilityProcess`, never in the renderer. The
utility process owns the index; the main process and renderer only exchange messages.
This keeps a CPU-heavy search or a native crash away from the window.

## Worker

`worker.mjs` runs inside `utilityProcess.fork()`:

```js
import { IdMapIndex } from 'turbovec-ts';
import { TurbovecError, toTurbovecError } from 'turbovec-ts/errors';

const index = new IdMapIndex(1536, 4);

process.parentPort.on('message', async (event) => {
  const { id, type, vectors, ids, query, k } = event.data;

  try {
    if (type === 'add') {
      await index.addWithIds(new Float32Array(vectors), new BigUint64Array(ids));
      process.parentPort.postMessage({ id, ok: true });
      return;
    }

    if (type === 'search') {
      const result = await index.search(new Float32Array(query), k);
      process.parentPort.postMessage({
        id,
        ok: true,
        result: {
          scores: result.scores,
          ids: result.ids,
          nq: result.nq,
          k: result.k,
        },
      });
      return;
    }

    if (type === 'dispose') {
      index.dispose();
      process.parentPort.postMessage({ id, ok: true });
    }
  } catch (cause) {
    const error = toTurbovecError(cause);
    process.parentPort.postMessage({
      id,
      ok: false,
      error: {
        name: error.name,
        message: error.message,
        code: error instanceof TurbovecError ? error.code : 'ERR_UNKNOWN',
      },
    });
  }
});
```

## Main process

```js
import { app, utilityProcess } from 'electron';

let worker;

app.whenReady().then(() => {
  worker = utilityProcess.fork(new URL('./worker.mjs', import.meta.url).pathname);

  worker.on('spawn', () => {
    worker.postMessage({
      id: 1,
      type: 'add',
      vectors: new Float32Array([1, 0, 0]),
      ids: new BigUint64Array([1001n]),
    });
  });

  worker.on('message', (message) => {
    // forward the result to the renderer over a narrow IPC channel
    console.log(message);
  });

  worker.on('exit', (code) => {
    // restart the worker or surface the failure to the UI
    console.error('index worker exited', code);
  });
});
```

Renderer code talks to the main process through `ipcRenderer.invoke` / `ipcMain.handle`;
it does not import `turbovec-ts`.

## Packaging

- `asarUnpack` the `.node` file:
  ```json
  "asarUnpack": ["**/*.node"]
  ```
- Keep the platform optional package in production dependencies.
- Test the packaged artifact, including reload and shutdown.
- Verify `process.versions.napi` in the target Electron version.
- macOS builds need signing/notarization; Windows needs the MSVC runtime; Linux needs a
  documented glibc baseline.
- The worker is a separate entry point. Include it in the packaged app next to the main
  entry.
