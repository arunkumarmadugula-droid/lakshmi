import { useEffect, useId, useMemo, useState } from "react";
import { money } from "../lib/format.js";
import { buildScenarioProjection, normalizeScenarioEvents, normalizeScenarioSettings, SCENARIO_DEFAULTS, SCENARIO_EVENT_DEFAULTS } from "../lib/scenario.js";
import { Button, Card, CardHeader, Icon } from "./ui.jsx";

const linePath = (points, key, x, y) => points.map((point, index) => `${index ? "L" : "M"}${x(point.month).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");

function bandPath(points, x, y) {
  if (!points.length) return "";
  const upper = points.map((point, index) => `${index ? "L" : "M"}${x(point.month).toFixed(2)},${y(point.high).toFixed(2)}`).join(" ");
  const lower = [...points].reverse().map((point) => `L${x(point.month).toFixed(2)},${y(point.low).toFixed(2)}`).join(" ");
  return `${upper} ${lower} Z`;
}

function StudioRange({ label, value, min, max, step, suffix = "", onChange }) {
  return (
    <label className="studio-range">
      <span><span>{label}</span><strong>{value}{suffix}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={`${label} ${value}${suffix}`} onChange={(event) => onChange(Number(event.target.value))} />
      <small><span>{min}{suffix}</span><span>{max}{suffix}</span></small>
    </label>
  );
}

function Metric({ label, value, helper, tone = "" }) {
  return (
    <div className={`studio-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function TrajectoryChart({ projection }) {
  const gradientId = useId().replaceAll(":", "");
  const [selectedIndex, setSelectedIndex] = useState(projection.points.length - 1);
  useEffect(() => setSelectedIndex((current) => Math.min(current, projection.points.length - 1)), [projection.points.length]);
  const selected = projection.points[selectedIndex] || projection.points.at(-1);
  const width = 720;
  const height = 310;
  const left = 42;
  const right = 700;
  const top = 28;
  const bottom = 272;
  const maximumTrajectory = Math.max(1, ...projection.points.flatMap((point) => [point.baseline, point.high]));
  const goalVisible = projection.financialIndependenceNumber > 0 && projection.financialIndependenceNumber <= maximumTrajectory * 1.2;
  const maximum = Math.max(maximumTrajectory, goalVisible ? projection.financialIndependenceNumber : 0) * 1.08;
  const lastMonth = projection.points.at(-1)?.month || 1;
  const x = (month) => left + (month / lastMonth) * (right - left);
  const y = (value) => bottom - (Math.max(0, value) / maximum) * (bottom - top);
  const ticks = [...new Set([0, Math.round(lastMonth * 0.25), Math.round(lastMonth * 0.5), Math.round(lastMonth * 0.75), lastMonth])];

  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = (event.clientX - bounds.left) / bounds.width * width;
    const month = Math.round((Math.min(right, Math.max(left, chartX)) - left) / (right - left) * lastMonth);
    setSelectedIndex(Math.min(projection.points.length - 1, Math.max(0, month)));
  }

  return (
    <Card className="studio-chart-card">
      <CardHeader label="Trajectory forecast" title="Baseline vs adjusted path" helper="Tap or drag across the curve to inspect any year" />
      <div className="trajectory-summary" aria-live="polite">
        <span>Year {selected.year}</span>
        <strong>{money(selected.scenario, 0)}</strong>
        <small>{selected.scenario >= selected.baseline ? "+" : ""}{money(selected.scenario - selected.baseline, 0)} vs baseline</small>
      </div>
      <div className="studio-chart-frame">
        <svg className="studio-trajectory" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Projected net worth over ${projection.settings.horizonYears} years`} onPointerDown={inspect} onPointerMove={(event) => event.buttons === 1 && inspect(event)}>
          <title>Net worth scenario projection</title>
          <desc>Blue is the current baseline, gold is the adjusted scenario, and the translucent band is the return confidence range.</desc>
          <defs>
            <linearGradient id={`${gradientId}-band`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d4af37" stopOpacity="0.26" /><stop offset="1" stopColor="#d4af37" stopOpacity="0.015" /></linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} className="studio-gridline" x1={left} x2={right} y1={top + (bottom - top) * ratio} y2={top + (bottom - top) * ratio} />)}
          {goalVisible && <g><line className="studio-goal-line" x1={left} x2={right} y1={y(projection.financialIndependenceNumber)} y2={y(projection.financialIndependenceNumber)} /><text className="studio-goal-label" x={right} y={y(projection.financialIndependenceNumber) - 7}>FI target</text></g>}
          <path className="studio-confidence" d={bandPath(projection.points, x, y)} fill={`url(#${gradientId}-band)`} />
          <path className="studio-line baseline" d={linePath(projection.points, "baseline", x, y)} />
          <path className="studio-line scenario" d={linePath(projection.points, "scenario", x, y)} />
          <line className="studio-inspector" x1={x(selected.month)} x2={x(selected.month)} y1={top} y2={bottom} />
          <circle className="studio-point baseline" cx={x(selected.month)} cy={y(selected.baseline)} r="4.5" />
          <circle className="studio-point scenario" cx={x(selected.month)} cy={y(selected.scenario)} r="5" />
          {ticks.map((month) => <text key={month} className="studio-axis-label" x={x(month)} y={height - 10}>{month === 0 ? "Now" : `${Math.round(month / 12)}y`}</text>)}
        </svg>
      </div>
      <div className="studio-legend"><span><i className="scenario-blue" />Baseline</span><span><i className="scenario-gold" />Adjusted</span><span><i className="scenario-band" />Confidence band</span></div>
    </Card>
  );
}

function AllocationChart({ allocation }) {
  const [activeKey, setActiveKey] = useState(allocation[0]?.key || "");
  const total = allocation.reduce((sum, item) => sum + item.value, 0);
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const active = allocation.find((item) => item.key === activeKey) || allocation[0];
  return (
    <Card className="studio-breakdown-card">
      <CardHeader label="Asset allocation" title="Projected composition" helper="Interactive horizon mix" />
      <div className="allocation-layout">
        <div className="donut-wrap">
          <svg viewBox="0 0 160 160" className="allocation-donut" role="img" aria-label="Projected asset allocation">
            <circle className="donut-track" cx="80" cy="80" r={radius} />
            {allocation.map((item) => {
              const length = total > 0 ? item.value / total * circumference : 0;
              const circle = <circle key={item.key} className={`donut-segment ${active?.key === item.key ? "active" : ""}`} cx="80" cy="80" r={radius} stroke={item.color} strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={-offset} onClick={() => setActiveKey(item.key)} />;
              offset += length;
              return circle;
            })}
          </svg>
          <div className="donut-center"><strong>{total > 0 ? Math.round(active.value / total * 100) : 0}%</strong><span>{active?.label || "Assets"}</span></div>
        </div>
        <div className="allocation-legend">
          {allocation.map((item) => <button type="button" key={item.key} aria-pressed={active?.key === item.key} onClick={() => setActiveKey(item.key)}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{money(item.value, 0)}</strong></button>)}
        </div>
      </div>
    </Card>
  );
}

function CashFlowDistribution({ items }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <Card className="studio-breakdown-card">
      <CardHeader label="Cash-flow distribution" title="Where each month goes" helper="Adjusted scenario at the selected horizon" />
      <div className="distribution-bar" role="img" aria-label="Monthly cash flow distribution">
        {items.map((item) => <span key={item.key} style={{ width: `${total > 0 ? item.value / total * 100 : 0}%`, background: item.color }} title={`${item.label}: ${money(item.value)}`} />)}
      </div>
      <div className="distribution-list">
        {items.map((item) => <div key={item.key}><span><i style={{ background: item.color }} />{item.label}</span><strong>{money(item.value, 0)}</strong><small>{total > 0 ? Math.round(item.value / total * 100) : 0}%</small></div>)}
      </div>
    </Card>
  );
}

