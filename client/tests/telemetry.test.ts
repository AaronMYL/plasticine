import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { memorySink, Telemetry, TELEMETRY_EVENTS, type TelemetryRecord } from '../src/telemetry.ts';
import { NOW, renderApp, settle } from './helpers.tsx';

describe('telemetry', () => {
  it('records every sampled telemetry event point', () => {
    const records: TelemetryRecord[] = [];
    const telemetry = new Telemetry(memorySink(records), true, () => NOW);
    for (const name of TELEMETRY_EVENTS) {
      telemetry.track(name, { from: 'test' });
    }
    expect(records.map((record) => record.name)).toEqual([...TELEMETRY_EVENTS]);
    expect(records[0]?.occurredAt).toBe(NOW.toISOString());
  });

  it('emits nothing when telemetry toggle is off', () => {
    const records: TelemetryRecord[] = [];
    const telemetry = new Telemetry(memorySink(records), false);
    for (const name of TELEMETRY_EVENTS) {
      telemetry.track(name);
    }
    expect(records).toEqual([]);
    telemetry.setEnabled(true);
    telemetry.track('view.switched');
    expect(records).toHaveLength(1);
  });

  it('records shell view switches and chat pane collapse/expand events', async () => {
    const app = await renderApp();
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '笔记' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '缩小对话框' }));
    fireEvent.click(screen.getByRole('button', { name: /^展开对话框/ }));
    expect(app.records.map((record) => record.name)).toEqual(['view.switched', 'chat.collapsed', 'chat.expanded']);
    expect(app.records[0]?.payload).toEqual({ from: 'today', to: 'notes' });
  });
});
