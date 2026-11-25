import { createContext, useContext } from 'react';

export const TELEMETRY_EVENTS = [
  'view.switched',
  'chat.collapsed',
  'chat.expanded',
  'conversation.sent',
  'run.details.opened',
  'note.quoted',
  'disagreement.opened',
  'return_brief.opened',
  'tab_group.auto_added',
  'tab_group.auto_left',
  'bookmark.missed',
  'translate.first_screen',
  'translate.page',
] as const;

export type TelemetryName = (typeof TELEMETRY_EVENTS)[number];

export type TelemetryPayload = Record<string, string | number | boolean>;

export interface TelemetryRecord {
  name: TelemetryName;
  occurredAt: string;
  payload: TelemetryPayload;
}

export type TelemetrySink = (record: TelemetryRecord) => void;

const MEMORY_LIMIT = 200;

export function memorySink(records: TelemetryRecord[]): TelemetrySink {
  return (record) => {
    records.push(record);
    if (records.length > MEMORY_LIMIT) {
      records.shift();
    }
  };
}

export class Telemetry {
  private enabled: boolean;
  private readonly sink: TelemetrySink;
  private readonly now: () => Date;
  private readonly listeners = new Set<TelemetrySink>();

  onRecord(listener: TelemetrySink): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  constructor(sink: TelemetrySink, enabled: boolean, now: () => Date = () => new Date()) {
    this.sink = sink;
    this.enabled = enabled;
    this.now = now;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  track(name: TelemetryName, payload: TelemetryPayload = {}): void {
    if (!this.enabled) {
      return;
    }
    const record = { name, occurredAt: this.now().toISOString(), payload };
    this.sink(record);
    for (const listener of [...this.listeners]) {
      listener(record);
    }
  }
}

const DISABLED = new Telemetry(() => undefined, false);

export const TelemetryContext = createContext<Telemetry>(DISABLED);

export function useTelemetry(): Telemetry {
  return useContext(TelemetryContext);
}
