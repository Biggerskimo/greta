import TelegramBot from "node-telegram-bot-api";
import type { Config, PresenceEvent } from "./types.js";
import { detectDirection, detectDirectionFullImage } from "./ocr.js";
import { addEvent, generateEventId } from "./storage.js";

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

      // If cropping fails or confidence is low, try full image
      if (!ocrResult.direction || ocrResult.confidence < 0.5) {
        console.log("Cropped OCR failed, trying full image...");
        ocrResult = await detectDirectionFullImage(imageBuffer);
      }

      console.log(`OCR result: direction=${ocrResult.direction}, confidence=${ocrResult.confidence.toFixed(2)}, text="${ocrResult.rawText}"`);

      if (ocrResult.direction) {
        const event: PresenceEvent = {
          id: generateEventId(),
          timestamp: new Date().toISOString(),
          direction: ocrResult.direction,
          confidence: ocrResult.confidence,
        };

        await addEvent(event);
        console.log(`Recorded ${ocrResult.direction} event at ${event.timestamp}`);
      } else {
        console.log("Could not detect direction from image");
      }
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
