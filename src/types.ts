export interface PresenceEvent {
  id: string;
  timestamp: string;
  direction: "in" | "out";
  confidence: number;
  imageFile?: string;
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
  direction: "in" | "out" | null;
  confidence: number;
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
