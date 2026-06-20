import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const metadataPath = path.join(process.cwd(), 'src', 'build-metadata.json');

let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  console.warn('Could not get commit hash, using "unknown"');
}

const metadata = {
  buildDate: new Date().toISOString(),
  commitHash: commitHash,
  version: process.env.npm_package_version || '1.0.0'
};

fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
console.log(`Generated build metadata: ${metadataPath}`);

// Icon generation and conversion helper
async function prepareIcons() {
  const assetsDir = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const pngPath = path.join(assetsDir, 'icon.png');
  const imagesDir = path.join(process.cwd(), 'src', 'assets', 'images');
  
  // Find any icon_*.jpg
  let sourceJpg = null;
  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir);
    const iconFile = files.find(f => f.startsWith('icon_') && f.endsWith('.jpg'));
    if (iconFile) {
      sourceJpg = path.join(imagesDir, iconFile);
    }
  }

  if (sourceJpg) {
    console.log(`Found source icon image: ${sourceJpg}`);
    try {
      const { default: sharp } = await import('sharp');
      await sharp(sourceJpg)
        .resize(512, 512)
        .png()
        .toFile(pngPath);
      console.log(`Successfully converted and resized icon to square PNG at: ${pngPath}`);
    } catch (err) {
      console.warn('Could not use sharp for high-quality PNG conversion. Using direct copy fallback:', err.message);
      try {
        fs.copyFileSync(sourceJpg, pngPath);
        console.log(`Fallback: Copied source icon directly to: ${pngPath}`);
      } catch (cpErr) {
        console.error('Failed to copy fallback icon:', cpErr);
      }
    }
  } else {
    console.warn(`Source icon image not found in ${imagesDir}. Creating default empty fallback image.`);
  }
}

prepareIcons().catch(e => console.error('Error during icon preparation:', e));
