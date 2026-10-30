const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const destination = path.resolve(__dirname, '../node_modules/turbovec-ts');
const packageFiles = [
  'index.js',
  'index.cjs',
  'index.d.ts',
  'native.js',
  'native.cjs',
  'native.d.ts',
  'errors.js',
  'errors.cjs',
  'errors.d.ts',
  'package.json',
];

fs.rmSync(destination, { force: true, recursive: true });
fs.mkdirSync(destination, { recursive: true });

for (const file of packageFiles) {
  fs.copyFileSync(path.join(root, file), path.join(destination, file));
}

for (const file of fs.readdirSync(root)) {
  if (file.endsWith('.node')) {
    fs.copyFileSync(path.join(root, file), path.join(destination, file));
  }
}

console.log(`staged turbovec-ts into ${destination}`);
