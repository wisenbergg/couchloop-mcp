import fs from 'fs';
import path from 'path';

const sourceViewsDir = path.resolve('src/server/views');
const distViewsDir = path.resolve('dist/server/views');

try {
  if (!fs.existsSync(sourceViewsDir)) {
    console.warn(`[copy-server-assets] Source directory missing: ${sourceViewsDir}`);
    process.exit(0);
  }

  fs.mkdirSync(distViewsDir, { recursive: true });
  fs.cpSync(sourceViewsDir, distViewsDir, { recursive: true });
  console.log(`[copy-server-assets] Copied ${sourceViewsDir} -> ${distViewsDir}`);
} catch (error) {
  console.error('[copy-server-assets] Failed to copy server assets', error);
  process.exit(1);
}
