#!/usr/bin/env node
// Runs OCR on every jpg/png/webp in test-flyers/ (or the folder given as an argument).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { processFile } from './src/processFile.js';
import { MIME_TYPES } from './src/ocr.js';

const dir = process.argv[2] ?? 'test-flyers';

let names;
try {
  names = await readdir(dir);
} catch {
  console.error(`Error: folder not found: ${dir}`);
  process.exit(1);
}

const images = names.filter((n) => path.extname(n).toLowerCase() in MIME_TYPES).sort();
if (images.length === 0) {
  console.error(`No jpg/png/webp images in ${dir}/. Drop some flyers there first.`);
  process.exit(1);
}

let failed = 0;
for (const name of images) {
  console.log(`\n===== ${name} =====`);
  try {
    const { result } = await processFile(path.join(dir, name));
    console.log(result.text);
  } catch (err) {
    failed++;
    console.log(`FAILED: ${err.message}`);
  }
}

console.log(`\nDone: ${images.length - failed}/${images.length} succeeded. JSON saved next to each image.`);
process.exit(failed ? 1 : 0);
