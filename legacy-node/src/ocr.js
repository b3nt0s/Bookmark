import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import 'dotenv/config';

// Switch to 'gemma-4-31b-it' here if the 26B model isn't accurate enough.
export const MODEL = 'gemma-4-26b-a4b-it';

export const MAX_IMAGE_SIDE = 1600;
export const MAX_ATTEMPTS = 3;

export const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Gemma on the Gemini API doesn't accept a system instruction, so the whole
// prompt goes in the user turn.
export const OCR_PROMPT = `Transcribe ALL visible text on this event flyer exactly as written.

Rules:
- Read in natural order: the title first, then the details (date, time, place, price, etc.).
- Keep the original line breaks.
- Transcribe verbatim. Do NOT correct spelling, fix grammar, reformat dates, or add anything that is not on the flyer.
- If a piece of text is unreadable, write [unclear] in its place.
- Output only the transcription: no commentary, no markdown, no code fences.`;

// Errors the CLI can show to the user as-is. `code` is handy for an HTTP layer later.
export class OcrError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'OcrError';
    this.code = code;
  }
}

let client;
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new OcrError(
      'MISSING_API_KEY',
      'GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.',
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

// Fixes phone-photo rotation (EXIF) and shrinks big images. Keeps the original format.
export async function prepareImage(imageBuffer) {
  return sharp(imageBuffer)
    .rotate()
    .resize({
      width: MAX_IMAGE_SIDE,
      height: MAX_IMAGE_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls fn(), retrying on 429 with exponential backoff (2s, 4s) up to MAX_ATTEMPTS total.
export async function withRateLimitRetry(fn, { baseDelayMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.status !== 429) throw err;
      if (attempt >= MAX_ATTEMPTS) {
        throw new OcrError(
          'RATE_LIMITED',
          `Rate limited by the Gemini API (429) after ${MAX_ATTEMPTS} attempts. Wait a minute and try again.`,
          { cause: err },
        );
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.error(`Rate limited (429). Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
      await sleep(delay);
    }
  }
}

/**
 * Transcribe all text on a flyer image.
 * @param {Buffer} imageBuffer raw image bytes (jpg/png/webp)
 * @param {string} mimeType e.g. 'image/jpeg'
 * @returns {Promise<string>} the transcription
 */
export async function extractText(imageBuffer, mimeType) {
  if (!Object.values(MIME_TYPES).includes(mimeType)) {
    throw new OcrError('UNSUPPORTED_FORMAT', `Unsupported image type "${mimeType}". Use jpg, png, or webp.`);
  }
  const ai = getClient();

  let prepared;
  try {
    prepared = await prepareImage(imageBuffer);
  } catch (err) {
    throw new OcrError('BAD_IMAGE', `Could not read the image: ${err.message}`, { cause: err });
  }

  const response = await withRateLimitRetry(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: prepared.toString('base64') } },
            { text: OCR_PROMPT },
          ],
        },
      ],
      config: { temperature: 0 },
    }),
  );

  const text = response.text?.trim();
  if (!text) {
    throw new OcrError('EMPTY_RESPONSE', 'The model returned no text (the image may have been blocked or blank).');
  }
  return text;
}
