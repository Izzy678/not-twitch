const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, '..');
const standaloneNext = path.join(appDir, '.next', 'standalone', 'apps', 'web', '.next');
const staticSrc = path.join(appDir, '.next', 'static');
const publicSrc = path.join(appDir, 'public');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    if (fs.statSync(srcPath).isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy .next/static into standalone so the server can serve CSS and JS
if (fs.existsSync(staticSrc) && fs.existsSync(standaloneNext)) {
  const staticDest = path.join(standaloneNext, 'static');
  copyRecursive(staticSrc, staticDest);
  console.log('Copied .next/static to standalone.');
}

// Copy public into standalone if it exists
if (fs.existsSync(publicSrc) && fs.existsSync(path.join(appDir, '.next', 'standalone', 'apps', 'web'))) {
  const publicDest = path.join(appDir, '.next', 'standalone', 'apps', 'web', 'public');
  copyRecursive(publicSrc, publicDest);
  console.log('Copied public to standalone.');
}
