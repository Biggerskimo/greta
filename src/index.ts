import "dotenv/config";
import { createBot, stopBot } from "./telegram.js";
import { generateReport } from "./report.js";
import { fetchHistory } from "./history.js";
import type { Config } from "./types.js";

function loadConfig(): Config {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = process.env.TELEGRAM_GROUP_ID;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }
  if (!groupId) {
    throw new Error("TELEGRAM_GROUP_ID environment variable is required");
  }

  return {
    telegramBotToken: token,
    telegramGroupId: parseInt(groupId, 10),
    ocrCropX: parseInt(process.env.OCR_CROP_X || "100", 10),
    ocrCropY: parseInt(process.env.OCR_CROP_Y || "50", 10),
    ocrCropWidth: parseInt(process.env.OCR_CROP_WIDTH || "200", 10),
    ocrCropHeight: parseInt(process.env.OCR_CROP_HEIGHT || "100", 10),
  };
}

function parseDate(str: string): Date {
  const date = new Date(str);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${str}`);
  }
  return date;
}

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const start = new Date(now);
  start.setUTCDate(now.getUTCDate() - dayOfWeek);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

async function runReport(args: string[]): Promise<void> {
  let startDate: Date;
  let endDate: Date;

  const fromIndex = args.indexOf("--from");
  const toIndex = args.indexOf("--to");

  if (fromIndex !== -1 && toIndex !== -1) {
    startDate = parseDate(args[fromIndex + 1]);
    endDate = parseDate(args[toIndex + 1]);
    endDate.setUTCHours(23, 59, 59, 999);
  } else {
    const range = getWeekRange();
    startDate = range.start;
    endDate = range.end;
  }

  await generateReport(startDate, endDate);
}

function loadConfigForFetch(): Config {
  const groupId = process.env.TELEGRAM_GROUP_ID;

  if (!groupId) {
    throw new Error("TELEGRAM_GROUP_ID environment variable is required");
  }

  return {
    telegramBotToken: "", // Not needed for fetch
    telegramGroupId: parseInt(groupId, 10),
    ocrCropX: parseInt(process.env.OCR_CROP_X || "100", 10),
    ocrCropY: parseInt(process.env.OCR_CROP_Y || "50", 10),
    ocrCropWidth: parseInt(process.env.OCR_CROP_WIDTH || "200", 10),
    ocrCropHeight: parseInt(process.env.OCR_CROP_HEIGHT || "100", 10),
  };
}

async function runFetch(args: string[]): Promise<void> {
  const config = loadConfigForFetch();

  let startDate: Date;
  let endDate: Date;

  const fromIndex = args.indexOf("--from");
  const toIndex = args.indexOf("--to");

  if (fromIndex !== -1 && toIndex !== -1) {
    startDate = parseDate(args[fromIndex + 1]);
    endDate = parseDate(args[toIndex + 1]);
    endDate.setUTCHours(23, 59, 59, 999);
  } else {
    // Default to last 30 days
    endDate = new Date();
    startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 30);
    startDate.setUTCHours(0, 0, 0, 0);
  }

  console.log(`Fetching history from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  const eventsAdded = await fetchHistory(config, startDate, endDate);
  console.log(`\nDone! Added ${eventsAdded} new events.`);
}

async function runBot(): Promise<void> {
  const config = loadConfig();
  const bot = createBot(config);

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    stopBot(bot);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    stopBot(bot);
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "report") {
    await runReport(args.slice(1));
  } else if (command === "fetch") {
    await runFetch(args.slice(1));
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(`
Greta - Cat Presence Reporter

Usage:
  npm run start           Start the Telegram bot to record events
  npm run report          Generate report for current week
  npm run report -- --from YYYY-MM-DD --to YYYY-MM-DD
                          Generate report for custom date range
  npm run fetch           Fetch historical data from Telegram (last 30 days)
  npm run fetch -- --from YYYY-MM-DD --to YYYY-MM-DD
                          Fetch historical data for custom date range

Setup for bot (real-time):
  1. Create a Telegram bot via @BotFather
  2. Add the bot to your group
  3. Copy .env.example to .env and fill in your credentials
  4. Run npm run start

Setup for fetch (historical):
  1. Get API ID and API Hash from https://my.telegram.org/apps
  2. Add TELEGRAM_API_ID and TELEGRAM_API_HASH to .env
  3. Run npm run fetch (will prompt for phone verification on first run)
`);
  } else {
    await runBot();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
