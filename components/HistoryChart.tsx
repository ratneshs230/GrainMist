
import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { MoistureReading } from '../types';

interface HistoryChartProps {
  data: MoistureReading[];
}

const HistoryChart: React.FC<HistoryChartProps> = ({ data }) => {
  const chartData = data
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => ({
      name: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      moisture: item.moisturePercentage,
    }));

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-stone-400 border border-dashed border-stone-300 rounded-xl">
        No readings yet. Start analysis to see history.
      </div>
    );
  }

  return (
    <div className="h-48 w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            stroke="#9ca3af"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[5, 25]}
            tick={{ fontSize: 10 }}
            stroke="#9ca3af"
            axisLine={false}
            tickLine={false}
            unit="%"
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Line
            type="monotone"
            dataKey="moisture"
            stroke="#4a7c59"
            strokeWidth={3}
            dot={{ r: 4, fill: '#4a7c59', strokeWidth: 2, stroke: '#fff' }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default HistoryChart;
