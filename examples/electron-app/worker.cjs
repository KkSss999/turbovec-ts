// oxlint-disable unicorn/require-post-message-target-origin
const { IdMapIndex } = require('turbovec-ts');

const index = new IdMapIndex(8, 4);
const vector = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

process.parentPort.on('message', async (event) => {
  const data = event.data;
  try {
    if (data?.type === 'run') {
      await index.addWithIds(vector, new BigUint64Array([42n]));
      const result = await index.search(vector, 1);
      if (result.ids[0] !== 42n) {
        throw new Error(`wrong id: ${String(result.ids[0])}`);
      }
      process.parentPort.postMessage({
        ok: true,
        run: data.run,
        id: result.ids[0].toString(),
        length: index.length,
      });
      return;
    }

    if (data?.type === 'search') {
      const result = await index.search(vector, 1);
      process.parentPort.postMessage({
        ok: true,
        requestId: data.id,
        id: result.ids[0].toString(),
        length: index.length,
      });
      return;
    }

    if (data?.type === 'dispose') {
      index.dispose();
      process.parentPort.postMessage({ ok: true, requestId: data.id });
    }
  } catch (error) {
    process.parentPort.postMessage({
      ok: false,
      requestId: data?.id,
      error: String(error),
    });
  }
});
