import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractText, MIME_TYPES, MODEL, OcrError } from './ocr.js';

// OCR one image file and save <name>.ocr.json next to it. Used by the CLI and the batch script.
export async function processFile(filePath) {
  const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mimeType) {
    throw new OcrError('UNSUPPORTED_FORMAT', `Unsupported file type "${path.extname(filePath)}". Use jpg, png, or webp.`);
  }

  let imageBuffer;
  try {
    imageBuffer = await readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') throw new OcrError('FILE_NOT_FOUND', `File not found: ${filePath}`, { cause: err });
    throw err;
  }

  const text = await extractText(imageBuffer, mimeType);

  const result = {
    file: path.basename(filePath),
    model: MODEL,
    text,
    processed_at: new Date().toISOString(),
  };
  const jsonPath = path.join(path.dirname(filePath), `${path.parse(filePath).name}.ocr.json`);
  await writeFile(jsonPath, JSON.stringify(result, null, 2) + '\n');
  return { result, jsonPath };
}
