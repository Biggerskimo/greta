import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { PresenceEvent } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

export async function loadEvents(): Promise<PresenceEvent[]> {
  await ensureDataDir();

  if (!existsSync(EVENTS_FILE)) {
    return [];
  }

  const data = await readFile(EVENTS_FILE, "utf-8");
  return JSON.parse(data) as PresenceEvent[];
}

export async function saveEvents(events: PresenceEvent[]): Promise<void> {
  await ensureDataDir();
  await writeFile(EVENTS_FILE, JSON.stringify(events, null, 2));
}

export async function addEvent(event: PresenceEvent): Promise<void> {
  const events = await loadEvents();
  events.push(event);
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  await saveEvents(events);
}

export async function getEventsByDateRange(
  startDate: Date,
  endDate: Date
): Promise<PresenceEvent[]> {
  const events = await loadEvents();
  return events.filter((event) => {
    const eventDate = new Date(event.timestamp);
    return eventDate >= startDate && eventDate <= endDate;
  });
}

export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
