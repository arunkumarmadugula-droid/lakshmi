import { useMemo, useState } from "react";
import { budgetActuals, dueCards, fuelMetrics, history, localInsights, monthStats } from "../lib/finance.js";
import { compactMoney, currentMonth, money, monthLabel, number, shiftMonth, todayISO, uid } from "../lib/format.js";
import { Button, Card, CardHeader, Icon, IconButton, Input, Field, Modal, MonthNavigator } from "../components/ui.jsx";

export default function BoardTab({ vault, persist, notify, openModal }) {
  const [month, setMonth] = useState(currentMonth());
  const stats = useMemo(() => monthStats(vault, month), [vault, month]);
  const due = useMemo(() => dueCards(vault, month), [vault, month]);
  const trend = useMemo(() => history(vault, month, 6), [vault, month]);
  const budgets = useMemo(() => budgetActuals(vault, month), [vault, month]);
  const insights = useMemo(() => localInsights(vault, month), [vault, month]);
  const activeVehicle = vault.vehicles.find((item) => item.active !== false) || vault.vehicles[0];
  const fuel = useMemo(() => fuelMetrics(vault, activeVehicle?.id), [vault, activeVehicle?.id]);

  function payCard(item) {
    openModal({ content: <PaymentModal item={item} vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> });
  }

  const donut = buildDonut(stats.categories);
  const maxTrend = Math.max(1, ...trend.flatMap((item) => [item.income, item.spent]));
  const cardPaymentHistory = trend.map((item) => ({ month: item.month, amount: item.cardPayments.reduce((sum, payment) => sum + number(payment.amount), 0) }));
  const maxCardPayment = Math.max(1, ...cardPaymentHistory.map((item) => item.amount));

  return (
    <>
      <MonthNavigator label={monthLabel(month)} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} action={<Button compact onClick={() => setMonth(currentMonth())}>Today</Button>} />

      <Card>
        <div className="metric-grid">
          <div className="metric-tile in"><div className="label">In</div><div className="metric-value">{compactMoney(stats.income)}</div><div className="helper">cash received</div></div>
          <div className="metric-tile out"><div className="label">Spent</div><div className="metric-value">{compactMoney(stats.spent)}</div><div className="helper">all expenses</div></div>
          <div className="metric-tile saved"><div className="label">Saved</div><div className="metric-value">{compactMoney(stats.saved)}</div><div className="helper">in minus spent</div></div>
        </div>
        <div className="balance-strip" style={{ marginTop: 10 }}>
          <div><div className="label">Available bank</div><strong className="money">{money(vault.settings.bankBalance)}</strong></div>
          <div><div className="label">Savings</div><strong className="money">{money(vault.settings.savingsBalance)}</strong></div>
        </div>
      </Card>

      <Card>
        <CardHeader label="Card bills due" helper="Payments stay separate from monthly Spent" action={<span className="due-tag">{due.filter((item) => !item.paid).length} upcoming</span>} />
        {due.length ? due.map((item) => (
          <div className="row with-icon" key={item.card.id}>
            <span className="icon-box"><Icon name="card" /></span>
            <span className="truncate"><strong>{item.card.bank} {item.card.name || "Card"} {item.card.last4 ? `...${item.card.last4}` : ""}</strong><br /><span className="helper">{item.dueDate} - {item.amount == null ? "amount pending" : money(item.amount)}</span></span>
            {item.paid ? <span className="status-pill good">Paid {money(item.payment.amount, 0)}</span> : <Button compact onClick={() => payCard(item)}>Paid</Button>}
          </div>
        )) : <div className="helper">Add each credit card once from Add - Card bill to create monthly reminders.</div>}
      </Card>

      <Card>
        <CardHeader label="Insights" helper="Calculated privately from this vault" action={<span className="button compact ai"><Icon name="ai" />Local</span>} />
        {insights.map((text, index) => <div className="insight" key={text} style={{ borderLeftColor: index === 1 ? "var(--inflow)" : undefined }}>{text}</div>)}
      </Card>

      <Card>
        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Where it went</div><div className="helper">Recorded spending by category</div></div><strong className="money">{money(stats.spent, 0)}</strong></div>
          {stats.categories.length ? (
            <div className="donut-layout">
              <div className="donut" style={{ "--donut": donut }}><div className="donut-label"><strong>{stats.categories.length}</strong><div className="helper">categories</div></div></div>
              <div className="legend">{stats.categories.slice(0, 6).map((category) => <div className="legend-row" key={category.name}><i className="swatch" style={{ background: category.color }} /><span className="truncate">{category.name}</span><strong>{Math.round(category.percent)}%</strong></div>)}</div>
            </div>
          ) : <div className="helper">No spending recorded for this month.</div>}
        </div>

        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Inflow vs expenses</div><div className="helper">Six-month trend</div></div><div className="chart-key"><span><i className="swatch" style={{ background: "var(--bar-in)" }} />In</span><span><i className="swatch" style={{ background: "var(--bar-out)" }} />Out</span></div></div>
          <div className="dual-chart">{trend.map((item) => <div className="chart-column" key={item.month}><div className="chart-pair"><i className="chart-bar inflow" title={`Income ${money(item.income)}`} style={{ height: `${Math.max(3, (item.income / maxTrend) * 100)}%` }} /><i className="chart-bar outflow" title={`Expenses ${money(item.spent)}`} style={{ height: `${Math.max(3, (item.spent / maxTrend) * 100)}%` }} /></div><div className="chart-month">{monthLabel(item.month, "short").split(" ")[0]}</div></div>)}</div>
        </div>

        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Budgeted vs actual</div><div className="helper">Top monthly categories</div></div></div>
          {budgets.length ? budgets.slice(0, 6).map((item) => {
            const ratio = item.budget ? item.actual / item.budget : 0;
            return <div className="row" key={item.category}><span>{item.category}<div className={`progress ${ratio > 1 ? "over" : ""}`} style={{ marginTop: 6 }}><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div></span><strong className="money">{money(item.actual, 0)} / {money(item.budget, 0)}</strong></div>;
          }) : <div className="helper">Set category budgets to compare planned and actual spending.</div>}
        </div>
      </Card>

      <Card>
        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Fuel and mileage</div><div className="helper">{activeVehicle ? `${activeVehicle.year} ${activeVehicle.make} ${activeVehicle.model}` : "Add a vehicle in Fuel"}</div></div></div>
          <div className="metric-grid"><div className="metric-tile"><div className="label">Average</div><div className="metric-value">{fuel.average ? fuel.average.toFixed(1) : "--"}</div><div className="helper">L/100 km</div></div><div className="metric-tile"><div className="label">Tracked</div><div className="metric-value">{Math.round(fuel.kmTracked)}</div><div className="helper">km</div></div><div className="metric-tile"><div className="label">Cost</div><div className="metric-value">{fuel.costPer100 ? money(fuel.costPer100, 0) : "--"}</div><div className="helper">per 100 km</div></div></div>
        </div>
        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Credit card payments</div><div className="helper">Bank outflow, excluded from Spent</div></div></div>
          <div className="dual-chart">{cardPaymentHistory.map((item) => <div className="chart-column" key={item.month}><div className="chart-pair" style={{ gridTemplateColumns: "1fr" }}><i className="chart-bar outflow" title={money(item.amount)} style={{ height: `${Math.max(3, (item.amount / maxCardPayment) * 100)}%` }} /></div><div className="chart-month">{monthLabel(item.month, "short").split(" ")[0]}</div></div>)}</div>
        </div>
      </Card>
    </>
  );
}