export default function ScenarioStudio({ vault, plan, persist, notify }) {
  const saved = vault.planning?.scenario || {};
  const [settings, setSettings] = useState(() => normalizeScenarioSettings(saved.settings || saved));
  const [events, setEvents] = useState(() => normalizeScenarioEvents(saved.events));
  const projection = useMemo(() => buildScenarioProjection({ vault, plan, settings, events }), [vault, plan, settings, events]);
  const eventOptions = [
    { key: "downturn", icon: "prices", title: "Market downturn", detail: "-20% invested assets in year one" },
    { key: "promotion", icon: "banknote", title: "Career promotion", detail: "+15% income from the first month" },
    { key: "downPayment", icon: "home", title: "Real-estate down payment", detail: `${money(projection.eventAmounts.downPayment, 0)} moved into home equity` },
    { key: "emergency", icon: "shield", title: "Emergency expense", detail: `${money(projection.eventAmounts.emergency, 0)} immediate cash impact` },
  ];
  const changed = JSON.stringify(settings) !== JSON.stringify(normalizeScenarioSettings(saved.settings || saved)) || JSON.stringify(events) !== JSON.stringify(normalizeScenarioEvents(saved.events));

  function update(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function reset() {
    setSettings(normalizeScenarioSettings(SCENARIO_DEFAULTS));
    setEvents(normalizeScenarioEvents(SCENARIO_EVENT_DEFAULTS));
  }

  function save() {
    persist((current) => ({ ...current, planning: { ...current.planning, scenario: { settings, events, savedAt: new Date().toISOString() } } }));
    notify("Scenario assumptions saved. No ledger values were changed.");
  }

  return (
    <div className="scenario-studio">
      <section className="studio-intro">
        <div><span className="studio-eyebrow"><Icon name="ai" />Live sandbox</span><h2>Scenario Studio</h2><p>Stress-test your future without changing a single ledger entry.</p></div>
        <div className="studio-intro-actions"><Button compact kind="ghost" onClick={reset}><Icon name="restore" />Reset</Button><Button compact kind="gold" disabled={!changed} onClick={save}><Icon name="save" />Save assumptions</Button></div>
      </section>

      <div className="studio-kpi-grid">
        <Metric label="Net worth at horizon" value={money(projection.netWorthAtHorizon, 0)} helper={`${projection.settings.horizonYears}-year adjusted projection`} tone="gold" />
        <Metric label="Financial independence" value={money(projection.financialIndependenceNumber, 0)} helper="25x inflation-adjusted essentials" tone="blue" />
        <Metric label="Monthly passive income" value={money(projection.monthlyPassiveIncome, 0)} helper="4% annual withdrawal model" tone="emerald" />
        <Metric label="Years to goal" value={projection.yearsToGoal == null ? `>${projection.settings.horizonYears}` : projection.yearsToGoal} helper={projection.yearsToGoal == null ? "Outside this horizon" : "First FI crossover"} tone="titanium" />
      </div>

      <TrajectoryChart projection={projection} />

      <Card className="studio-levers-card">
        <CardHeader label="Interactive levers" title="Shape the scenario" helper="Every adjustment redraws the model instantly" />
        <div className="studio-lever-grid">
          <StudioRange label="Savings and investment rate" value={settings.savingsRate} min={5} max={50} step={1} suffix="%" onChange={(value) => update("savingsRate", value)} />
          <StudioRange label="Expected annual return" value={settings.annualReturn} min={3} max={12} step={0.5} suffix="%" onChange={(value) => update("annualReturn", value)} />
          <StudioRange label="Inflation and cost of living" value={settings.inflation} min={2} max={6} step={0.25} suffix="%" onChange={(value) => update("inflation", value)} />
          <StudioRange label="Milestone horizon" value={settings.horizonYears} min={1} max={40} step={1} suffix=" yr" onChange={(value) => update("horizonYears", value)} />
          <StudioRange label="Discretionary spending trim" value={settings.discretionaryTrim} min={0} max={50} step={5} suffix="%" onChange={(value) => update("discretionaryTrim", value)} />
        </div>
        <div className="studio-live-strip"><span><small>Monthly income</small><strong>{money(projection.monthlyIncome, 0)}</strong></span><span><small>Projected costs</small><strong>{money(projection.monthlyExpenses, 0)}</strong></span><span><small>Monthly investing</small><strong>{money(projection.monthlyContribution, 0)}</strong></span></div>
      </Card>

      <Card className="studio-events-card">
        <CardHeader label="Scenario events" title="Layer in real-world shocks" helper="Combine presets to test resilience and trade-offs" />
        <div className="event-toggle-grid">
          {eventOptions.map((event) => <button type="button" key={event.key} className="event-toggle" role="switch" aria-checked={events[event.key]} onClick={() => setEvents((current) => ({ ...current, [event.key]: !current[event.key] }))}><span className="event-icon"><Icon name={event.icon} /></span><span><strong>{event.title}</strong><small>{event.detail}</small></span><i className="switch-track"><b /></i></button>)}
        </div>
      </Card>

      <div className="studio-breakdown-grid">
        <AllocationChart allocation={projection.allocation} />
        <CashFlowDistribution items={projection.waterfall} />
      </div>

      <details className="studio-methodology">
        <summary><span><Icon name="database" />Model assumptions and privacy</span><Icon name="chevron-down" /></summary>
        <div><p>Starting assets use this profile's bank and savings balances. Baseline uses the deterministic monthly surplus already calculated by Lakshmi. The confidence band tests returns 2.5 percentage points above and below the selected rate.</p><p>Promotion changes income by 15%. The downturn applies an 18% portfolio impact after preserving a planning cash allocation. A down payment moves liquid assets into real-estate equity. Emergency spending reduces liquid assets. This sandbox never posts income, spending, or transfers to the ledger.</p></div>
      </details>
    </div>
  );
}
