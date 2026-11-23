'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const dist = path.join(projectRoot, 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function minify(source, loader) {
  const result = esbuild.transformSync(source, {
    loader,
    minify: true,
    legalComments: 'none',
    target: loader === 'css' ? undefined : ['es2020']
  });
  return result.code;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Static files that need no processing.
for (const file of ['index.html', 'manifest.json']) {
  fs.copyFileSync(path.join(projectRoot, file), path.join(dist, file));
}
for (const dir of ['assets', 'fonts', 'lib']) {
  copyDir(path.join(projectRoot, dir), path.join(dist, dir));
}

const jsFiles = ['core.js', 'compressor.js', 'app.js'];
const cssFiles = ['styles.css'];
const hash = crypto.createHash('sha256');

for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
  const output = minify(source, 'js');
  hash.update(output);
  fs.writeFileSync(path.join(dist, file), output);
}

for (const file of cssFiles) {
  const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
  const output = minify(source, 'css');
  hash.update(output);
  fs.writeFileSync(path.join(dist, file), output);
}

const buildId = hash.digest('hex').slice(0, 10);

const swSource = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
fs.writeFileSync(path.join(dist, 'sw.js'), swSource.replace('__BUILD__', buildId));

// Sanity checks: every local asset referenced by index.html must exist in dist.
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const references = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  const ref = match[1];
  if (ref.startsWith('http') || ref.startsWith('//')) continue;
  references.add(ref.replace(/^\.\//, ''));
}
const missing = [...references].filter((ref) => !fs.existsSync(path.join(dist, ref)));
if (missing.length) {
  console.error('Build failed — missing assets: ' + missing.join(', '));
  process.exit(1);
}

const sizeOf = (file) => (fs.statSync(file).size / 1024).toFixed(1) + ' KB';
console.log('Built dist/ (' + buildId + ')');
for (const file of ['index.html', 'styles.css', 'core.js', 'compressor.js', 'app.js', 'sw.js']) {
  console.log('  ' + file.padEnd(15) + sizeOf(path.join(dist, file)));
}
