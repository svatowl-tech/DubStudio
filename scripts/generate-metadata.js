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
