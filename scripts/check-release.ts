import { readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  version: string;
  private?: boolean;
  files?: string[];
  optionalDependencies?: Record<string, string>;
  napi?: { targets?: string[] };
};
const cargo = await Bun.file(new URL('Cargo.toml', root)).text();
const cargoVersion = /^version = "([^"]+)"/m.exec(cargo)?.[1];
const lock = await Bun.file(new URL('Cargo.lock', root)).text();
const lockPackage = lock
  .split('[[package]]')
  .find((block) => block.includes('name = "turbovec-ts-native"'));
const lockVersion = lockPackage?.match(/version = "([^"]+)"/)?.[1];
const changelog = await Bun.file(new URL('CHANGELOG.md', root)).text();

const errors: string[] = [];
const requiredFiles = [
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'LICENSE-TURBOVEC',
  'README.md',
  'SECURITY.md',
  'docs/api-stability.md',
  'docs/release.md',
];

for (const file of requiredFiles) {
  if (!(await Bun.file(new URL(file, root)).exists())) errors.push(`missing ${file}`);
}

if (pkg.version !== cargoVersion) {
  errors.push(`package.json version ${pkg.version} != Cargo.toml version ${cargoVersion}`);
}
if (pkg.version !== lockVersion) {
  errors.push(`package.json version ${pkg.version} != Cargo.lock version ${lockVersion}`);
}
if (!changelog.includes(`## [${pkg.version}]`)) {
  errors.push(`CHANGELOG.md has no ${pkg.version} section`);
}
if (!pkg.files?.includes('LICENSE-TURBOVEC')) {
  errors.push('package.json files is missing LICENSE-TURBOVEC');
}

const platformPackages = [
  'turbovec-ts-linux-x64-gnu',
  'turbovec-ts-linux-arm64-gnu',
  'turbovec-ts-win32-x64-msvc',
  'turbovec-ts-win32-arm64-msvc',
  'turbovec-ts-darwin-x64',
  'turbovec-ts-darwin-arm64',
];
for (const name of platformPackages) {
  if (pkg.optionalDependencies?.[name] !== pkg.version) {
    errors.push(`optional dependency ${name} must be ${pkg.version}`);
  }
}

if (pkg.napi?.targets?.length !== platformPackages.length) {
  errors.push(`napi.targets must contain ${platformPackages.length} targets`);
}

try {
  const dirs = await readdir(new URL('npm/', root), { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const manifestPath = new URL(`npm/${dir.name}/package.json`, root);
    if (!(await Bun.file(manifestPath).exists())) continue;
    const manifest = (await Bun.file(manifestPath).json()) as { version: string };
    if (manifest.version !== pkg.version) {
      errors.push(`npm/${dir.name} version ${manifest.version} != ${pkg.version}`);
    }
  }
} catch {
  // npm/ is generated at release time and is intentionally absent from git.
}

if (pkg.private) {
  console.error('private=true: publish is intentionally disabled until release approval.');
}

if (errors.length > 0) {
  throw new Error(`release check failed:\n- ${errors.join('\n- ')}`);
}

console.error(`release check passed for ${pkg.version}`);
