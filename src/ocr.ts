import Tesseract from "tesseract.js";
import sharp from "sharp";
import type { Config, OcrResult } from "./types.js";

export async function detectDirection(
  imageBuffer: Buffer,
  config: Config
): Promise<OcrResult> {
  // Crop the image to the region where "in"/"out" text appears
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

  const rawText = result.data.text.toLowerCase().trim();
  const confidence = result.data.confidence / 100;

  // Detect "in" or "out"
  let direction: "in" | "out" | null = null;

  if (rawText.includes("in") && !rawText.includes("out")) {
    direction = "in";
  } else if (rawText.includes("out")) {
    direction = "out";
  }

  return {
    direction,
    confidence,
    rawText,
  };
}

export async function detectDirectionFullImage(
  imageBuffer: Buffer
): Promise<OcrResult> {
  // Run OCR on full image (useful for testing/calibration)
  const result = await Tesseract.recognize(imageBuffer, "eng", {
    logger: () => {},
  });

  const rawText = result.data.text.toLowerCase().trim();
  const confidence = result.data.confidence / 100;

  let direction: "in" | "out" | null = null;

  if (rawText.includes("in") && !rawText.includes("out")) {
    direction = "in";
  } else if (rawText.includes("out")) {
    direction = "out";
  }

  return {
    direction,
    confidence,
    rawText,
  };
}
