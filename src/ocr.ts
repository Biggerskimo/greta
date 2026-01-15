import Tesseract from "tesseract.js";
import sharp from "sharp";
import type { Config, OcrResult } from "./types.js";

function analyzeText(rawText: string): OcrResult {
  const text = rawText.toLowerCase();

  // Count occurrences of each pattern (using specific patterns, not greedy matching)
  const outCount = (text.match(/out\s*-\s*skipped\s*prey\s*detection/gi) || []).length;
  const inNoPreyCount = (text.match(/in\s*-\s*no\s*prey\s*detected/gi) || []).length;

  // For prey detection: match "in - <word> prey detected" then filter out "no prey"
  const inPreyMatches = text.match(/in\s*-\s*\S*\s*prey\s*detected/gi) || [];
  const inPreyCount = inPreyMatches.filter(match => !match.includes('no')).length;

  // Apply detection logic
  if (outCount >= 4) {
    return {
      direction: "out",
      confidence: 0.9,
      prey: false,
      rawText,
    };
  }

  if (inPreyCount >= 1) {
    return {
      direction: "in",
      confidence: 0.9,
      prey: true,
      rawText,
    };
  }

  if (inNoPreyCount >= 4) {
    return {
      direction: "in",
      confidence: 0.9,
      prey: false,
      rawText,
    };
  }

  // Invalid case
  return {
    direction: "invalid",
    confidence: 0.0,
    prey: false,
    rawText,
  };
}

export async function detectDirection(
  imageBuffer: Buffer,
  config: Config
): Promise<OcrResult> {
  // Crop the image to the region where text appears
  const croppedBuffer = await sharp(imageBuffer)
    .extract({
      left: config.ocrCropX,
      top: config.ocrCropY,
      width: config.ocrCropWidth,
      height: config.ocrCropHeight,
    })
    .grayscale()
    .normalize()
    .toBuffer();

  // Run OCR on the cropped region
  const result = await Tesseract.recognize(croppedBuffer, "eng", {
    logger: () => {}, // Suppress progress logs
  });

  const rawText = result.data.text.trim();
  return analyzeText(rawText);
}

export async function detectDirectionFullImage(
  imageBuffer: Buffer
): Promise<OcrResult> {
  // Run OCR on full image (useful for testing/calibration)
  const result = await Tesseract.recognize(imageBuffer, "eng", {
    logger: () => {},
  });

  const rawText = result.data.text.trim();
  return analyzeText(rawText);
}
