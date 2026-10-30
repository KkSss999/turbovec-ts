const python = process.env.TURBOVEC_PYTHON;
if (!python) {
  throw new Error('TURBOVEC_PYTHON is required for the strict Python interop test');
}

const cargoLock = await Bun.file(new URL('../Cargo.lock', import.meta.url)).text();
const corePackage = cargoLock
  .split('[[package]]')
  .find((block) => block.includes('name = "turbovec"'));
const expected = corePackage?.match(/version = "([^"]+)"/)?.[1];
if (!expected) {
  throw new Error('could not read turbovec version from Cargo.lock');
}

const result = Bun.spawnSync([python, '-c', 'import turbovec; print(turbovec.__version__)']);
if (result.exitCode !== 0) {
  throw new Error(`could not import turbovec with ${python}:\n${result.stderr.toString()}`);
}

const actual = result.stdout.toString().trim();
if (actual !== expected) {
  throw new Error(`python turbovec is ${actual}, but the Rust core is ${expected}`);
}

console.log(`python interop: turbovec ${actual} via ${python}`);
