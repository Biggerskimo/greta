import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import type { PresenceEvent, ReportData, DailyStat, HourlyStat } from "./types.js";
import { getEventsByDateRange } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const REPORTS_DIR = path.join(__dirname, "..", "reports");

function calculateTimeInside(events: PresenceEvent[]): number {
  let totalMs = 0;
  let lastInTime: Date | null = null;

  for (const event of events) {
    const eventTime = new Date(event.timestamp);

    if (event.direction === "in") {
      lastInTime = eventTime;
    } else if (event.direction === "out" && lastInTime) {
      totalMs += eventTime.getTime() - lastInTime.getTime();
      lastInTime = null;
    }
  }

  return totalMs / (1000 * 60 * 60); // Convert to hours
}

function calculateDailyStats(events: PresenceEvent[]): DailyStat[] {
  const dailyMap = new Map<string, { events: PresenceEvent[] }>();

  for (const event of events) {
    const date = event.timestamp.split("T")[0];
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { events: [] });
    }
    dailyMap.get(date)!.events.push(event);
  }

  const stats: DailyStat[] = [];

  for (const [date, data] of dailyMap) {
    const entries = data.events.filter((e) => e.direction === "in").length;
    const exits = data.events.filter((e) => e.direction === "out").length;
    const hoursInside = calculateTimeInside(data.events);

    stats.push({ date, hoursInside, entries, exits });
  }

  return stats.sort((a, b) => a.date.localeCompare(b.date));
}

function calculateHourlyDistribution(events: PresenceEvent[]): HourlyStat[] {
  const hourlyMap = new Map<number, { entries: number; exits: number }>();

  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, { entries: 0, exits: 0 });
  }

  for (const event of events) {
    const hour = new Date(event.timestamp).getHours();
    const stat = hourlyMap.get(hour)!;

    if (event.direction === "in") {
      stat.entries++;
    } else {
      stat.exits++;
    }
  }

  return Array.from(hourlyMap.entries())
    .map(([hour, stat]) => ({ hour, ...stat }))
    .sort((a, b) => a.hour - b.hour);
}

export async function generateReportData(
  startDate: Date,
  endDate: Date
): Promise<ReportData> {
  const events = await getEventsByDateRange(startDate, endDate);

  const totalEntries = events.filter((e) => e.direction === "in").length;
  const totalExits = events.filter((e) => e.direction === "out").length;
  const totalTimeInside = calculateTimeInside(events);
  const dailyStats = calculateDailyStats(events);
  const hourlyDistribution = calculateHourlyDistribution(events);

  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
    events,
    totalTimeInside,
    totalEntries,
    totalExits,
    dailyStats,
    hourlyDistribution,
  };
}

export async function generateHtmlReport(
  reportData: ReportData
): Promise<string> {
  const templatePath = path.join(TEMPLATES_DIR, "report.html");
  const templateContent = await readFile(templatePath, "utf-8");
  const template = Handlebars.compile(templateContent);

  return template({
    ...reportData,
    totalTimeInsideFormatted: reportData.totalTimeInside.toFixed(1),
    dailyStatsJson: JSON.stringify(reportData.dailyStats),
    hourlyDistributionJson: JSON.stringify(reportData.hourlyDistribution),
    generatedAt: new Date().toISOString(),
  });
}

export async function saveReport(html: string, filename: string): Promise<string> {
  if (!existsSync(REPORTS_DIR)) {
    await mkdir(REPORTS_DIR, { recursive: true });
  }

  const filePath = path.join(REPORTS_DIR, filename);
  await writeFile(filePath, html);
  return filePath;
}

export async function generateReport(
  startDate: Date,
  endDate: Date
): Promise<string> {
  const reportData = await generateReportData(startDate, endDate);
  const html = await generateHtmlReport(reportData);
  const filename = `report_${reportData.startDate}_to_${reportData.endDate}.html`;
  const filePath = await saveReport(html, filename);

  console.log(`Report generated: ${filePath}`);
  console.log(`Period: ${reportData.startDate} to ${reportData.endDate}`);
  console.log(`Total entries: ${reportData.totalEntries}`);
  console.log(`Total exits: ${reportData.totalExits}`);
  console.log(`Total time inside: ${reportData.totalTimeInside.toFixed(1)} hours`);

  return filePath;
}
