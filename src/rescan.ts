import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Config, PresenceEvent } from "./types.js";
import { detectDirection, detectDirectionFullImage } from "./ocr.js";
import { loadEvents, saveEvents } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, "..", "images");

export async function rescanImages(
  config: Config,
  startDate: Date,
  endDate: Date
): Promise<number> {
  if (!existsSync(IMAGES_DIR)) {
    throw new Error("Images directory does not exist. No images to rescan.");
  }

  const events = await loadEvents();
  const eventsMap = new Map(events.map((e) => [e.id, e]));

  let rescanned = 0;
  let updated = 0;

  for (const event of events) {
    const eventDate = new Date(event.timestamp);

    // Skip if outside date range
    if (eventDate < startDate || eventDate > endDate) {
      continue;
    }

    // Skip if no image file
    if (!event.imageFile) {
      console.log(`Skipping event ${event.id}: no image file`);
      continue;
    }

    const imagePath = path.join(IMAGES_DIR, event.imageFile);

    if (!existsSync(imagePath)) {
      console.log(`Skipping event ${event.id}: image file not found`);
      continue;
    }

    try {
      console.log(`Rescanning image for event ${event.id} at ${event.timestamp}`);

      const imageBuffer = await readFile(imagePath);

      // Run OCR
      let ocrResult = await detectDirection(imageBuffer, config);

      if (ocrResult.direction === "invalid") {
        ocrResult = await detectDirectionFullImage(imageBuffer);
      }

      console.log(
        `OCR result: direction=${ocrResult.direction}, prey=${ocrResult.prey}, confidence=${ocrResult.confidence.toFixed(2)}`
      );

      // Update event if direction changed
      const hasChanged =
        event.direction !== ocrResult.direction ||
        event.prey !== ocrResult.prey;

      if (hasChanged) {
        const oldDirection = event.direction;
        const oldPrey = event.prey;

        event.direction = ocrResult.direction;
        event.confidence = ocrResult.confidence;
        event.prey = ocrResult.prey;
        event.rawText = ocrResult.rawText;

        console.log(
          `Updated event ${event.id}: ${oldDirection}${oldPrey ? ' (prey)' : ''} -> ${ocrResult.direction}${ocrResult.prey ? ' (prey)' : ''}`
        );
        updated++;
      }

      rescanned++;
    } catch (error) {
      console.error(`Error rescanning image ${event.imageFile}:`, error);
    }
  }

  // Save updated events
  if (updated > 0) {
    await saveEvents(events);
    console.log(`\nSaved ${updated} updated events`);
  }

  return rescanned;
}
