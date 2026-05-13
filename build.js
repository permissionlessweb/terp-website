import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { minify } = require('html-minifier-terser');

async function build() {
  const outdir = 'dist';
  await fs.mkdirSync(outdir, { recursive: true });

  // Minify HTML — all live pages
  const htmlFiles = fs.readdirSync('pages')
    .filter(f => f.endsWith('.html'))
    .map(f => path.join('pages', f));

  for (const file of htmlFiles) {
    const content = await fs.readFileSync(file, 'utf8');
    const minified = await minify(content, { collapseWhitespace: true });

    // Write the minified content to the output directory
    const outputPath = path.join(outdir, file);
    await fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await fs.writeFileSync(outputPath, minified, 'utf8');
  }

  // Copy lib/ JS modules.
  const libOut = path.join(outdir, 'lib');
  fs.mkdirSync(libOut, { recursive: true });
  for (const file of fs.readdirSync('lib')) {
    if (file.endsWith('.js')) {
      fs.copyFileSync(path.join('lib', file), path.join(libOut, file));
    }
  }

  // // Copy get/ .
  const getOut = path.join(outdir, 'get');
  fs.mkdirSync(getOut, { recursive: true });
  for (const file of fs.readdirSync('get')) {
    const src = path.join('get', file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(getOut, file));
    }
  }

  // // Copy pkg/ WASM (if built).
  // if (fs.existsSync('pkg') && (fs.existsSync('pkg/passkey_wasm.js') || fs.existsSync('pkg/oline_wasm.js'))) {
  //   const pkgOut = path.join(outdir, 'pkg');
  //   fs.mkdirSync(pkgOut, { recursive: true });
  //   for (const file of fs.readdirSync('pkg')) {
  //     if (file.endsWith('.js') || file.endsWith('.wasm') || file.endsWith('.d.ts')) {
  //       fs.copyFileSync(path.join('pkg', file), path.join(pkgOut, file));
  //     }
  //   }
  //   console.log('Copied WASM pkg/ to dist/pkg/');
  // } else {
  //   console.warn('No pkg/ — run: npm run wasm-build');
  // }

  // Copy public/.
  fs.cpSync('public', path.join(outdir, 'public'), { recursive: true, force: true });

  console.log('Build complete');
}

build();
