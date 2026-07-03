import type { ReactNode } from 'react';
import type { SensorReading } from '../../types/api';
import type { VirtualSensorRow } from '../hooks/useVirtualSensors';
import type { SelectGroup, SelectOption } from '../../components/ui/Select';
import { formatTemperature } from '../../utils/formatters';
import { getChipDisplayName } from '../../config/sensorLabels';
import { getSensorDisplayName } from '../../utils/displayNames';

/**
 * Options builder + renderers for the Control Sensor <Select> dropdowns in
 * SystemCard (zone + per-fan). Values: "" | __highest__ | __virtual__* |
 * __group__<chip> | sensor id (unchanged from Design0).
 */

interface SensorOptionData {
  name: string;
  tempText: string | null;
}

export function buildSensorOptions(params: {
  highestTemperature: number | null;
  virtualRows: VirtualSensorRow[];
  /** Visible (not hidden) sensors grouped by chip. */
  sensorGroups: Record<string, SensorReading[]>;
  /** Group ids in dashboard order (orderGroupIds). */
  sortedGroupIds: string[];
  /** Visible sensors in dropdown order (compareSensorsForDropdown). */
  sortedSensors: SensorReading[];
  /** Label for the "" row; bulk edit passes "Don't change". */
  emptyLabel?: string;
}): SelectGroup<string>[] {
  const {
    highestTemperature,
    virtualRows,
    sensorGroups,
    sortedGroupIds,
    sortedSensors,
    emptyLabel = 'Select Sensor...',
  } = params;

  const opt = (
    value: string,
    name: string,
    tempText: string | null,
    title?: string
  ): SelectOption<string> => ({
    value,
    label: tempText ? `${name} (${tempText})` : name, // search + type-ahead target
    title,
    data: { name, tempText } satisfies SensorOptionData,
  });

  const groups: SelectGroup<string>[] = [
    {
      // Headerless group: top-level rows above the labeled groups.
      label: '',
      options: [
        opt('', emptyLabel, null),
        opt(
          '__highest__',
          'Highest',
          formatTemperature(highestTemperature, '0.0°C'),
          'Use the Highest Temperature on the system'
        ),
      ],
    },
  ];

  if (virtualRows.length > 0) {
    groups.push({
      label: 'Virtual',
      options: virtualRows.map(({ def, reading }) =>
        opt(
          reading.id,
          def.name,
          Number.isNaN(reading.temperature) ? null : formatTemperature(reading.temperature),
          'Virtual sensor'
        )
      ),
    });
  }

  const multiSensorGroupIds = sortedGroupIds.filter((id) => sensorGroups[id].length > 1);
  if (multiSensorGroupIds.length > 0) {
    groups.push({
      label: 'Groups',
      options: multiSensorGroupIds.map((groupId) => {
        const groupSensors = sensorGroups[groupId];
        const highestTemp = Math.max(...groupSensors.map((s) => s.temperature));
        return opt(
          `__group__${groupId}`,
          getChipDisplayName(groupId, groupSensors),
          formatTemperature(highestTemp),
          'Selecting a group uses the Highest Temperature of that group'
        );
      }),
    });
  }

  if (sortedSensors.length > 0) {
    groups.push({
      label: 'Sensors',
      options: sortedSensors.map((sensor) =>
        opt(
          sensor.id,
          getSensorDisplayName(sensor.id, sensor.name, sensor.label),
          formatTemperature(sensor.temperature)
        )
      ),
    });
  }

  return groups;
}

/**
 * Renderers: name + temp, styled by .sensor-select-name/-temp (sensors-fans.css).
 */
export function renderSensorTrigger(selected: SelectOption<string> | null): ReactNode {
  const data = selected?.data as SensorOptionData | undefined;
  if (!data) return <span className="sensor-select-name">Select Sensor...</span>;
  return (
    <>
      <span className="sensor-select-name">{data.name}</span>
      {data.tempText && <span className="sensor-select-temp">({data.tempText})</span>}
    </>
  );
}

export function renderSensorOption(opt: SelectOption<string>): ReactNode {
  const data = opt.data as SensorOptionData | undefined;
  if (!data) return <span className="pk-select-option-label">{opt.label}</span>;
  return (
    <>
      <span className="sensor-select-name">{data.name}</span>
      {data.tempText && <span className="sensor-select-temp">({data.tempText})</span>}
    </>
  );
}