function buildDonut(categories) {
  if (!categories.length) return "var(--surface-3)";
  let cursor = 0;
  const segments = categories.slice(0, 8).map((category) => {
    const start = cursor;
    cursor += category.percent;
    return `${category.color} ${start.toFixed(2)}% ${Math.min(100, cursor).toFixed(2)}%`;
  });
  if (cursor < 100) segments.push(`var(--surface-3) ${cursor.toFixed(2)}% 100%`);
  return `conic-gradient(${segments.join(",")})`;
}

function PaymentModal({ item, vault, persist, notify, onClose }) {
  const [amount, setAmount] = useState(item.amount == null ? "" : String(item.amount));
  const [date, setDate] = useState(todayISO());
  function save() {
    const paid = number(amount);
    if (paid <= 0) return;
    const payment = {
      id: uid("card-payment"), cardId: item.card.id, statementId: item.statement?.id || "", dueMonth: item.dueDate.slice(0, 7),
      date, amount: paid, createdAt: new Date().toISOString(),
    };
    persist({
      ...vault,
      cardPayments: [payment, ...vault.cardPayments],
      settings: { ...vault.settings, bankBalance: number(vault.settings.bankBalance) - paid },
    });
    notify(`${money(paid)} card payment recorded without changing Spent.`);
    onClose();
  }
  return (
    <Modal label="Card payment" title={`${item.card.bank} ${item.card.last4 ? `...${item.card.last4}` : item.card.name}`} onClose={onClose}>
      <div className="form-stack">
        <div className="security-banner"><span className="icon-box"><Icon name="card" /></span><div><strong>Bank balance only</strong><div className="helper">The purchase expenses were already counted when their receipts entered the ledger.</div></div></div>
        <Field label="Amount paid"><Input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
        <Field label="Payment date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Button kind="primary" disabled={number(amount) <= 0} onClick={save}><Icon name="check" />Record payment</Button>
      </div>
    </Modal>
  );
}
