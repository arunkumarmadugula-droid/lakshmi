import { useMemo, useState } from "react";
import { CATEGORIES } from "../data/defaults.js";
import { expenseNetAmount, expenseRefundStatus, expenseSplitStatus, monthStats, ownerMatches } from "../lib/finance.js";
import { addDays, currentMonth, dateDMY, money, monthKey, monthLabel, number, shiftMonth, todayISO } from "../lib/format.js";
import { copySplitExpense, saveSplitPdf, shareSplitExpense } from "../lib/share.js";
import { Button, Card, CardHeader, Field, Icon, IconButton, Input, Modal, MonthNavigator, Segmented, Select } from "../components/ui.jsx";

export default function LedgerTab({ vault, persist, notify, openModal, companion = false }) {
  const [month, setMonth] = useState(currentMonth());
  const [scope, setScope] = useState("month");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [ownerScope, setOwnerScope] = useState(companion ? "partner" : "household");
  const [search, setSearch] = useState("");
  const stats = useMemo(() => monthStats(vault, month, ownerScope), [vault, month, ownerScope]);
  const query = search.trim().toLowerCase();
  const periodMatches = (date) => scope === "all" || (scope === "day" ? date === selectedDate : monthKey(date) === month);
  const expenses = useMemo(() => vault.expenses.filter((item) => periodMatches(item.date) && ownerMatches(item, ownerScope) && (!query || `${item.store} ${item.category} ${(item.items || []).map((entry) => entry.name).join(" ")}`.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date)), [vault.expenses, scope, selectedDate, month, ownerScope, query]);
  const refunds = useMemo(() => (vault.refunds || []).filter((item) => periodMatches(item.date) && ownerMatches(item, ownerScope) && (!query || `${item.store} ${item.category}`.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date)), [vault.refunds, scope, selectedDate, month, ownerScope, query]);
  const incomes = useMemo(() => vault.incomeTransactions.filter((item) => periodMatches(item.date) && ownerMatches(item, ownerScope) && (!query || `${item.name} ${item.owner}`.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date)), [vault.incomeTransactions, scope, selectedDate, month, ownerScope, query]);
  const reimbursements = useMemo(() => (vault.splitReimbursements || []).filter((item) => {
    const expense = vault.expenses.find((entry) => entry.id === item.expenseId);
    return periodMatches(item.date) && ownerMatches(item, ownerScope) && (!query || `${item.person} ${expense?.store || ""}`.toLowerCase().includes(query));
  }).sort((a, b) => b.date.localeCompare(a.date)), [vault.splitReimbursements, vault.expenses, scope, selectedDate, month, ownerScope, query]);
  const statements = useMemo(() => vault.cardStatements.filter((statement) => {
    const card = vault.creditCards.find((item) => item.id === statement.cardId);
    const owned = { owner: statement.owner || card?.owner || "me" };
    return ownerMatches(owned, ownerScope) && periodMatches(statement.statementDate || statement.dueDate) && (!query || `${card?.bank || ""} ${card?.name || ""} ${card?.last4 || ""}`.toLowerCase().includes(query));
  }).sort((a, b) => String(b.statementDate).localeCompare(String(a.statementDate))), [vault.cardStatements, vault.creditCards, scope, selectedDate, month, ownerScope, query]);
  const payments = useMemo(() => vault.cardPayments.filter((item) => {
    const card = vault.creditCards.find((entry) => entry.id === item.cardId);
    return ownerMatches({ owner: item.owner || card?.owner || "me" }, ownerScope) && periodMatches(item.date);
  }).sort((a, b) => b.date.localeCompare(a.date)), [vault.cardPayments, vault.creditCards, scope, selectedDate, month, ownerScope]);
  const selectedIncome = scope === "month" ? stats.income : incomes.reduce((sum, item) => sum + number(item.amount), 0);
  const categoryTotals = useMemo(() => {
    const map = {};
    for (const expense of expenses) map[expense.category || "Other"] = (map[expense.category || "Other"] || 0) + expenseNetAmount(vault, expense);
    for (const refund of refunds.filter((item) => !item.originalExpenseId)) map[refund.category || "Other"] = (map[refund.category || "Other"] || 0) - number(refund.amount);
    return Object.entries(map).filter(([, amount]) => amount > 0.005).map(([category, amount]) => ({ category, amount, percent: selectedIncome ? (amount / selectedIncome) * 100 : 0 })).sort((a, b) => b.amount - a.amount);
  }, [expenses, refunds, selectedIncome, vault]);

  function removeExpense(expense) {
    if (!window.confirm(`Delete ${expense.store} for ${money(expense.total)}?`)) return;
    persist((current) => {
      const related = (current.splitReimbursements || []).filter((item) => item.expenseId === expense.id);
      const repaid = related.reduce((sum, item) => sum + number(item.amount), 0);
      const relatedRefunds = (current.refunds || []).filter((item) => item.originalExpenseId === expense.id);
      const bankRefunds = relatedRefunds.filter((item) => item.refundMethod === "bank").reduce((sum, item) => sum + number(item.amount), 0);
      const balanceChange = (expense.paymentMethod === "credit" ? 0 : number(expense.total)) - repaid - bankRefunds;
      return {
        ...current,
        expenses: current.expenses.filter((item) => item.id !== expense.id),
        fuelEntries: current.fuelEntries.filter((item) => item.sourceExpenseId !== expense.id),
        splitReimbursements: (current.splitReimbursements || []).filter((item) => item.expenseId !== expense.id),
        refunds: (current.refunds || []).filter((item) => item.originalExpenseId !== expense.id),
        settings: { ...current.settings, bankBalance: number(current.settings.bankBalance) + balanceChange },
      };
    });
    notify("Expense removed and balance adjusted.");
  }

  function removeRefund(refund) {
    if (!window.confirm(`Delete refund of ${money(refund.amount)} from ${refund.store}?`)) return;
    persist((current) => ({
      ...current,
      refunds: (current.refunds || []).filter((item) => item.id !== refund.id),
      settings: refund.refundMethod === "bank" ? { ...current.settings, bankBalance: number(current.settings.bankBalance) - number(refund.amount) } : current.settings,
    }));
    notify("Refund removed and balances reconciled.");
  }

  function removeReimbursement(repayment) {
    if (!window.confirm(`Delete repayment of ${money(repayment.amount)}?`)) return;
    persist((current) => ({
      ...current,
      splitReimbursements: (current.splitReimbursements || []).filter((item) => item.id !== repayment.id),
      settings: { ...current.settings, bankBalance: number(current.settings.bankBalance) - number(repayment.amount) },
    }));
    notify("Split repayment removed and spending restored.");
  }

  function removeIncome(income) {
    if (!window.confirm(`Delete ${income.name} for ${money(income.amount)}?`)) return;
    persist((current) => ({
      ...current,
      incomeTransactions: current.incomeTransactions.filter((item) => item.id !== income.id),
      settings: { ...current.settings, bankBalance: number(current.settings.bankBalance) - (number(income.amount) - number(income.savings)), savingsBalance: number(current.settings.savingsBalance) - number(income.savings) },
    }));
    notify("Income entry removed and balances adjusted.");
  }

  function removePayment(payment) {
    if (!window.confirm(`Delete card payment of ${money(payment.amount)}?`)) return;
    const fundingSource = payment.fundingSource || "personal";
    persist((current) => ({
      ...current,
      cardPayments: current.cardPayments.filter((item) => item.id !== payment.id),
      jointTransfers: (current.jointTransfers || []).filter((item) => item.cardPaymentId !== payment.id),
      settings: fundingSource === "personal" ? { ...current.settings, bankBalance: number(current.settings.bankBalance) + number(payment.amount) } : current.settings,
    }));
    notify(fundingSource === "personal" ? "Card payment removed and bank balance restored." : fundingSource === "joint" ? "Card payment and joint-account withdrawal removed." : "Card payment status removed.");
  }

  function removeStatement(statement) {
    if (!window.confirm(`Delete card statement for ${money(statement.statementBalance)}?`)) return;
    persist((current) => ({ ...current, cardStatements: current.cardStatements.filter((item) => item.id !== statement.id) }));
    notify("Card statement removed. Recorded payments remain in their separate ledger.");
  }

  function movePeriod(delta) {
    if (scope === "day") {
      const nextDate = addDays(selectedDate, delta);
      setSelectedDate(nextDate);
      setMonth(monthKey(nextDate));
      return;
    }
    if (scope === "month") setMonth(shiftMonth(month, delta));
  }

  function changeScope(nextScope) {
    if (nextScope === "day" && monthKey(selectedDate) !== month) {
      const day = Math.min(Number(selectedDate.slice(8, 10)) || 1, new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate());
      setSelectedDate(`${month}-${String(day).padStart(2, "0")}`);
    }
    setScope(nextScope);
  }

  function chooseDate(date) {
    setSelectedDate(date);
    setMonth(monthKey(date));
    setScope("day");
    openModal(null);
  }

  const periodLabel = scope === "all" ? "All records" : scope === "day" ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : monthLabel(month);

  return (
    <>
      <MonthNavigator label={periodLabel} onPrevious={scope === "all" ? undefined : () => movePeriod(-1)} onNext={scope === "all" ? undefined : () => movePeriod(1)} previousLabel={scope === "day" ? "Previous day" : "Previous month"} nextLabel={scope === "day" ? "Next day" : "Next month"} action={<IconButton icon="calendar" label="Choose exact date" onClick={() => openModal({ content: <DatePickerModal initialDate={selectedDate} onApply={chooseDate} onClose={() => openModal(null)} /> })} />} />
      <Segmented label="Ledger period" value={scope} onChange={changeScope} options={[{ value: "day", label: "Day" }, { value: "month", label: "Month" }, { value: "all", label: "All" }]} />
      {!companion && vault.householdLink?.enabled && <Segmented label="Ledger owner" value={ownerScope} onChange={setOwnerScope} options={[{ value: "mine", label: "Mine" }, { value: "partner", label: vault.householdLink.partnerName || "Partner" }, { value: "household", label: "Household" }]} />}
      <div style={{ position: "relative" }}><Icon name="search" style={{ position: "absolute", left: 11, top: 11, color: "var(--muted)" }} /><Input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search store, category, or item" style={{ paddingLeft: 36 }} /></div>

      <Card>
        <CardHeader label="Category share of income" helper={selectedIncome ? `${money(selectedIncome, 0)} inflow in this view` : "Add income to calculate percentages"} />
        {categoryTotals.length ? categoryTotals.slice(0, 8).map((item) => (
          <div className="row" key={item.category}>
            <span>{item.category}<div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${Math.min(100, item.percent)}%` }} /></div></span>
            <strong className="money">{Math.round(item.percent)}% - {money(item.amount, 0)}</strong>
          </div>
        )) : <div className="helper">No expense categories in this view.</div>}
      </Card>

      <Card>
        <CardHeader label="Expenses" helper={`${expenses.length} recorded transaction${expenses.length === 1 ? "" : "s"}`} />
        {expenses.length ? expenses.map((expense) => {
          const split = expenseSplitStatus(vault, expense);
          const refund = expenseRefundStatus(vault, expense);
          const net = expenseNetAmount(vault, expense);
          return (
            <div className="row with-icon" key={expense.id}>
              <span className="icon-box"><Icon name={expense.paymentMethod === "credit" ? "card" : "ledger"} /></span>
              <span className="truncate"><strong>{expense.store}</strong><br /><span className="helper">{dateDMY(expense.date)} - {expense.category}{expense.owner === "partner" || expense.owner === "spouse" ? ` - ${vault.householdLink?.partnerName || "Partner"}` : ""}{expense.paymentMethod === "credit" ? " - credit" : ""}{split.count > 1 ? ` - ${money(expense.total)} / ${split.count}; ${money(split.received)} repaid` : ""}{refund.refunded ? ` - ${money(refund.refunded)} refunded` : ""}{expense.needsDetails ? " - needs details" : ""}</span></span>
              <span className="row-actions"><strong className="money text-out">-{money(net)}</strong><IconButton icon="edit" label="Edit expense" onClick={() => openModal({ content: <EditExpenseModal expense={expense} vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })} /><IconButton icon="trash" label="Delete expense" className="danger" onClick={() => removeExpense(expense)} /></span>
            </div>
          );
        }) : <div className="helper">No expenses in this view.</div>}
      </Card>

      <Card>
        <CardHeader label="Refunds" helper="Contra-expenses reduce Spent and never inflate household income" />
        {refunds.length ? refunds.map((refund) => {
          const original = vault.expenses.find((item) => item.id === refund.originalExpenseId);
          const destination = refund.refundMethod === "credit" ? `card ${vault.creditCards.find((item) => item.id === refund.cardId)?.last4 || "credit"}` : refund.refundMethod === "cash" ? "cash received" : "bank / debit";
          return <div className="row with-icon" key={refund.id}><span className="icon-box" style={{ color: "var(--inflow)" }}><Icon name="restore" /></span><span className="truncate"><strong>{refund.store}</strong><br /><span className="helper">{dateDMY(refund.date)} - {refund.category} - {destination}{original ? ` - linked to ${dateDMY(original.date)}` : ""}</span></span><span className="row-actions"><strong className="money text-in">+{money(refund.amount)}</strong><IconButton icon="trash" label="Delete refund" className="danger" onClick={() => removeRefund(refund)} /></span></div>;
        }) : <div className="helper">No refunds in this view.</div>}
      </Card>

      <Card>
        <CardHeader label="Bill split repayments" helper="Reimbursements reduce the original expense and are not counted as income" />
        {reimbursements.length ? reimbursements.map((repayment) => {
          const expense = vault.expenses.find((item) => item.id === repayment.expenseId);
          return <div className="row with-icon" key={repayment.id}><span className="icon-box" style={{ color: "var(--inflow)" }}><Icon name="users" /></span><span className="truncate"><strong>{repayment.person || "Bill split repayment"}</strong><br /><span className="helper">{dateDMY(repayment.date)} - {expense?.store || "Deleted bill"}</span></span><span className="row-actions"><strong className="money text-in">+{money(repayment.amount)}</strong><IconButton icon="trash" label="Delete repayment" className="danger" onClick={() => removeReimbursement(repayment)} /></span></div>;
        }) : <div className="helper">No split repayments in this view.</div>}
      </Card>

      {!companion && <Card>
        <CardHeader label="Income received" helper="Deposits recorded manually or from income schedules" />
        {incomes.length ? incomes.map((income) => (
          <div className="row with-icon" key={income.id}>
            <span className="icon-box" style={{ color: "var(--inflow)" }}><Icon name="arrow-down-left" /></span>
            <span className="truncate"><strong>{income.name}</strong><br /><span className="helper">{dateDMY(income.date)}{income.savings ? ` - ${money(income.savings)} to savings` : ""}</span></span>
            <span className="row-actions"><strong className="money text-in">+{money(income.amount)}</strong><IconButton icon="trash" label="Delete income" className="danger" onClick={() => removeIncome(income)} /></span>
          </div>
        )) : <div className="helper">No income deposits in this view.</div>}
      </Card>}

      <Card>
        <CardHeader label="Credit card statements" helper="Bills and due dates are excluded from Spent" />
        {statements.length ? statements.map((statement) => {
          const card = vault.creditCards.find((item) => item.id === statement.cardId);
          return <div className="row with-icon" key={statement.id}><span className="icon-box"><Icon name="file" /></span><span className="truncate"><strong>{card ? `${card.bank} ${card.last4 ? `...${card.last4}` : card.name}` : "Card statement"}</strong><br /><span className="helper">Generated {statement.statementDate} - due {statement.dueDate}</span></span><span className="row-actions"><strong className="money">{money(statement.statementBalance)}</strong><IconButton icon="trash" label="Delete statement" className="danger" onClick={() => removeStatement(statement)} /></span></div>;
        }) : <div className="helper">No card statements in this view.</div>}
      </Card>

      <Card>
        <CardHeader label="Credit card payments" helper="Bank transfers shown separately and excluded from Spent" />
        {payments.length ? payments.map((payment) => {
          const card = vault.creditCards.find((item) => item.id === payment.cardId);
          return <div className="row with-icon" key={payment.id}><span className="icon-box"><Icon name="card" /></span><span><strong>{card ? `${card.bank} ${card.last4 ? `...${card.last4}` : card.name}` : "Card payment"}</strong><br /><span className="helper">{dateDMY(payment.date)}</span></span><span className="row-actions"><strong className="money">{money(payment.amount)}</strong><IconButton icon="trash" label="Delete card payment" className="danger" onClick={() => removePayment(payment)} /></span></div>;
        }) : <div className="helper">No credit-card payments in this view.</div>}
      </Card>
    </>
  );
}

function DatePickerModal({ initialDate, onApply, onClose }) {
  const [date, setDate] = useState(initialDate || todayISO());
  return (
    <Modal label="Ledger date" title="Choose an exact day" onClose={onClose}>
      <div className="form-stack">
        <Field label="Date"><Input autoFocus type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Button kind="primary" disabled={!date} onClick={() => onApply(date)}><Icon name="calendar" />Show this day</Button>
      </div>
    </Modal>
  );
}

function EditExpenseModal({ expense, vault, persist, notify, onClose }) {
  const [draft, setDraft] = useState({ ...expense });
  const [error, setError] = useState("");
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  function save() {
    const priorSplit = expenseSplitStatus(vault, expense);
    const priorRefund = expenseRefundStatus(vault, expense);
    if (!draft.split && priorSplit.received > 0) {
      setError("Remove the recorded split repayments before turning off this split.");
      return;
    }
    const splitCount = Math.max(2, Math.round(number(draft.split?.count) || 2));
    const split = draft.split ? {
      count: splitCount,
      expectedReimbursement: Math.round((number(draft.total) - number(draft.total) / splitCount) * 100) / 100,
    } : null;
    if (split && priorSplit.received > split.expectedReimbursement + 0.005) {
      setError(`Recorded repayments already total ${money(priorSplit.received)}. Increase the bill or remove a repayment first.`);
      return;
    }
    if (number(draft.total) + 0.005 < priorSplit.received + priorRefund.refunded) {
      setError(`Repayments and refunds already total ${money(priorSplit.received + priorRefund.refunded)}. Increase the bill or remove an adjustment first.`);
      return;
    }
    const oldImpact = expense.paymentMethod === "credit" ? 0 : number(expense.total);
    const newImpact = draft.paymentMethod === "credit" ? 0 : number(draft.total);
    persist((current) => ({
      ...current,
      expenses: current.expenses.map((item) => item.id === expense.id ? { ...draft, split, total: number(draft.total), subtotal: number(draft.subtotal), tax: number(draft.tax), cardId: draft.paymentMethod === "credit" ? draft.cardId || "" : "", needsDetails: false, updatedAt: new Date().toISOString() } : item),
      settings: { ...current.settings, bankBalance: number(current.settings.bankBalance) + oldImpact - newImpact },
    }));
    notify("Expense updated and balance reconciled.");
    onClose();
  }
  async function share() {
    try {
      await shareSplitExpense({ ...draft, split: draft.split || { count: 2 } });
    } catch (reason) {
      if (reason?.name !== "AbortError") notify(reason.message || "The split could not be shared.");
    }
  }
  return (
    <Modal label="Ledger" title="Edit expense" onClose={onClose}>
      <div className="form-stack">
        <Field label="Store"><Input value={draft.store} onChange={(event) => update("store", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Date"><Input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></Field><Field label="Category"><Select value={draft.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field></div>
        <div className="field-grid"><Field label="Total"><Input inputMode="decimal" value={draft.total} onChange={(event) => update("total", event.target.value)} /></Field><Field label="Paid with"><Select value={draft.paymentMethod || "bank"} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field></div>
        {draft.paymentMethod === "credit" && <Field label="Card"><Select value={draft.cardId || ""} onChange={(event) => update("cardId", event.target.value)}><option value="">Unspecified</option>{vault.creditCards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field>}
        <label className="check-row"><input type="checkbox" checked={!!draft.split} onChange={(event) => update("split", event.target.checked ? { count: expense.split?.count || 2 } : null)} /><span>Split this bill</span></label>
        {draft.split && <Field label="People including you"><Input inputMode="numeric" value={draft.split.count || 2} onChange={(event) => update("split", { ...draft.split, count: event.target.value })} /></Field>}
        {draft.split && <div className="button-row"><Button compact onClick={share}><Icon name="share" />Share</Button><Button compact onClick={() => copySplitExpense({ ...draft, split: draft.split }).then(() => notify("Split details copied."))}><Icon name="copy" />Copy</Button><Button compact onClick={() => saveSplitPdf({ ...draft, split: draft.split })}><Icon name="download" />PDF</Button></div>}
        {error && <div className="error-text">{error}</div>}
        <Button kind="primary" onClick={save}><Icon name="save" />Save changes</Button>
      </div>
    </Modal>
  );
}
