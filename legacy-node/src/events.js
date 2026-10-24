// Step 2 (not built yet): turn the OCR text into structured event data.
//
// Planned shape of the result:
//   {
//     title:       { value, confidence },
//     start:       { value: ISO 8601 with offset, confidence },
//     end:         { value, confidence },
//     location:    { value, confidence },
//     description: { value, confidence },
//     tags:        { value: string[], confidence }
//   }
//
// Plan: Gemma structured output (responseSchema) for the shape above, plus a
// function-calling tool (e.g. resolveDate("next Friday", referenceDateTime, timezone))
// so date math is done in code, not by the model. imageBuffer is passed too so the
// model can check the text against the picture.
//
// Reuses getClient/MODEL/withRateLimitRetry from ocr.js (export getClient when needed).
export async function parseEvents(text, imageBuffer, referenceDateTime, timezone) {
  throw new Error('parseEvents is not implemented yet');
}
