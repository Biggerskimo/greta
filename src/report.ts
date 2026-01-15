import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import type { PresenceEvent, ReportData, DailyStat, HourlyStat, PresencePeriod, HourlyPresence, MonthlyStat, MonthlyPresence, MonthlyTimeSeriesStat, MonthlyActivityStat } from "./types.js";
import { getEventsByDateRange } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const REPORTS_DIR = path.join(__dirname, "..", "reports");

// German winter time offset (UTC+1)
const TIMEZONE_OFFSET_MS = 1 * 60 * 60 * 1000; // 1 hour in milliseconds

// Helper function to convert UTC timestamp to UTC+1
function toLocalTime(date: Date): Date {
  return new Date(date.getTime() + TIMEZONE_OFFSET_MS);
}

// Helper function to get start of day in UTC+1
function getStartOfDay(date: Date): Date {
  const localDate = toLocalTime(date);
  const startOfDay = new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    0, 0, 0, 0
  ));
  return new Date(startOfDay.getTime() - TIMEZONE_OFFSET_MS);
}

// Helper function to get end of day in UTC+1
function getEndOfDay(date: Date): Date {
  const localDate = toLocalTime(date);
  const endOfDay = new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    23, 59, 59, 999
  ));
  return new Date(endOfDay.getTime() - TIMEZONE_OFFSET_MS);
}

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

  let currentDate = getStartOfDay(startDate);

  while (currentDate < endDate) {
    const dayStart = currentDate;
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Calculate overlap between period and this day
    const overlapStart = startDate > dayStart ? startDate : dayStart;
    const overlapEnd = endDate < dayEnd ? endDate : dayEnd;

    if (overlapStart < overlapEnd) {
      const hoursInDay = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
      const localDate = toLocalTime(currentDate);
      const dateKey = localDate.toISOString().split("T")[0];

      if (!result.has(dateKey)) {
        result.set(dateKey, { state: period.state, hours: 0 });
      }
      const existing = result.get(dateKey)!;
      existing.hours += hoursInDay;
    }

    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
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

  // Initialize all days in the report range (in UTC+1)
  let currentDate = getStartOfDay(reportStartDate);
  const endDate = getEndOfDay(reportEndDate);

  while (currentDate <= endDate) {
    const localDate = toLocalTime(currentDate);
    const dateKey = localDate.toISOString().split("T")[0];
    dailyMap.set(dateKey, { events: [], hoursInside: 0, hoursOutside: 0, hoursUnknown: 0 });
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }

  // Group events by date (in UTC+1)
  for (const event of events) {
    const eventDate = toLocalTime(new Date(event.timestamp));
    const date = eventDate.toISOString().split("T")[0];
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
    const localTime = toLocalTime(new Date(event.timestamp));
    const hour = localTime.getUTCHours();
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

function calculateHourlyPresence(periods: PresencePeriod[]): HourlyPresence[] {
  const hourlyMap = new Map<number, { hoursInside: number; hoursOutside: number; hoursUnknown: number }>();

  // Initialize all hours
  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, { hoursInside: 0, hoursOutside: 0, hoursUnknown: 0 });
  }

  // For each period, split it across hours (in UTC+1)
  for (const period of periods) {
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);

    let currentTime = new Date(startDate);

    while (currentTime < endDate) {
      const localTime = toLocalTime(currentTime);
      const hour = localTime.getUTCHours();

      // Calculate hour boundaries in UTC+1
      const hourStart = new Date(currentTime);
      const hourEnd = new Date(hourStart);
      hourEnd.setTime(hourEnd.getTime() + 60 * 60 * 1000); // Add 1 hour

      // Calculate overlap between period and this hour
      const overlapStart = startDate > hourStart ? startDate : hourStart;
      const overlapEnd = endDate < hourEnd ? endDate : hourEnd;

      if (overlapStart < overlapEnd) {
        const hoursInThisSlot = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
        const stat = hourlyMap.get(hour)!;

        if (period.state === "inside") {
          stat.hoursInside += hoursInThisSlot;
        } else if (period.state === "outside") {
          stat.hoursOutside += hoursInThisSlot;
        } else {
          stat.hoursUnknown += hoursInThisSlot;
        }
      }

      // Move to next hour
      currentTime = hourEnd;
    }
  }

  return Array.from(hourlyMap.entries())
    .map(([hour, stat]) => ({ hour, ...stat }))
    .sort((a, b) => a.hour - b.hour);
}

