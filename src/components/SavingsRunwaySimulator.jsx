import { useId, useMemo, useState } from "react";
import { money, number } from "../lib/format.js";
import { Card, CardHeader } from "./ui.jsx";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, number(value)));

function monthReached(points, target, key) {
  if (!(target > 0)) return null;
  return points.find((point) => point[key] >= target)?.month ?? null;
}

function linePath(points, key, x, y) {
  return points.map((point, index) => `${index ? "L" : "M"}${x(point.month).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
}

function areaPath(points, key, x, y, bottom) {
  if (!points.length) return "";
  return `${linePath(points, key, x, y)} L${x(points.at(-1).month).toFixed(1)},${bottom} L${x(points[0].month).toFixed(1)},${bottom} Z`;
}

function Countdown({ label, target, month }) {
  return (
    <div className={`milestone-badge ${month != null ? "achieved" : ""}`}>
      <span>{label}</span>
      <strong>{target > 0 ? (month != null ? `${month} mo` : "Beyond view") : "Set budgets"}</strong>
    </div>
  );
}

function RangeControl({ label, value, min, max, step, display, onChange }) {
  return (
    <label className="range-control">
      <span><span>{label}</span><strong>{display(value)}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(number(event.target.value))} />
    </label>
  );
}

export default function SavingsRunwaySimulator({ plan, startingSavings = 0 }) {
  const chartId = useId().replaceAll(":", "");
  const [startingBuffer, setStartingBuffer] = useState(() => clamp(startingSavings || 5000, 2000, 15000));
  const [monthlySurplus, setMonthlySurplus] = useState(() => clamp(plan.baselineCadSurplus || 500, 100, 1000));
  const [annualWindfall, setAnnualWindfall] = useState(() => {
    const weekly = plan.income.sources.find((source) => source.frequency === "weekly");
    return clamp(weekly ? weekly.amount * 4 : 0, 0, 6500);
  });
  const [years, setYears] = useState(2);
  const months = Math.round(years * 12);
  const foreignOffset = plan.crossBorder.enabled ? plan.crossBorder.debtOffsetCad : 0;
  const points = useMemo(() => Array.from({ length: months + 1 }, (_, month) => {
    const swept = Math.floor(month / 3) * (annualWindfall / 4);
    const cadOnly = startingBuffer + month * monthlySurplus + swept;
    return { month, cadOnly, combined: cadOnly + month * foreignOffset };
  }), [months, startingBuffer, monthlySurplus, annualWindfall, foreignOffset]);

  const width = 360;
  const height = 220;
  const left = 20;
  const right = 342;
  const top = 18;
  const bottom = 194;
  const targets = [plan.emergencyReserve3, plan.emergencyReserve6].filter((value) => value > 0);
  const maximum = Math.max(10000, ...targets, ...points.flatMap((point) => [point.cadOnly, point.combined])) * 1.08;
  const x = (month) => left + (month / Math.max(1, months)) * (right - left);
  const y = (value) => bottom - (Math.max(0, value) / maximum) * (bottom - top);
  const cadPath = linePath(points, "cadOnly", x, y);
  const combinedPath = linePath(points, "combined", x, y);
  const threeMonth = monthReached(points, plan.emergencyReserve3, "combined");
  const sixMonth = monthReached(points, plan.emergencyReserve6, "combined");

  return (
    <Card className="planning-card runway-card">
      <CardHeader label="Savings runway" title="Emergency fund trajectory" helper="CAD surplus compared with the ring-fenced INR debt offset" />
      <div className="planning-chart-wrap">
        <svg className="planning-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Emergency savings projection over ${months} months`}>
          <title>Emergency savings runway</title>
          <desc>Cyan shows Canadian surplus and emerald shows Canadian surplus plus the enabled foreign debt offset.</desc>
          <defs>
            <linearGradient id={`${chartId}-cad`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity="0.28" /><stop offset="1" stopColor="#38bdf8" stopOpacity="0" /></linearGradient>
            <linearGradient id={`${chartId}-combined`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4ade80" stopOpacity="0.24" /><stop offset="1" stopColor="#4ade80" stopOpacity="0" /></linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} className="chart-grid-line" x1={left} x2={right} y1={top + (bottom - top) * ratio} y2={top + (bottom - top) * ratio} />)}
          {plan.emergencyReserve3 > 0 && <g><line className="milestone-line floor" x1={left} x2={right} y1={y(plan.emergencyReserve3)} y2={y(plan.emergencyReserve3)} /><text className="milestone-label" x={right - 2} y={y(plan.emergencyReserve3) - 5}>3 mo {money(plan.emergencyReserve3, 0)}</text></g>}
          {plan.emergencyReserve6 > 0 && <g><line className="milestone-line resilience" x1={left} x2={right} y1={y(plan.emergencyReserve6)} y2={y(plan.emergencyReserve6)} /><text className="milestone-label" x={right - 2} y={y(plan.emergencyReserve6) - 5}>6 mo {money(plan.emergencyReserve6, 0)}</text></g>}
          <path d={areaPath(points, "cadOnly", x, y, bottom)} fill={`url(#${chartId}-cad)`} />
          <path d={areaPath(points, "combined", x, y, bottom)} fill={`url(#${chartId}-combined)`} />
          <path className="trajectory cad" d={cadPath} />
          <path className="trajectory combined" d={combinedPath} />
          <circle className="trajectory-point cad" cx={x(months)} cy={y(points.at(-1).cadOnly)} r="4" />
          <circle className="trajectory-point combined" cx={x(months)} cy={y(points.at(-1).combined)} r="4" />
          <text className="axis-label" x={left} y={height - 7}>Now</text>
          <text className="axis-label end" x={right} y={height - 7}>{years} yr</text>
        </svg>
      </div>
      <div className="chart-key planning-key"><span><i className="swatch cyan" />CAD only</span><span><i className="swatch emerald" />CAD + INR offset</span><span><i className="swatch amber" />5th cheques</span></div>
      <div className="milestone-grid"><Countdown label="3-month floor" target={plan.emergencyReserve3} month={threeMonth} /><Countdown label="6-month resilience" target={plan.emergencyReserve6} month={sixMonth} /></div>
      <div className="slider-stack">
        <RangeControl label="Starting cash buffer" value={startingBuffer} min="2000" max="15000" step="250" display={(value) => money(value, 0)} onChange={setStartingBuffer} />
        <RangeControl label="Monthly CAD surplus" value={monthlySurplus} min="100" max="1000" step="25" display={(value) => money(value, 0)} onChange={setMonthlySurplus} />
        <RangeControl label="Annual 5th cheques swept" value={annualWindfall} min="0" max="6500" step="50" display={(value) => money(value, 0)} onChange={setAnnualWindfall} />
        <RangeControl label="Projection timeline" value={years} min="1" max="3" step="0.5" display={(value) => `${value} years`} onChange={setYears} />
      </div>
    </Card>
  );
}
