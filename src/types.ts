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

export interface ReportData {
  startDate: string;
  endDate: string;
  events: PresenceEvent[];
  totalTimeInside: number;
  totalEntries: number;
  totalExits: number;
  dailyStats: DailyStat[];
  hourlyDistribution: HourlyStat[];
}

export interface DailyStat {
  date: string;
  hoursInside: number;
  entries: number;
  exits: number;
}

export interface HourlyStat {
  hour: number;
  entries: number;
  exits: number;
}
