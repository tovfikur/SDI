import type { ReactElement } from 'react';
import {
  AreaChart as ReAreaChart,
  BarChart as ReBarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { useChartTheme } from './chartTheme';
import type { ChartTheme } from './chartTheme';
import { ChartTooltip } from './ChartCard';

const AXIS_TICK = { fontSize: 11, fill: 'var(--chart-axis, #94a3b8)' };

function baseProps(theme: ChartTheme) {
  return {
    margin: { top: 8, right: 8, bottom: 0, left: -18 },
    CartesianGrid: <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />,
  };
}

export function AreaTrendChart({
  data,
  xKey,
  series,
  height = 240,
  valueFormatter,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Array<{ key: string; color: string }>;
  height?: number;
  valueFormatter?: (value: number | string, name: string) => string;
}): ReactElement {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReAreaChart data={data} margin={baseProps(theme).margin}>
        {baseProps(theme).CartesianGrid}
        <XAxis dataKey={xKey} tick={AXIS_TICK} stroke={theme.axis} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS_TICK} stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} width={34} />
        <Tooltip content={<ChartTooltip {...(valueFormatter ? { valueFormatter } : {})} />} cursor={{ stroke: theme.axis, strokeDasharray: '3 3' }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </ReAreaChart>
    </ResponsiveContainer>
  );
}

export function VerticalBarChart({
  data,
  xKey,
  barKey,
  color = 'var(--primary)',
  height = 240,
  onBarClick,
  valueFormatter,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  barKey: string;
  color?: string;
  height?: number;
  onBarClick?: (entry: Record<string, unknown>) => void;
  valueFormatter?: (value: number | string, name: string) => string;
}): ReactElement {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} margin={baseProps(theme).margin}>
        {baseProps(theme).CartesianGrid}
        <XAxis dataKey={xKey} tick={AXIS_TICK} stroke={theme.axis} tickLine={false} axisLine={false} interval={0} angle={-28} textAnchor="end" height={52} />
        <YAxis tick={AXIS_TICK} stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} width={34} />
        <Tooltip content={<ChartTooltip {...(valueFormatter ? { valueFormatter } : {})} />} cursor={{ fill: theme.grid, fillOpacity: 0.35 }} />
        <Bar
          dataKey={barKey}
          fill={color}
          radius={[5, 5, 0, 0]}
          maxBarSize={42}
          onClick={(entry) => onBarClick?.(entry as unknown as Record<string, unknown>)}
          style={{ cursor: onBarClick ? 'pointer' : 'default' }}
        >
          <LabelList dataKey={barKey} position="top" style={{ fontSize: 10, fill: theme.textDim }} />
        </Bar>
      </ReBarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBarChart({
  data,
  nameKey,
  valueKey,
  height = 260,
  onBarClick,
  color = 'var(--primary)',
  valueFormatter,
}: {
  data: Array<Record<string, unknown> & { [k: string]: unknown }>;
  nameKey: string;
  valueKey: string;
  height?: number;
  onBarClick?: (entry: Record<string, unknown>) => void;
  color?: string;
  valueFormatter?: (value: number | string, name: string) => string;
}): ReactElement {
  const theme = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 8 }}>
        {baseProps(theme).CartesianGrid}
        <XAxis type="number" tick={AXIS_TICK} stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey={nameKey}
          tick={{ fontSize: 11, fill: theme.text }}
          tickLine={false}
          axisLine={false}
          width={130}
        />
        <Tooltip content={<ChartTooltip {...(valueFormatter ? { valueFormatter } : {})} />} cursor={{ fill: theme.grid, fillOpacity: 0.35 }} />
        <Bar
          dataKey={valueKey}
          fill={color}
          radius={[0, 5, 5, 0]}
          maxBarSize={20}
          onClick={(entry) => onBarClick?.(entry as unknown as Record<string, unknown>)}
          style={{ cursor: onBarClick ? 'pointer' : 'default' }}
        >
          <LabelList
            dataKey={valueKey}
            position="right"
            style={{ fontSize: 11, fill: theme.textDim, fontWeight: 600 }}
          />
        </Bar>
      </ReBarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  height = 210,
  onSliceClick,
  valueFormatter,
}: {
  data: Array<{ key: string; value: number; color?: string }>;
  height?: number;
  onSliceClick?: (key: string) => void;
  valueFormatter?: (value: number | string, name: string) => string;
}): ReactElement {
  const theme = useChartTheme();
  const total = data.reduce((s, d) => s + d.value, 0);
  const label = (props: PieLabelRenderProps): string => {
    const v = Number(props.value ?? 0);
    if (total === 0) return '';
    const pct = Math.round((v / total) * 100);
    return pct >= 6 ? `${pct}%` : '';
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <Tooltip content={<ChartTooltip {...(valueFormatter ? { valueFormatter } : {})} />} />
        <Pie
          data={data.map((d) => ({ name: d.key, value: d.value }))}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          cornerRadius={4}
          stroke="none"
          fill={theme.text}
          label={label}
          labelLine={false}
          onClick={(entry) => onSliceClick?.(String(entry.name ?? ''))}
          style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
        >
          {data.map((d) => (
            <Cell key={d.key} fill={d.color ?? theme.axis} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}