"use client";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { Day } from "@/lib/analytics/engine";
export function TrendChart({
  days,
  metric,
  label,
  unit = "",
  color = "#a5cfff",
  type = "area",
  target,
}: {
  days: Day[];
  metric: keyof Day;
  label: string;
  unit?: string;
  color?: string;
  type?: "area" | "bar" | "line";
  target?: number;
}) {
  const [table, setTable] = useState(false),
    data = days.map((day) => ({
      date: day.day.slice(5),
      value: typeof day[metric] === "number" ? day[metric] : null,
    }));
  const valid = data.filter((d) => d.value !== null).length;
  if (!valid)
    return (
      <div className="chart-empty">
        <span className="empty-line" />
        <p>No supported observations in this window.</p>
        <small>Missing dates stay empty.</small>
      </div>
    );
  const common = (
    <>
      <CartesianGrid stroke="#27303a" vertical={false} />
      <XAxis
        dataKey="date"
        tick={{ fill: "#83909e", fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        minTickGap={36}
      />
      <YAxis
        tick={{ fill: "#83909e", fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        width={40}
        domain={
          metric === "weight" ||
          metric === "weightSmooth" ||
          metric === "skinDeviation"
            ? ["auto", "auto"]
            : [0, "auto"]
        }
      />
      <Tooltip
        contentStyle={{
          background: "#171d24",
          border: "1px solid #3a4652",
          borderRadius: 8,
          color: "#e9eef4",
        }}
        formatter={(value) => [
          typeof value === "number"
            ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`
            : "Unavailable",
          label,
        ]}
      />
      {target !== undefined && (
        <ReferenceLine
          y={target}
          stroke="#7e8d9d"
          strokeDasharray="4 4"
          label={{ value: "Target", fill: "#98a6b6", fontSize: 10 }}
        />
      )}
    </>
  );
  return (
    <figure className="chart">
      <figcaption className="sr-only">
        {label}, {unit}. {valid} observed days of {days.length}. Missing dates
        are gaps.
      </figcaption>
      <div
        className="chart-canvas"
        role="img"
        aria-label={`${label} trend: ${valid} observed days in the selected ${days.length}-day range`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {type === "bar" ? (
            <BarChart data={data} accessibilityLayer>
              {common}
              <Bar
                dataKey="value"
                fill={color}
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
              />
            </BarChart>
          ) : type === "line" ? (
            <LineChart data={data} accessibilityLayer>
              {common}
              <Line
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                dot={valid < 15}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <AreaChart data={data} accessibilityLayer>
              {common}
              <Area
                dataKey="value"
                stroke={color}
                fill={color}
                fillOpacity={0.08}
                strokeWidth={2}
                dot={valid < 10}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <button
        className="text-button chart-table-toggle"
        onClick={() => setTable(!table)}
        aria-expanded={table}
      >
        {table ? "Hide" : "View"} accessible data table
      </button>
      {table && (
        <div
          className="table-scroll"
          role="region"
          aria-label="Scrollable data table"
          tabIndex={0}
        >
          <table>
            <caption>
              {label} observations ({unit})
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{d.day}</th>
                  <td>
                    {typeof d[metric] === "number"
                      ? (d[metric] as number).toFixed(1)
                      : "No observation"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