function calculateMonthlyPreyCount(events: PresenceEvent[], startDate: Date, endDate: Date): MonthlyStat[] {
  const monthlyMap = new Map<string, number>();

  // Initialize all months in the date range with 0 (in UTC+1)
  const localStart = toLocalTime(startDate);
  const localEnd = toLocalTime(endDate);

  let currentMonth = new Date(Date.UTC(
    localStart.getUTCFullYear(),
    localStart.getUTCMonth(),
    1, 0, 0, 0, 0
  ));

  const endMonth = new Date(Date.UTC(
    localEnd.getUTCFullYear(),
    localEnd.getUTCMonth(),
    1, 0, 0, 0, 0
  ));

  while (currentMonth <= endMonth) {
    const monthKey = currentMonth.toISOString().substring(0, 7); // YYYY-MM
    monthlyMap.set(monthKey, 0);
    currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1);
  }

  // Count prey events (in UTC+1)
  for (const event of events) {
    if (event.prey) {
      const localTime = toLocalTime(new Date(event.timestamp));
      const month = localTime.toISOString().substring(0, 7); // YYYY-MM
      if (monthlyMap.has(month)) {
        monthlyMap.set(month, (monthlyMap.get(month) || 0) + 1);
      }
    }
  }

  return Array.from(monthlyMap.entries())
    .map(([month, preyCount]) => ({ month, preyCount }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function calculateMonthlyPresence(periods: PresencePeriod[]): MonthlyPresence[] {
  const monthlyMap = new Map<number, { hoursInside: number; hoursOutside: number; hoursUnknown: number }>();

  // Initialize all months (1-12)
  for (let m = 1; m <= 12; m++) {
    monthlyMap.set(m, { hoursInside: 0, hoursOutside: 0, hoursUnknown: 0 });
  }

  // For each period, split it across months of the year (in UTC+1)
  for (const period of periods) {
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);

    let currentTime = new Date(startDate);

    while (currentTime < endDate) {
      const localTime = toLocalTime(currentTime);
      const month = localTime.getUTCMonth() + 1; // 1-12

      // Calculate month boundaries in UTC+1
      const monthStart = new Date(Date.UTC(
        localTime.getUTCFullYear(),
        localTime.getUTCMonth(),
        1, 0, 0, 0, 0
      ));
      const monthStartUTC = new Date(monthStart.getTime() - TIMEZONE_OFFSET_MS);

      const monthEnd = new Date(monthStart);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const monthEndUTC = new Date(monthEnd.getTime() - TIMEZONE_OFFSET_MS);

      // Calculate overlap between period and this month
      const overlapStart = startDate > monthStartUTC ? startDate : monthStartUTC;
      const overlapEnd = endDate < monthEndUTC ? endDate : monthEndUTC;

      if (overlapStart < overlapEnd) {
        const hoursInThisMonth = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
        const stat = monthlyMap.get(month)!;

        if (period.state === "inside") {
          stat.hoursInside += hoursInThisMonth;
        } else if (period.state === "outside") {
          stat.hoursOutside += hoursInThisMonth;
        } else {
          stat.hoursUnknown += hoursInThisMonth;
        }
      }

      // Move to next month
      currentTime = monthEndUTC;
    }
  }

  return Array.from(monthlyMap.entries())
    .map(([month, stat]) => ({ month, ...stat }))
    .sort((a, b) => a.month - b.month);
}

function calculateMonthlyTimeSeries(
  periods: PresencePeriod[],
  dailyStats: DailyStat[]
): MonthlyTimeSeriesStat[] {
  const monthlyMap = new Map<string, { hoursInside: number; hoursOutside: number; hoursUnknown: number }>();

  // Aggregate daily stats by month
  for (const day of dailyStats) {
    const monthKey = day.date.substring(0, 7); // YYYY-MM

    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, { hoursInside: 0, hoursOutside: 0, hoursUnknown: 0 });
    }

    const stat = monthlyMap.get(monthKey)!;
    stat.hoursInside += day.hoursInside;
    stat.hoursOutside += day.hoursOutside;
    stat.hoursUnknown += day.hoursUnknown;
  }

  return Array.from(monthlyMap.entries())
    .map(([month, stat]) => ({ month, ...stat }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function calculateMonthlyActivity(events: PresenceEvent[], startDate: Date, endDate: Date): MonthlyActivityStat[] {
  const monthlyMap = new Map<string, { entries: number; exits: number }>();

  // Initialize all months in the date range
  const localStart = toLocalTime(startDate);
  const localEnd = toLocalTime(endDate);

  let currentMonth = new Date(Date.UTC(
    localStart.getUTCFullYear(),
    localStart.getUTCMonth(),
    1, 0, 0, 0, 0
  ));

  const endMonth = new Date(Date.UTC(
    localEnd.getUTCFullYear(),
    localEnd.getUTCMonth(),
    1, 0, 0, 0, 0
  ));

  while (currentMonth <= endMonth) {
    const monthKey = currentMonth.toISOString().substring(0, 7); // YYYY-MM
    monthlyMap.set(monthKey, { entries: 0, exits: 0 });
    currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1);
  }

  // Count events by month
  for (const event of events) {
    const localTime = toLocalTime(new Date(event.timestamp));
    const month = localTime.toISOString().substring(0, 7); // YYYY-MM

    if (monthlyMap.has(month)) {
      const stat = monthlyMap.get(month)!;
      if (event.direction === "in") {
        stat.entries++;
      } else if (event.direction === "out") {
        stat.exits++;
      }
    }
  }

  return Array.from(monthlyMap.entries())
    .map(([month, stat]) => ({ month, ...stat }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function generateReportData(
  startDate: Date,
  endDate: Date
): Promise<ReportData> {
  const allEvents = await getEventsByDateRange(startDate, endDate);

  // Filter out invalid events for presence calculation
  const validEvents = allEvents.filter((e) => e.direction !== "invalid");

  const totalEntries = validEvents.filter((e) => e.direction === "in").length;
  const totalExits = validEvents.filter((e) => e.direction === "out").length;

  const periods = calculatePresencePeriods(validEvents);
  const dailyStats = calculateDailyStats(validEvents, periods, startDate, endDate);
  const hourlyDistribution = calculateHourlyDistribution(validEvents);
  const hourlyPresence = calculateHourlyPresence(periods);
  const monthlyPreyCount = calculateMonthlyPreyCount(allEvents, startDate, endDate);
  const monthlyPresence = calculateMonthlyPresence(periods);
  const monthlyTimeSeries = calculateMonthlyTimeSeries(periods, dailyStats);
  const monthlyActivity = calculateMonthlyActivity(validEvents, startDate, endDate);

  // Calculate totals from daily stats (which include gap filling)
  const totalTimeInside = dailyStats.reduce((sum, day) => sum + day.hoursInside, 0);
  const totalTimeOutside = dailyStats.reduce((sum, day) => sum + day.hoursOutside, 0);
  const totalTimeUnknown = dailyStats.reduce((sum, day) => sum + day.hoursUnknown, 0);

  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
    events: allEvents, // Include all events (including invalid) for display
    periods,
    totalTimeInside,
    totalTimeOutside,
    totalTimeUnknown,
    totalEntries,
    totalExits,
    dailyStats,
    hourlyDistribution,
    hourlyPresence,
    monthlyPreyCount,
    monthlyPresence,
    monthlyTimeSeries,
    monthlyActivity,
  };
}

export async function generateHtmlReport(
  reportData: ReportData
): Promise<string> {
  const templatePath = path.join(TEMPLATES_DIR, "report.html");
  const templateContent = await readFile(templatePath, "utf-8");
  const template = Handlebars.compile(templateContent);

  // Limit daily stats to last 12 months if period is longer
  let displayDailyStats = reportData.dailyStats;
  if (reportData.dailyStats.length > 365) {
    displayDailyStats = reportData.dailyStats.slice(-365);
  }

  // Limit events to last 50
  const displayEvents = reportData.events.slice(-50).reverse();

  return template({
    ...reportData,
    events: displayEvents,
    totalTimeInsideFormatted: reportData.totalTimeInside.toFixed(1),
    totalTimeOutsideFormatted: reportData.totalTimeOutside.toFixed(1),
    totalTimeUnknownFormatted: reportData.totalTimeUnknown.toFixed(1),
    dailyStatsJson: JSON.stringify(displayDailyStats),
    hourlyDistributionJson: JSON.stringify(reportData.hourlyDistribution),
    hourlyPresenceJson: JSON.stringify(reportData.hourlyPresence),
    monthlyPreyCountJson: JSON.stringify(reportData.monthlyPreyCount),
    monthlyPresenceJson: JSON.stringify(reportData.monthlyPresence),
    monthlyTimeSeriesJson: JSON.stringify(reportData.monthlyTimeSeries),
    monthlyActivityJson: JSON.stringify(reportData.monthlyActivity),
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
