// 工具组开关的存取（M5）：一组一行。开关是用户确认字段：只有带设备确认的写入能改（仓库硬规矩：用户确认的字段
// 只接受带设备确认的请求，模型工具写不到）。还没有行的组按 shared 里的默认开关算，第一次改时才建行。

import {
  DeviceConfirmationSchema,
  TOOL_GROUP_IDS,
  ToolGroupSchema,
  type DeviceConfirmation,
  type ToolGroup,
  type ToolGroupId,
} from '../../shared/state.ts';
import { checked, encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import { StateError, versionConflict } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  id: 'text',
  enabled: 'boolean',
  version: 'integer',
  updatedAt: 'text',
  confirmedByDeviceId: 'text',
  confirmedByDeviceAt: 'text',
};

export function createToolGroupStore(context: StoreContext) {
  function read(id: ToolGroupId): ToolGroup | undefined {
    const row = context.db.get('SELECT * FROM tool_groups WHERE id = $id', { id });
    return row === undefined ? undefined : readRow(ToolGroupSchema, COLUMNS, row, 'tool_groups');
  }

  return {
    get: read,
    /** Every stored group (groups never switched have no row). */
    all: (): ToolGroup[] =>
      context.db.all('SELECT * FROM tool_groups ORDER BY id').map((row) => {
        return readRow(ToolGroupSchema, COLUMNS, row, 'tool_groups');
      }),
    /**
     * Switches a group on or off. `expectedVersion` is the version the user saw (0 for a group still on its default);
     * the confirmation is required, like every user-confirmed field.
     */
    confirm(id: ToolGroupId, expectedVersion: number, enabled: boolean, confirmation: DeviceConfirmation): ToolGroup {
      if (!(TOOL_GROUP_IDS as readonly string[]).includes(id)) {
        throw new StateError('invalid_input', `没有工具组 ${id}`, { field: 'id' });
      }
      const device = checked(DeviceConfirmationSchema, confirmation, 'confirmation_required', '工具组开关要设备确认');
      return context.db.transaction(() => {
        const current = read(id);
        const version = current?.version ?? 0;
        if (version !== expectedVersion) {
          throw versionConflict('tool_groups', id, expectedVersion, version);
        }
        const next = checked(
          ToolGroupSchema,
          {
            id,
            enabled,
            version: version + 1,
            updatedAt: context.now(),
            confirmedByDeviceId: device.deviceId,
            confirmedByDeviceAt: device.confirmedAt,
          },
          'invalid_input',
          '工具组开关',
        );
        const params = encodeRow(COLUMNS, next);
        if (current === undefined) {
          const { names, placeholders } = sqlColumns(COLUMNS);
          context.db.run(`INSERT INTO tool_groups (${names}) VALUES (${placeholders})`, params);
        } else {
          context.db.run(
            `UPDATE tool_groups SET enabled = $enabled, version = $version, updated_at = $updated_at,
              confirmed_by_device_id = $confirmed_by_device_id, confirmed_by_device_at = $confirmed_by_device_at
              WHERE id = $id`,
            params,
          );
        }
        return next;
      });
    },
  };
}

export type ToolGroupStore = ReturnType<typeof createToolGroupStore>;
