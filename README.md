# Greta

Cat presence reporter that monitors a Telegram group for camera images and generates HTML reports.

## How It Works

1. A camera posts images with "in" or "out" text to a Telegram group when the cat enters/exits
2. A Telegram bot receives these images and uses OCR to detect the text
3. Events are stored in a JSON file
4. HTML reports can be generated with charts showing presence patterns

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Get Your Group ID

1. Add the bot to your Telegram group
2. Send a message in the group
3. Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Find the `chat.id` value (it will be negative for groups)

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_GROUP_ID=-1001234567890
```

### 4. Install and Build

```bash
npm install
npm run build
```

## Usage

### Start the Bot

```bash
npm run start
```

The bot will listen for photos in the configured group and record in/out events.

### Generate Reports

```bash
# Current week
npm run report

# Custom date range
npm run report -- --from 2025-01-01 --to 2025-01-15
```

Reports are saved to the `reports/` directory.

## OCR Calibration

If the OCR isn't detecting "in"/"out" text correctly, adjust the crop region in `.env`:

```
OCR_CROP_X=100      # X position of text region
OCR_CROP_Y=50       # Y position of text region
OCR_CROP_WIDTH=200  # Width of text region
OCR_CROP_HEIGHT=100 # Height of text region
```

The app will also try full-image OCR as a fallback if cropping fails.

## Project Structure

```
greta/
├── src/
│   ├── index.ts      # CLI entry point
│   ├── telegram.ts   # Telegram bot
│   ├── ocr.ts        # OCR detection
│   ├── storage.ts    # JSON storage
│   ├── report.ts     # Report generation
│   └── types.ts      # TypeScript types
├── data/             # Event storage
├── reports/          # Generated reports
└── templates/        # HTML templates
```
