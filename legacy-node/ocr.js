#!/usr/bin/env node
import { processFile } from './src/processFile.js';
import { OcrError } from './src/ocr.js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node ocr.js path/to/flyer.jpg');
  process.exit(1);
}

try {
  const { result, jsonPath } = await processFile(filePath);
  console.log(result.text);
  console.error(`\nSaved: ${jsonPath}`);
} catch (err) {
  if (err instanceof OcrError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error(`Unexpected error: ${err.message}`);
  }
  process.exit(1);
}
