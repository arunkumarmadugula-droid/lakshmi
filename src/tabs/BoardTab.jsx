import { useMemo, useState } from "react";
import { CATEGORIES } from "../data/defaults.js";
import { availableHistory, budgetActuals, cardPaymentMonths, chartStartMonth, dueCards, estimatePayroll, expenseRefundStatus, fuelMetrics, jointAccountBalance, localInsights, monthStats, ownerMatches, salaryVersionOnDate, unmatchedStatementTransactions } from "../lib/finance.js";
import { compactMoney, currentMonth, money, monthLabel, number, shiftMonth, todayISO, uid } from "../lib/format.js";
import { askFinancialAssistant } from "../lib/openai.js";
import { Button, Card, CardHeader, Icon, IconButton, Input, Field, Modal, MonthNavigator, Segmented, Select } from "../components/ui.jsx";

export default function BoardTab({ vault, persist, notify, openModal, companion = false, currentOwner = "me" }) {
  const [month, setMonth] = useState(currentMonth());
  const [ownerScope, setOwnerScope] = useState(companion ? "partner" : "household");
  const [categorySelection, setCategorySelection] = useState("");
  const [trendSelection, setTrendSelection] = useState("");
  const [budgetSelection, setBudgetSelection] = useState("");
  const [cardSelection, setCardSelection] = useState("");
  const activationMonth = chartStartMonth(vault, month);
  const emptyTrendMonth = month < activationMonth ? activationMonth : month;
  const stats = useMemo(() => monthStats(vault, month, ownerScope), [vault, month, ownerScope]);
  const due = useMemo(() => dueCards(vault, month, ownerScope), [vault, month, ownerScope]);
  const trend = useMemo(() => {
    const available = availableHistory(vault, month, 6, ownerScope);
    return companion ? available.filter((item) => item.spent > 0.005) : available;
  }, [vault, month, ownerScope, companion]);
  const paymentMonths = useMemo(() => cardPaymentMonths(vault, month, 6, ownerScope), [vault, month, ownerScope]);
  const budgets = useMemo(() => budgetActuals(vault, month, ownerScope), [vault, month, ownerScope]);
  const insights = useMemo(() => localInsights(vault, month, ownerScope), [vault, month, ownerScope]);
  const unmatched = useMemo(() => unmatchedStatementTransactions(vault).filter((transaction) => {
    const card = vault.creditCards.find((item) => item.id === transaction.cardId);
    return ownerMatches(card || { owner: "me" }, ownerScope);
  }), [vault, ownerScope]);
  const activeVehicle = vault.vehicles.find((item) => item.active !== false) || vault.vehicles[0];
  const fuel = useMemo(() => fuelMetrics(vault, activeVehicle?.id), [vault, activeVehicle?.id]);

  function payCard(item) {
    openModal({ content: <PaymentModal item={item} vault={vault} persist={persist} notify={notify} companion={companion} currentOwner={currentOwner} onClose={() => openModal(null)} /> });
  }

  const chartCategories = groupChartCategories(stats.categories);
  const selectedCategory = chartCategories.find((item) => item.name === categorySelection) || chartCategories[0] || null;
  const selectedTrend = trend.find((item) => item.month === trendSelection) || trend[trend.length - 1] || null;
  const visibleBudgets = budgets.slice(0, 6);
  const selectedBudget = visibleBudgets.find((item) => item.category === budgetSelection) || visibleBudgets[0] || null;
  const donut = buildDonut(chartCategories);
  const maxTrend = Math.max(1, ...trend.flatMap((item) => [item.income, item.spent]));
  const cardPaymentSeries = vault.creditCards.filter((card) => ownerMatches(card, ownerScope)).map((card, index) => ({
    card,
    color: ["var(--saved)", "var(--bar-out)", "var(--inflow)", "var(--warning)"][index % 4],
    values: paymentMonths.map((paymentMonth) => ({ month: paymentMonth, amount: vault.cardPayments.filter((payment) => payment.cardId === card.id && String(payment.date || "").slice(0, 7) === paymentMonth).reduce((sum, payment) => sum + number(payment.amount), 0) })),
  })).filter((series) => series.values.some((item) => item.amount > 0.005));
  const cardPoints = cardPaymentSeries.flatMap((series) => series.values.map((item) => ({ ...item, card: series.card, color: series.color, key: `${series.card.id}:${item.month}` })));
  const selectedCardPoint = cardPoints.find((item) => item.key === cardSelection) || [...cardPoints].reverse().find((item) => item.amount > 0.005) || null;
  const maxCardPayment = Math.max(1, ...cardPaymentSeries.flatMap((series) => series.values.map((item) => item.amount)));

  return (
    <>
      <MonthNavigator label={monthLabel(month)} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} action={<Button compact onClick={() => setMonth(currentMonth())}>Today</Button>} />
      {!companion && vault.householdLink?.enabled && <Segmented label="Dashboard owner" value={ownerScope} onChange={setOwnerScope} options={[{ value: "mine", label: "Mine" }, { value: "partner", label: vault.householdLink.partnerName || "Partner" }, { value: "household", label: "Household" }]} />}

      <Card>
        <div className="metric-grid">
          {companion ? <>
            <div className="metric-tile out"><div className="label">Spent</div><div className="metric-value">{compactMoney(stats.spent)}</div><div className="helper">your net expenses</div></div>
            <div className="metric-tile in"><div className="label">Refunded</div><div className="metric-value">{compactMoney(stats.refundTotal)}</div><div className="helper">credits recorded</div></div>
            <div className="metric-tile"><div className="label">Entries</div><div className="metric-value">{stats.expenses.length + stats.refunds.length}</div><div className="helper">this month</div></div>
          </> : <>
            <div className="metric-tile in"><div className="label">In</div><div className="metric-value">{compactMoney(stats.income)}</div><div className="helper">cash received</div></div>
            <div className="metric-tile out"><div className="label">Spent</div><div className="metric-value">{compactMoney(stats.spent)}</div><div className="helper">net of {stats.refundTotal ? `${money(stats.refundTotal, 0)} refunds` : "refunds"}</div></div>
            <div className="metric-tile saved"><div className="label">Saved</div><div className="metric-value">{compactMoney(stats.saved)}</div><div className="helper">in minus spent</div></div>
          </>}
        </div>
        {!companion && <div className="balance-strip" style={{ marginTop: 10 }}>
          <div><div className="label">Available bank</div><strong className="money">{money(vault.settings.bankBalance)}</strong></div>
          <div><div className="label">Savings</div><strong className="money">{money(vault.settings.savingsBalance)}</strong></div>
        </div>}
      </Card>

      <JointAccountCard vault={vault} persist={persist} notify={notify} openModal={openModal} companion={companion} currentOwner={currentOwner} />

      <Card>
        <CardHeader label="Card bills due" helper="Payments stay separate from monthly Spent" action={<span className="due-tag">{due.filter((item) => !item.paid).length} upcoming</span>} />
        {due.length ? due.map((item) => (
          <div className="row with-icon" key={item.card.id}>
            <span className="icon-box"><Icon name="card" /></span>
            <span className="truncate"><strong>{item.card.bank} {item.card.name || "Card"} {item.card.last4 ? `...${item.card.last4}` : ""}</strong><br /><span className="helper">{item.dueDate} - {item.amount == null ? "amount pending" : money(item.amount)}{item.paidAmount ? ` - ${money(item.paidAmount)} paid` : ""}{item.creditAmount ? ` - ${money(item.creditAmount)} card credits` : ""}</span></span>
            {item.paid ? <span className="status-pill good">Paid {money(item.paidAmount, 0)}</span> : <Button compact onClick={() => payCard(item)}>{item.paidAmount ? "Add payment" : "Paid"}</Button>}
          </div>
        )) : <div className="helper">Add each credit card once from Add - Card bill to create monthly reminders.</div>}
      </Card>

      {!companion && ownerScope === "household" && unmatched.length > 0 && <Card>
        <CardHeader label="Card transactions to review" helper="Unmatched statement lines are not counted until you confirm them" action={<Button compact onClick={() => openModal({ content: <StatementReviewModal vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="ledger" />Review {unmatched.length}</Button>} noMargin />
      </Card>}

      <Card>
        <CardHeader label="Insights" helper="Calculated privately from this vault" action={<Button compact onClick={() => openModal({ content: <FinancialAssistantModal vault={vault} month={month} scope={ownerScope} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="ai" />Ask Lakshmi</Button>} />
        {insights.map((text, index) => <div className="insight" key={text} style={{ borderLeftColor: index === 1 ? "var(--inflow)" : undefined }}>{text}</div>)}
      </Card>

      <Card>
        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Where it went</div><div className="helper">Recorded spending by category</div></div><strong className="money">{money(stats.spent, 0)}</strong></div>
          {chartCategories.length ? (
            <div className="donut-layout">
              <div className="donut" role="img" aria-label={`${selectedCategory?.name || "Spending"}: ${selectedCategory ? money(selectedCategory.value) : money(0)}`} style={{ "--donut": donut }}><div className="donut-label"><strong>{selectedCategory ? `${Math.round(selectedCategory.percent)}%` : "0%"}</strong><div className="helper truncate">{selectedCategory?.name || "category"}</div></div></div>
              <div className="legend">{chartCategories.map((category) => <button type="button" className="legend-row chart-control" aria-pressed={selectedCategory?.name === category.name} aria-label={`${category.name}, ${money(category.value)}, ${category.percent.toFixed(1)} percent of spending`} onClick={() => setCategorySelection(category.name)} key={category.name}><i className="swatch" aria-hidden="true" style={{ background: category.color }} /><span className="truncate">{category.name}</span><strong>{Math.round(category.percent)}%</strong></button>)}</div>
            </div>
          ) : <div className="helper">No spending recorded for this month.</div>}
          {selectedCategory && <div className="chart-detail" aria-live="polite"><span><i className="swatch" aria-hidden="true" style={{ background: selectedCategory.color }} />{selectedCategory.name}</span><strong>{money(selectedCategory.value)} <small>{selectedCategory.percent.toFixed(1)}% of Spent</small></strong></div>}
        </div>

        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">{companion ? "Monthly expenses" : "Inflow vs expenses"}</div><div className="helper">Recorded months since {monthLabel(activationMonth, "short")}</div></div><div className="chart-key">{!companion && <span><i className="swatch" style={{ background: "var(--bar-in)" }} />In</span>}<span><i className="swatch" style={{ background: "var(--bar-out)" }} />Out</span></div></div>
          {trend.length ? <>
            <div className="dual-chart" style={{ "--chart-columns": trend.length }}>{trend.map((item) => <button type="button" className="chart-column chart-control" aria-pressed={selectedTrend?.month === item.month} aria-label={`${monthLabel(item.month)}. ${companion ? "Expenses" : "Income"} ${money(companion ? item.spent : item.income)}${companion ? "" : `, expenses ${money(item.spent)}, net ${money(item.saved)}`}`} onClick={() => setTrendSelection(item.month)} key={item.month}><div className="chart-pair">{!companion && <i aria-hidden="true" className="chart-bar inflow" style={{ height: item.income > 0.005 ? `${Math.max(5, (item.income / maxTrend) * 100)}%` : 0 }} />}<i aria-hidden="true" className="chart-bar outflow" style={{ height: item.spent > 0.005 ? `${Math.max(5, (item.spent / maxTrend) * 100)}%` : 0 }} /></div><div className="chart-month">{monthLabel(item.month, "short").split(" ")[0]}</div></button>)}</div>
            {selectedTrend && <div className="chart-detail chart-detail-values" aria-live="polite"><strong>{monthLabel(selectedTrend.month)}</strong>{!companion && <span>In <b>{money(selectedTrend.income)}</b></span>}<span>Out <b>{money(selectedTrend.spent)}</b></span>{!companion && <span className={selectedTrend.saved >= 0 ? "text-in" : "text-out"}>Net <b>{money(selectedTrend.saved)}</b></span>}</div>}
          </> : <div className="empty-chart" role="img" aria-label={`No ${companion ? "expense" : "cash-flow"} activity recorded since ${monthLabel(activationMonth)}`}><div className="dual-chart" style={{ "--chart-columns": 1 }}><div className="chart-column chart-placeholder"><div className="chart-pair">{!companion && <i className="chart-bar inflow" />}<i className="chart-bar outflow" /></div><div className="chart-month">{monthLabel(emptyTrendMonth, "short").split(" ")[0]}</div></div></div><div className="chart-empty-label">No recorded activity since {monthLabel(activationMonth, "short")}.</div></div>}
        </div>

        {!companion && ownerScope === "household" && <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Budgeted vs actual</div><div className="helper">Top monthly categories</div></div></div>
          {visibleBudgets.length ? visibleBudgets.map((item) => {
            const ratio = item.budget ? item.actual / item.budget : 0;
            return <button type="button" className="row chart-row-control chart-control" aria-pressed={selectedBudget?.category === item.category} aria-label={`${item.category}: ${money(item.actual)} spent of ${money(item.budget)} budgeted`} onClick={() => setBudgetSelection(item.category)} key={item.category}><span>{item.category}<span className={`progress ${ratio > 1 ? "over" : ""}`} style={{ marginTop: 6 }}><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></span></span><strong className="money">{money(item.actual, 0)} / {money(item.budget, 0)}</strong></button>;
          }) : <div className="helper">Set category budgets to compare planned and actual spending.</div>}
          {selectedBudget && <div className="chart-detail" aria-live="polite"><span>{selectedBudget.category}</span><strong className={selectedBudget.actual > selectedBudget.budget ? "text-out" : "text-in"}>{selectedBudget.actual > selectedBudget.budget ? "Over by" : "Remaining"} {money(Math.abs(selectedBudget.budget - selectedBudget.actual))}</strong></div>}
        </div>}
      </Card>

      {!companion && ownerScope === "household" && <Card>
        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Fuel and mileage</div><div className="helper">{activeVehicle ? `${activeVehicle.year} ${activeVehicle.make} ${activeVehicle.model}` : "Add a vehicle in Fuel"}</div></div></div>
          <div className="metric-grid"><div className="metric-tile"><div className="label">Average</div><div className="metric-value">{fuel.average ? fuel.average.toFixed(1) : "--"}</div><div className="helper">L/100 km</div></div><div className="metric-tile"><div className="label">Tracked</div><div className="metric-value">{Math.round(fuel.kmTracked)}</div><div className="helper">km</div></div><div className="metric-tile"><div className="label">Cost</div><div className="metric-value">{fuel.costPer100 ? money(fuel.costPer100, 0) : "--"}</div><div className="helper">per 100 km</div></div></div>
        </div>
      </Card>}

      <Card>
        <div className="chart-section">
          <div className="chart-heading"><div><div className="label">Credit card payments</div><div className="helper">Bank outflow, excluded from Spent</div></div></div>
          {cardPaymentSeries.length ? <>
            <div className="card-series-chart">{cardPaymentSeries.map((series) => <div className="card-series-row" key={series.card.id}><div className="card-series-label"><span className="truncate">{series.card.bank} {series.card.last4 ? `...${series.card.last4}` : series.card.name}</span><strong className="money">{money(series.values.reduce((sum, item) => sum + item.amount, 0), 0)}</strong></div><div className="mini-bars" style={{ "--chart-columns": paymentMonths.length }}>{series.values.map((item) => { const key = `${series.card.id}:${item.month}`; return <button type="button" className="mini-bar-control chart-control" aria-pressed={selectedCardPoint?.key === key} aria-label={`${series.card.bank} ${series.card.last4 || series.card.name}, ${monthLabel(item.month)}, payment ${money(item.amount)}`} onClick={() => setCardSelection(key)} key={item.month}><i aria-hidden="true" style={{ height: item.amount > 0.005 ? `${Math.max(7, item.amount / maxCardPayment * 100)}%` : 0, background: series.color }} /></button>; })}</div></div>)}</div>
            {selectedCardPoint && <div className="chart-detail chart-detail-values" aria-live="polite"><span>{selectedCardPoint.card.bank} {selectedCardPoint.card.last4 ? `...${selectedCardPoint.card.last4}` : selectedCardPoint.card.name}</span><strong>{monthLabel(selectedCardPoint.month)}</strong><span>Paid <b>{money(selectedCardPoint.amount)}</b></span></div>}
          </> : <div className="helper">{vault.creditCards.some((card) => ownerMatches(card, ownerScope)) ? "No credit-card payments are recorded for this period." : "Add a credit card to begin its payment history."}</div>}
        </div>
      </Card>
    </>
  );
}

function JointAccountCard({ vault, persist, notify, openModal, companion, currentOwner }) {
  const account = vault.jointAccount || {};
  const balance = jointAccountBalance(vault);
  const transfers = [...(vault.jointTransfers || [])].sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)));
  function actorName(transfer) {
    if (transfer.actorName) return transfer.actorName;
    if (companion) return transfer.owner === "partner" ? vault.profile?.name || "Me" : vault.householdLink?.primaryName || "Primary";
    return transfer.owner === "partner" ? vault.householdLink?.partnerName || "Partner" : vault.profile?.name || "Me";
  }
  return (
    <Card>
      <CardHeader label={account.enabled ? account.name || "Joint account" : "Joint account"} helper={account.enabled ? "Shared balance derived from recorded transfers" : "Track contributions without mixing personal ledgers"} action={<Button compact onClick={() => openModal({ content: <JointAccountModal vault={vault} persist={persist} notify={notify} companion={companion} currentOwner={currentOwner} onClose={() => openModal(null)} /> })}><Icon name={account.enabled ? "banknote" : "plus"} />{account.enabled ? "Move funds" : "Set up"}</Button>} />
      {account.enabled ? <>
        <div className="balance-strip"><div><div className="label">Joint balance</div><strong className="money">{money(balance)}</strong></div><div><div className="label">Recorded transfers</div><strong>{transfers.length}</strong></div></div>
        {transfers.slice(0, 3).map((transfer) => <div className="row" key={transfer.id}><span>{actorName(transfer)}<br /><span className="helper">{transfer.date} - {transfer.note || (transfer.direction === "to-joint" ? "Added to joint" : "Moved from joint")}</span></span><strong className={`money ${transfer.direction === "to-joint" ? "text-in" : "text-out"}`}>{transfer.direction === "to-joint" ? "+" : "-"}{money(transfer.amount)}</strong></div>)}
        {companion && <div className="privacy-note">Your new joint transfers are included when you choose Send updates now.</div>}
      </> : <div className="helper">Add the opening balance once, then record contributions or withdrawals from either linked device.</div>}
    </Card>
  );
}

function JointAccountModal({ vault, persist, notify, companion, currentOwner, onClose }) {
  const enabled = !!vault.jointAccount?.enabled;
  const [name, setName] = useState(vault.jointAccount?.name || "Joint account");
  const [openingBalance, setOpeningBalance] = useState(enabled ? String(number(vault.jointAccount?.openingBalance)) : "");
  const [direction, setDirection] = useState("to-joint");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [trackPersonal, setTrackPersonal] = useState(!!vault.settings.balancesConfigured);
  const [error, setError] = useState("");
  function save() {
    const value = number(amount);
    const opening = enabled ? number(vault.jointAccount?.openingBalance) : companion ? 0 : Math.max(0, number(openingBalance));
    const availableJoint = enabled ? jointAccountBalance(vault) : opening;
    if (!name.trim()) { setError("Add a name for the joint account."); return; }
    if (enabled && value <= 0) { setError("Enter a transfer amount greater than zero."); return; }
    if (direction === "from-joint" && value > availableJoint + 0.005) { setError(`Only ${money(availableJoint)} is available in the joint account.`); return; }
    if (trackPersonal && direction === "to-joint" && value > number(vault.settings.bankBalance) + 0.005) { setError("This transfer is larger than the tracked personal bank balance."); return; }
    const transfer = value > 0 ? {
      id: uid("joint-transfer"),
      date,
      amount: value,
      direction,
      owner: currentOwner,
      actorName: vault.profile?.name || (companion ? "Partner" : "Primary"),
      note: note.trim(),
      adjustsPersonalBalance: trackPersonal,
      createdAt: new Date().toISOString(),
    } : null;
    persist((current) => ({
      ...current,
      jointAccount: { ...current.jointAccount, enabled: true, name: name.trim(), openingBalance: opening, createdAt: current.jointAccount?.createdAt || new Date().toISOString() },
      jointTransfers: transfer ? [transfer, ...(current.jointTransfers || [])] : (current.jointTransfers || []),
      settings: transfer && trackPersonal ? { ...current.settings, bankBalance: number(current.settings.bankBalance) + (direction === "to-joint" ? -value : value) } : current.settings,
    }));
    notify(transfer ? `${money(value)} ${direction === "to-joint" ? "moved to" : "moved from"} the joint account.` : "Joint account set up.");
    onClose();
  }
  return (
    <Modal label="Household money" title={enabled ? "Move joint funds" : "Set up joint account"} onClose={onClose}>
      <div className="form-stack">
        {!enabled && <div className="field-grid"><Field label="Account name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>{!companion ? <Field label="Opening balance"><Input inputMode="decimal" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></Field> : <div />}</div>}
        <Segmented columns={2} label="Joint transfer direction" value={direction} onChange={setDirection} options={[{ value: "to-joint", label: "Add to joint" }, { value: "from-joint", label: "Move from joint" }]} />
        <div className="field-grid"><Field label={enabled ? "Amount" : "First transfer (optional)"}><Input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div>
        <Field label="Note (optional)"><Input value={note} placeholder="Monthly contribution" onChange={(event) => setNote(event.target.value)} /></Field>
        {vault.settings.balancesConfigured ? <label className="check-row"><input type="checkbox" checked={trackPersonal} onChange={(event) => setTrackPersonal(event.target.checked)} /><span>Also adjust my tracked personal bank balance</span></label> : <div className="privacy-note">Your personal bank opening balance is not configured on this device. The joint transfer will still be recorded and synchronized.</div>}
        {companion && <div className="privacy-note">This transfer updates this device now and your partner's app after they import your next encrypted update.</div>}
        {error && <div className="error-text">{error}</div>}
        <Button kind="primary" onClick={save}><Icon name="save" />{enabled ? "Record transfer" : "Set up account"}</Button>
      </div>
    </Modal>
  );
}

function financialSummary(vault, month, scope = "household") {
  const stats = monthStats(vault, month, scope);
  const budgets = budgetActuals(vault, month, scope).filter((item) => item.budget || item.actual).slice(0, 12);
  const cards = dueCards(vault, month, scope).map((item) => ({ name: `${item.card.bank} ${item.card.last4 || item.card.name}`, dueDate: item.dueDate, amount: item.amount, paid: item.paid }));
  const vehicle = vault.vehicles.find((item) => item.active !== false) || vault.vehicles[0];
  const fuel = fuelMetrics(vault, vehicle?.id);
  const monthlyTrend = availableHistory(vault, month, 6, scope).map((item) => ({ month: item.month, income: item.income, spent: item.spent, cardPayments: item.payments }));
  const payrollEstimates = vault.incomeSources.filter((source) => source.kind === "salary" && ownerMatches(source, scope)).map((source) => {
    const active = { ...source, ...(salaryVersionOnDate(source, todayISO()) || {}) };
    const estimate = estimatePayroll({ annualSalary: active.annualSalary, province: active.province || vault.settings.province, frequency: active.frequency, rrspAnnual: active.rrspAnnual, benefitsPerPay: active.benefitsPerPay });
    return { owner: source.owner || "me", annualGross: estimate.grossAnnual, estimatedIncomeTax: estimate.federal + estimate.provincial, cppQpp: estimate.cpp, eiQpip: estimate.ei + estimate.qpip, estimatedNet: estimate.netAnnual, province: estimate.provinceName };
  }).filter((item) => item.annualGross > 0);
  return JSON.stringify({
    month,
    income: stats.income,
    spent: stats.spent,
    saved: stats.saved,
    bankBalance: number(vault.settings.bankBalance),
    savingsBalance: number(vault.settings.savingsBalance),
    jointAccountBalance: jointAccountBalance(vault),
    savingsGoals: (vault.savingsGoals || []).map((goal) => ({ name: goal.name, target: number(goal.target), allocated: number(goal.allocated), targetDate: goal.targetDate || null })),
    payrollEstimates,
    categories: stats.categories.slice(0, 12).map((item) => ({ name: item.name, amount: Math.round(item.value * 100) / 100, percent: Math.round(item.percent) })),
    budgets: budgets.map((item) => ({ category: item.category, budget: item.budget, actual: item.actual })),
    cardBills: cards,
    monthlyTrend,
    fuel: vehicle ? { vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, averageL100km: fuel.average, costPer100km: fuel.costPer100, kmTracked: fuel.kmTracked, bestStation: fuel.bestStation?.name || null } : null,
  });
}

function FinancialAssistantModal({ vault, month, scope, persist, notify, onClose }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestions = [
    "How can I save more this month?",
    "Am I on track for my savings goals?",
    "Estimate our 2026 payroll tax.",
    "Where can I reduce spending?",
    "How should I prioritize my emergency fund?",
  ];
  async function ask() {
    if (!question.trim()) return;
    if (!vault.ai?.apiKey) {
      setError("Add an OpenAI API key from protected Settings first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await askFinancialAssistant({ apiKey: vault.ai.apiKey, model: vault.ai.model, question, summary: financialSummary(vault, month, scope) });
      setAnswer(result.answer);
      await persist((current) => ({ ...current, ai: { ...current.ai, usage: [result.usage, ...(current.ai?.usage || [])].slice(0, 500) } }));
    } catch (reason) {
      setError(reason.message || "The financial assistant is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal label="Financial insights" title="Ask Lakshmi" onClose={onClose}>
      <div className="form-stack">
        <Field label="Question"><Input autoFocus value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="Where can I reduce spending this month?" onKeyDown={(event) => { if (event.key === "Enter") ask(); }} /></Field>
        <Button kind="primary" disabled={busy || !question.trim()} onClick={ask}><Icon name="ai" />{busy ? "Thinking..." : "Ask"}</Button>
        {answer && <div className="ai-answer">{answer}</div>}
        {error && <div className="error-text">{error}</div>}
        <div><div className="label" style={{ marginBottom: 8 }}>Suggested questions</div><div className="ai-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => { setQuestion(suggestion); setAnswer(""); setError(""); }}>{suggestion}</button>)}</div></div>
        <div className="privacy-note">Planning guidance is educational. Verify current tax rules and contribution limits before acting.</div>
      </div>
    </Modal>
  );
}

function groupChartCategories(categories, limit = 6) {
  if (categories.length <= limit) return categories;
  const visible = categories.slice(0, limit - 1);
  const remainder = categories.slice(limit - 1).reduce((total, item) => ({
    value: total.value + item.value,
    percent: total.percent + item.percent,
  }), { value: 0, percent: 0 });
  return [...visible, { name: "Other categories", color: "#b9b9b9", ...remainder }];
}

function buildDonut(categories) {
  if (!categories.length) return "var(--surface-3)";
  let cursor = 0;
  const segments = categories.map((category) => {
    const start = cursor;
    cursor += category.percent;
    return `${category.color} ${start.toFixed(2)}% ${Math.min(100, cursor).toFixed(2)}%`;
  });
  if (cursor < 100) segments.push(`var(--surface-3) ${cursor.toFixed(2)}% 100%`);
  return `conic-gradient(${segments.join(",")})`;
}

function PaymentModal({ item, vault, persist, notify, companion, currentOwner, onClose }) {
  const remaining = item.amount == null ? 0 : Math.max(0, number(item.amount) - number(item.paidAmount));
  const [amount, setAmount] = useState(remaining ? String(remaining) : "");
  const [date, setDate] = useState(todayISO());
  const partnerCard = item.card.owner === "partner" || item.card.owner === "spouse";
  const [fundingSource, setFundingSource] = useState(!companion && partnerCard ? "external" : "personal");
  const [error, setError] = useState("");
  function save() {
    const paid = number(amount);
    if (paid <= 0) return;
    if (fundingSource === "joint" && paid > jointAccountBalance(vault) + 0.005) { setError(`Only ${money(jointAccountBalance(vault))} is available in the joint account.`); return; }
    const payment = {
      id: uid("card-payment"), cardId: item.card.id, statementId: item.statement?.id || "", dueMonth: item.dueDate.slice(0, 7),
      date, amount: paid, owner: item.card.owner || "me", fundingSource, createdAt: new Date().toISOString(),
    };
    persist((current) => ({
      ...current,
      cardPayments: [payment, ...current.cardPayments],
      jointTransfers: fundingSource === "joint" ? [{ id: uid("joint-transfer"), date, amount: paid, direction: "from-joint", owner: currentOwner, actorName: current.profile?.name || (companion ? "Partner" : "Primary"), note: `Paid ${item.card.bank} ${item.card.last4 ? `...${item.card.last4}` : item.card.name}`, adjustsPersonalBalance: false, cardPaymentId: payment.id, createdAt: new Date().toISOString() }, ...(current.jointTransfers || [])] : (current.jointTransfers || []),
      settings: fundingSource === "personal" ? { ...current.settings, bankBalance: number(current.settings.bankBalance) - paid } : current.settings,
    }));
    notify(`${money(paid)} card payment recorded from ${fundingSource === "joint" ? "the joint account" : fundingSource === "external" ? "the partner / external account" : "the tracked bank balance"}, without changing Spent.`);
    onClose();
  }
  return (
    <Modal label="Card payment" title={`${item.card.bank} ${item.card.last4 ? `...${item.card.last4}` : item.card.name}`} onClose={onClose}>
      <div className="form-stack">
        <div className="security-banner"><span className="icon-box"><Icon name="card" /></span><div><strong>Payment stays outside Spent</strong><div className="helper">The purchase expenses were already counted when their receipts entered the ledger.</div></div></div>
        <Field label="Amount paid"><Input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
        <Field label="Payment date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Paid from"><Select value={fundingSource} onChange={(event) => { setFundingSource(event.target.value); setError(""); }}><option value="personal">My tracked bank balance</option>{vault.jointAccount?.enabled && <option value="joint">{vault.jointAccount.name || "Joint account"}</option>}<option value="external">Partner / external account (status only)</option></Select></Field>
        <div className="privacy-note">Status only records the payment without changing this device's personal or joint balance.</div>
        {error && <div className="error-text">{error}</div>}
        <Button kind="primary" disabled={number(amount) <= 0} onClick={save}><Icon name="check" />Record payment</Button>
      </div>
    </Modal>
  );
}

function StatementReviewModal({ vault, persist, notify, onClose }) {
  const [dismissed, setDismissed] = useState([]);
  const [selected, setSelected] = useState(null);
  const [category, setCategory] = useState("Other");
  const [owner, setOwner] = useState("me");
  const [originalExpenseId, setOriginalExpenseId] = useState("");
  const pending = unmatchedStatementTransactions(vault).filter((item) => !dismissed.includes(`${item.statementId}:${item.id}`));
  const card = selected ? vault.creditCards.find((item) => item.id === selected.cardId) : null;
  const refundable = selected?.direction === "credit"
    ? vault.expenses.filter((expense) => expense.paymentMethod === "credit" && (!selected.cardId || !expense.cardId || expense.cardId === selected.cardId) && expenseRefundStatus(vault, expense).remaining > 0)
    : [];

  function choose(transaction) {
    const prior = vault.expenses.find((expense) => String(expense.store || "").toLowerCase() === String(transaction.description || "").toLowerCase());
    setSelected(transaction);
    setCategory(prior?.category || "Other");
    setOwner(prior?.owner || "me");
    setOriginalExpenseId("");
  }

  function complete(transaction, status, matchedRecordId = "") {
    persist((current) => ({
      ...current,
      cardStatements: current.cardStatements.map((statement) => statement.id !== transaction.statementId ? statement : {
        ...statement,
        transactions: (statement.transactions || []).map((item) => item.id === transaction.id ? { ...item, status, matchedRecordId } : item),
      }),
    }));
    setDismissed((current) => [...current, `${transaction.statementId}:${transaction.id}`]);
    setSelected(null);
  }

  function save() {
    if (!selected || number(selected.amount) <= 0) return;
    const original = vault.expenses.find((expense) => expense.id === originalExpenseId);
    if (selected.direction === "credit" && original && number(selected.amount) > expenseRefundStatus(vault, original).remaining + 0.01) {
      notify("This credit is larger than the refundable balance on the selected purchase.");
      return;
    }
    const recordId = uid(selected.direction === "credit" ? "refund" : "expense");
    persist((current) => {
      const cardStatements = current.cardStatements.map((statement) => statement.id !== selected.statementId ? statement : {
        ...statement,
        transactions: (statement.transactions || []).map((item) => item.id === selected.id ? { ...item, status: "matched", matchedRecordId: recordId } : item),
      });
      if (selected.direction === "credit") {
        const refund = {
          id: recordId,
          originalExpenseId: originalExpenseId || "",
          date: selected.date || todayISO(),
          effectiveDate: original?.date || selected.date || todayISO(),
          store: selected.description || "Card refund",
          category: original?.category || category,
          amount: number(selected.amount),
          refundMethod: "credit",
          cardId: selected.cardId || "",
          owner,
          source: "statement-reconciliation",
          createdAt: new Date().toISOString(),
        };
        return { ...current, cardStatements, refunds: [refund, ...(current.refunds || [])] };
      }
      const expense = {
        id: recordId,
        date: selected.date || todayISO(),
        store: selected.description || "Card purchase",
        category,
        subtotal: number(selected.amount),
        tax: 0,
        tip: 0,
        discount: 0,
        total: number(selected.amount),
        paymentMethod: "credit",
        cardId: selected.cardId || "",
        owner,
        items: [{ id: uid("item"), name: selected.description || "Card purchase", qty: 1, unit: "ea", lineTotal: number(selected.amount) }],
        source: "statement-reconciliation",
        createdAt: new Date().toISOString(),
      };
      return { ...current, cardStatements, expenses: [expense, ...current.expenses] };
    });
    notify(selected.direction === "credit" ? "Card credit recorded as a refund." : "Card purchase added to Spent.");
    onClose();
  }

  function ignore() {
    if (!selected) return;
    complete(selected, "ignored");
    notify("Statement line ignored. It will not affect your totals.");
  }

  return (
    <Modal label="Card statement" title="Review transactions" onClose={onClose}>
      <div className="form-stack">
        {!selected && (pending.length ? pending.map((transaction) => {
          const transactionCard = vault.creditCards.find((item) => item.id === transaction.cardId);
          return <button className="profile-row" type="button" key={`${transaction.statementId}:${transaction.id}`} onClick={() => choose(transaction)}><span className="icon-box"><Icon name={transaction.direction === "credit" ? "in" : "card"} /></span><span className="truncate"><strong>{transaction.description}</strong><br /><span className="helper">{transaction.date || transaction.statementDate} - {transactionCard?.bank || "Card"} {transactionCard?.last4 ? `...${transactionCard.last4}` : ""}</span></span><strong className={transaction.direction === "credit" ? "inflow-text" : "money"}>{transaction.direction === "credit" ? "+" : ""}{money(transaction.amount)}</strong></button>;
        }) : <div className="security-banner"><span className="icon-box"><Icon name="check" /></span><div><strong>All reviewed</strong><div className="helper">Every statement line now has a decision.</div></div></div>)}

        {selected && <>
          <div className="security-banner"><span className="icon-box"><Icon name={selected.direction === "credit" ? "in" : "card"} /></span><div><strong>{selected.description}</strong><div className="helper">{selected.date} - {card?.bank || "Card"} {card?.last4 ? `...${card.last4}` : ""} - {money(selected.amount)}</div></div></div>
          <Segmented columns={2} label="Owner" value={owner} onChange={setOwner} options={[{ value: "me", label: vault.profile?.name || "Me" }, { value: "partner", label: vault.householdLink?.partnerName || "Partner" }]} />
          <Field label="Category"><Select value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</Select></Field>
          {selected.direction === "credit" && <Field label="Original purchase (recommended)"><Select value={originalExpenseId} onChange={(event) => {
            const value = event.target.value;
            const expense = vault.expenses.find((item) => item.id === value);
            setOriginalExpenseId(value);
            if (expense) {
              setCategory(expense.category || "Other");
              setOwner(expense.owner || "me");
            }
          }}><option value="">Not linked</option>{refundable.map((expense) => <option key={expense.id} value={expense.id}>{expense.date} - {expense.store} - {money(expenseRefundStatus(vault, expense).remaining)} available</option>)}</Select></Field>}
          <div className="button-row"><Button kind="primary" onClick={save}><Icon name="check" />{selected.direction === "credit" ? "Record refund" : "Add expense"}</Button><Button kind="ghost" onClick={ignore}>Ignore</Button><Button kind="ghost" onClick={() => setSelected(null)}>Back</Button></div>
        </>}
      </div>
    </Modal>
  );
}
