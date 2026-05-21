"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  events: { platform: string }[];
}

const COLORS = ["#013B93", "#10B981", "#F59E0B", "#DC2626", "#8B5CF6", "#0EA5E9"];

const PLATFORM_LABELS: Record<string, string> = {
  "chatgpt.com":            "ChatGPT",
  "chat.openai.com":        "ChatGPT",
  "claude.ai":              "Claude",
  "gemini.google.com":      "Gemini",
  "copilot.microsoft.com":  "Copilot",
};

function friendlyName(platform: string): string {
  return PLATFORM_LABELS[platform] || platform;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { name, value, percent } = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg text-sm">
      <div className="font-bold text-slate-700 mb-1">{name}</div>
      <div className="text-slate-500">{value} prompts</div>
      <div className="text-slate-400">{(percent * 100).toFixed(1)}% of total</div>
    </div>
  );
};

const RADIAN = Math.PI / 180;
const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null; // hide labels for tiny slices
  const r  = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x  = cx + r * Math.cos(-midAngle * RADIAN);
  const y  = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export default function PlatformUsage({ events }: Props) {
  // Aggregate by friendly platform name
  const map: Record<string, number> = {};
  events.forEach(e => {
    const name = friendlyName(e.platform || "unknown");
    map[name] = (map[name] || 0) + 1;
  });

  const data = Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (!total) {
    return (
      <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 h-[340px] flex flex-col">
        <h2 className="text-lg font-bold text-[#013B93] mb-1">Platform Usage</h2>
        <p className="text-xs text-slate-400">Total prompts per AI platform</p>
        <div className="flex-1 flex items-center justify-center text-slate-300 text-sm">
          No data yet
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 h-[340px] flex flex-col">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-[#013B93]">Platform Usage</h2>
        <p className="text-xs text-slate-400 mt-0.5">Total prompts per AI platform · {total} total</p>
      </div>

      <div className="flex-1 flex items-center gap-6 min-h-0">

        {/* Pie */}
        <div className="w-[55%] h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                outerRadius={100}
                innerRadius={40}
                paddingAngle={2}
                labelLine={false}
                label={renderLabel}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-3">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-700 truncate">{d.name}</span>
                  <span className="text-sm font-bold text-slate-500 ml-2 shrink-0">{d.value}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width:      `${(d.value / total) * 100}%`,
                      background: COLORS[i % COLORS.length]
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
