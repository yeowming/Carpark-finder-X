import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy top-level static files to dist/ for Vercel and production web servers
const filesToCopy = ['index.html', 'styles.css', 'app.js'];

for (const file of filesToCopy) {
  const src = path.resolve(rootDir, file);
  const dest = path.resolve(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[build] Copied ${file} -> dist/${file}`);
  }
}

// Copy assets folder if it contains files
const assetsSrc = path.resolve(rootDir, 'assets');
const assetsDest = path.resolve(distDir, 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
  console.log(`[build] Copied assets/ -> dist/assets/`);
}

console.log('[build] Static assets successfully bundled into dist/');
