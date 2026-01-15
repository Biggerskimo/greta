export interface PresenceEvent {
  id: string;
  timestamp: string;
  direction: "in" | "out" | "invalid";
  confidence: number;
  prey?: boolean;
  imageFile?: string;
  rawText?: string;
}

export interface Config {
  telegramBotToken: string;
  telegramGroupId: number;
  ocrCropX: number;
  ocrCropY: number;
  ocrCropWidth: number;
  ocrCropHeight: number;
}

export interface OcrResult {
  direction: "in" | "out" | "invalid";
  confidence: number;
  prey: boolean;
  rawText: string;
}

export interface PresencePeriod {
  start: string;
  end: string;
  state: "inside" | "outside" | "unknown";
  durationHours: number;
}

export interface ReportData {
  startDate: string;
  endDate: string;
  events: PresenceEvent[];
  periods: PresencePeriod[];
  totalTimeInside: number;
  totalTimeOutside: number;
  totalTimeUnknown: number;
  totalEntries: number;
  totalExits: number;
  dailyStats: DailyStat[];
  hourlyDistribution: HourlyStat[];
  hourlyPresence: HourlyPresence[];
  monthlyPreyCount: MonthlyStat[];
  monthlyPresence: MonthlyPresence[];
  monthlyTimeSeries: MonthlyTimeSeriesStat[];
  monthlyActivity: MonthlyActivityStat[];
}

export interface DailyStat {
  date: string;
  hoursInside: number;
  hoursOutside: number;
  hoursUnknown: number;
  entries: number;
  exits: number;
}

export interface HourlyStat {
  hour: number;
  entries: number;
  exits: number;
}

export interface HourlyPresence {
  hour: number;
  hoursInside: number;
  hoursOutside: number;
  hoursUnknown: number;
}

export interface MonthlyStat {
  month: string;
  preyCount: number;
}

export interface MonthlyPresence {
  month: number; // 1-12
  hoursInside: number;
  hoursOutside: number;
  hoursUnknown: number;
}

export interface MonthlyTimeSeriesStat {
  month: string; // YYYY-MM
  hoursInside: number;
  hoursOutside: number;
  hoursUnknown: number;
}

export interface MonthlyActivityStat {
  month: string; // YYYY-MM
  entries: number;
  exits: number;
}
