import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import type { PresenceEvent, ReportData, DailyStat, HourlyStat, PresencePeriod } from "./types.js";
import { getEventsByDateRange } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const REPORTS_DIR = path.join(__dirname, "..", "reports");

function calculatePresencePeriods(events: PresenceEvent[]): PresencePeriod[] {
  const periods: PresencePeriod[] = [];

  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i];
    const next = events[i + 1];

    const start = current.timestamp;
    const end = next.timestamp;
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    const durationHours = durationMs / (1000 * 60 * 60);

    let state: "inside" | "outside" | "unknown";

    if (current.direction === "in" && next.direction === "out") {
      state = "inside";
    } else if (current.direction === "out" && next.direction === "in") {
      state = "outside";
    } else {
      // in->in or out->out = unknown
      state = "unknown";
    }

    periods.push({ start, end, state, durationHours });
  }

  return periods;
}

function calculateTotalTimeByState(periods: PresencePeriod[]): {
  inside: number;
  outside: number;
  unknown: number;
} {
  let inside = 0;
  let outside = 0;
  let unknown = 0;

  for (const period of periods) {
    if (period.state === "inside") {
      inside += period.durationHours;
    } else if (period.state === "outside") {
      outside += period.durationHours;
    } else {
      unknown += period.durationHours;
    }
  }

  return { inside, outside, unknown };
}

function splitPeriodAcrossDays(period: PresencePeriod): Map<string, { state: string; hours: number }> {
  const result = new Map<string, { state: string; hours: number }>();

  const startDate = new Date(period.start);
  const endDate = new Date(period.end);

  let currentDate = new Date(startDate);
  currentDate.setUTCHours(0, 0, 0, 0);

  while (currentDate < endDate) {
    const dayStart = new Date(currentDate);
    const dayEnd = new Date(currentDate);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Calculate overlap between period and this day
    const overlapStart = startDate > dayStart ? startDate : dayStart;
    const overlapEnd = endDate < dayEnd ? endDate : dayEnd;

    if (overlapStart < overlapEnd) {
      const hoursInDay = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
      const dateKey = currentDate.toISOString().split("T")[0];

      if (!result.has(dateKey)) {
        result.set(dateKey, { state: period.state, hours: 0 });
      }
      const existing = result.get(dateKey)!;
      existing.hours += hoursInDay;
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return result;
}

function calculateDailyStats(
  events: PresenceEvent[],
  periods: PresencePeriod[],
  reportStartDate: Date,
  reportEndDate: Date
): DailyStat[] {
  const dailyMap = new Map<string, {
    events: PresenceEvent[];
    hoursInside: number;
    hoursOutside: number;
    hoursUnknown: number;
  }>();

  // Initialize all days in the report range
  const currentDate = new Date(reportStartDate);
  currentDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(reportEndDate);
  endDate.setUTCHours(23, 59, 59, 999);

  while (currentDate <= endDate) {
    const dateKey = currentDate.toISOString().split("T")[0];
    dailyMap.set(dateKey, { events: [], hoursInside: 0, hoursOutside: 0, hoursUnknown: 0 });
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  // Group events by date
  for (const event of events) {
    const date = event.timestamp.split("T")[0];
    if (dailyMap.has(date)) {
      dailyMap.get(date)!.events.push(event);
    }
  }

  // Split periods across days
  for (const period of periods) {
    const dayHours = splitPeriodAcrossDays(period);

    for (const [date, { state, hours }] of dayHours) {
      if (dailyMap.has(date)) {
        const data = dailyMap.get(date)!;
        if (state === "inside") {
          data.hoursInside += hours;
        } else if (state === "outside") {
          data.hoursOutside += hours;
        } else {
          data.hoursUnknown += hours;
        }
      }
    }
  }

  // Fill gaps with unknown time to reach 24 hours per day
  for (const [date, data] of dailyMap) {
    const totalAccountedHours = data.hoursInside + data.hoursOutside + data.hoursUnknown;
    const missingHours = 24 - totalAccountedHours;

    if (missingHours > 0.01) { // Small threshold for floating point errors
      data.hoursUnknown += missingHours;
    }
  }

  const stats: DailyStat[] = [];

  for (const [date, data] of dailyMap) {
    const entries = data.events.filter((e) => e.direction === "in").length;
    const exits = data.events.filter((e) => e.direction === "out").length;

    stats.push({
      date,
      hoursInside: data.hoursInside,
      hoursOutside: data.hoursOutside,
      hoursUnknown: data.hoursUnknown,
      entries,
      exits,
    });
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

  const periods = calculatePresencePeriods(events);
  const dailyStats = calculateDailyStats(events, periods, startDate, endDate);
  const hourlyDistribution = calculateHourlyDistribution(events);

  // Calculate totals from daily stats (which include gap filling)
  const totalTimeInside = dailyStats.reduce((sum, day) => sum + day.hoursInside, 0);
  const totalTimeOutside = dailyStats.reduce((sum, day) => sum + day.hoursOutside, 0);
  const totalTimeUnknown = dailyStats.reduce((sum, day) => sum + day.hoursUnknown, 0);

  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
    events,
    periods,
    totalTimeInside,
    totalTimeOutside,
    totalTimeUnknown,
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
    totalTimeOutsideFormatted: reportData.totalTimeOutside.toFixed(1),
    totalTimeUnknownFormatted: reportData.totalTimeUnknown.toFixed(1),
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

  console.log(`Bericht erstellt: ${filePath}`);
  console.log(`Zeitraum: ${reportData.startDate} bis ${reportData.endDate}`);
  console.log(`Eintritte gesamt: ${reportData.totalEntries}`);
  console.log(`Austritte gesamt: ${reportData.totalExits}`);
  console.log(`Zeit drinnen: ${reportData.totalTimeInside.toFixed(1)} Stunden`);
  console.log(`Zeit draußen: ${reportData.totalTimeOutside.toFixed(1)} Stunden`);
  console.log(`Zeit unbekannt: ${reportData.totalTimeUnknown.toFixed(1)} Stunden`);

  return filePath;
}
