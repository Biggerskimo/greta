import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import input from "input";
import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Config, PresenceEvent } from "./types.js";
import { detectDirection, detectDirectionFullImage } from "./ocr.js";
import { addEvent, generateEventId, loadEvents } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, "..", "data", "session.txt");

async function loadSession(): Promise<string> {
  if (existsSync(SESSION_FILE)) {
    return await readFile(SESSION_FILE, "utf-8");
  }
  return "";
}

async function saveSession(session: string): Promise<void> {
  const dir = path.dirname(SESSION_FILE);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(SESSION_FILE, session);
}

export async function fetchHistory(
  config: Config,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!apiId || !apiHash) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH are required for fetching history.\n" +
      "Get them from https://my.telegram.org/apps"
    );
  }

  const sessionString = await loadSession();
  const session = new StringSession(sessionString);

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Enter your phone number: "),
    password: async () => await input.text("Enter your 2FA password (if any): "),
    phoneCode: async () => await input.text("Enter the code you received: "),
    onError: (err) => console.error("Auth error:", err),
  });

  console.log("Connected to Telegram");

  // Save session for future use
  const newSession = client.session.save() as unknown as string;
  await saveSession(newSession);

  // Get existing events to avoid duplicates
  const existingEvents = await loadEvents();
  const existingTimestamps = new Set(existingEvents.map((e) => e.timestamp));

  let eventsAdded = 0;
  let offset = 0;
  const limit = 100;

  console.log(`Fetching messages from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Fetch messages in batches
  while (true) {
    const messages = await client.getMessages(config.telegramGroupId, {
      limit,
      offsetId: offset,
      reverse: false,
    });

    if (messages.length === 0) {
      break;
    }

    for (const message of messages) {
      const msgDate = new Date(message.date * 1000);

      // Skip if outside date range
      if (msgDate < startDate) {
        // We've gone past our date range, stop
        console.log(`Reached messages before start date, stopping`);
        await client.disconnect();
        return eventsAdded;
      }

      if (msgDate > endDate) {
        // Skip messages after end date
        continue;
      }

      // Check if message has a photo
      if (message.photo) {
        const timestamp = msgDate.toISOString();

        // Skip if we already have this event
        if (existingTimestamps.has(timestamp)) {
          console.log(`Skipping duplicate: ${timestamp}`);
          continue;
        }

        console.log(`Processing photo from ${timestamp}`);

        try {
          // Download the photo
          const buffer = await client.downloadMedia(message, {}) as Buffer;

          if (!buffer) {
            console.log("Could not download photo");
            continue;
          }

          // Run OCR
          let ocrResult = await detectDirection(buffer, config);

          if (!ocrResult.direction || ocrResult.confidence < 0.5) {
            ocrResult = await detectDirectionFullImage(buffer);
          }

          console.log(
            `OCR result: direction=${ocrResult.direction}, confidence=${ocrResult.confidence.toFixed(2)}`
          );

          if (ocrResult.direction) {
            const event: PresenceEvent = {
              id: generateEventId(),
              timestamp,
              direction: ocrResult.direction,
              confidence: ocrResult.confidence,
            };

            await addEvent(event);
            existingTimestamps.add(timestamp);
            eventsAdded++;
            console.log(`Added ${ocrResult.direction} event at ${timestamp}`);
          }
        } catch (error) {
          console.error(`Error processing photo: ${error}`);
        }
      }

      offset = message.id;
    }

    console.log(`Processed ${messages.length} messages, continuing...`);
  }

  await client.disconnect();
  return eventsAdded;
}
