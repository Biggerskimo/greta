import TelegramBot from "node-telegram-bot-api";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Config, PresenceEvent } from "./types.js";
import { detectDirection, detectDirectionFullImage } from "./ocr.js";
import { addEvent, generateEventId } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, "..", "images");

async function saveImage(imageBuffer: Buffer, eventId: string): Promise<string> {
  if (!existsSync(IMAGES_DIR)) {
    await mkdir(IMAGES_DIR, { recursive: true });
  }

  const filename = `${eventId}.jpg`;
  const filePath = path.join(IMAGES_DIR, filename);
  await writeFile(filePath, imageBuffer);
  return filename;
}

export function createBot(config: Config): TelegramBot {
  const bot = new TelegramBot(config.telegramBotToken, { polling: true });

  console.log("Bot started, listening for photos...");

  bot.on("photo", async (msg) => {
    // Only process messages from the configured group
    if (msg.chat.id !== config.telegramGroupId) {
      console.log(`Ignoring photo from chat ${msg.chat.id} (not configured group)`);
      return;
    }

    console.log(`Received photo from group at ${new Date().toISOString()}`);

    try {
      // Get the highest resolution photo
      const photos = msg.photo;
      if (!photos || photos.length === 0) {
        console.log("No photo data found");
        return;
      }

      const photo = photos[photos.length - 1];
      const fileId = photo.file_id;

      // Download the photo
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      console.log(`Downloaded photo (${imageBuffer.length} bytes)`);

      // Try OCR with cropped region first
      let ocrResult = await detectDirection(imageBuffer, config);

      // If invalid, try full image
      if (ocrResult.direction === "invalid") {
        console.log("Cropped OCR returned invalid, trying full image...");
        ocrResult = await detectDirectionFullImage(imageBuffer);
      }

      console.log(`OCR result: direction=${ocrResult.direction}, prey=${ocrResult.prey}, confidence=${ocrResult.confidence.toFixed(2)}`);

      const eventId = generateEventId();
      const imageFile = await saveImage(imageBuffer, eventId);

      const event: PresenceEvent = {
        id: eventId,
        timestamp: new Date().toISOString(),
        direction: ocrResult.direction,
        confidence: ocrResult.confidence,
        prey: ocrResult.prey,
        imageFile,
        rawText: ocrResult.rawText,
      };

      await addEvent(event);
      console.log(`Recorded ${ocrResult.direction} event${ocrResult.prey ? ' (with prey)' : ''} at ${event.timestamp}`);
    } catch (error) {
      console.error("Error processing photo:", error);
    }
  });

  bot.on("error", (error) => {
    console.error("Telegram bot error:", error);
  });

  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error);
  });

  return bot;
}

export function stopBot(bot: TelegramBot): void {
  bot.stopPolling();
  console.log("Bot stopped");
}
