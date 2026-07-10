import { useMemo, useState } from "react";
import { CATEGORIES } from "../data/defaults.js";
import { monthStats } from "../lib/finance.js";
import { currentMonth, money, monthKey, monthLabel, number, shiftMonth } from "../lib/format.js";
import { Button, Card, CardHeader, Field, Icon, IconButton, Input, Modal, MonthNavigator, Segmented, Select } from "../components/ui.jsx";

export default function LedgerTab({ vault, persist, notify, openModal }) {
  const [month, setMonth] = useState(currentMonth());
  const [scope, setScope] = useState("month");
  const [search, setSearch] = useState("");
  const stats = useMemo(() => monthStats(vault, month), [vault, month]);
  const query = search.trim().toLowerCase();
  const expenses = useMemo(() => vault.expenses.filter((item) => (scope === "all" || monthKey(item.date) === month) && (!query || `${item.store} ${item.category} ${(item.items || []).map((entry) => entry.name).join(" ")}`.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date)), [vault.expenses, scope, month, query]);
  const incomes = useMemo(() => vault.incomeTransactions.filter((item) => (scope === "all" || monthKey(item.date) === month) && (!query || `${item.name} ${item.owner}`.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date)), [vault.incomeTransactions, scope, month, query]);
  const payments = useMemo(() => vault.cardPayments.filter((item) => scope === "all" || monthKey(item.date) === month).sort((a, b) => b.date.localeCompare(a.date)), [vault.cardPayments, scope, month]);
  const selectedIncome = scope === "month" ? stats.income : incomes.reduce((sum, item) => sum + number(item.amount), 0);
  const categoryTotals = useMemo(() => {
    const map = {};
    for (const expense of expenses) map[expense.category || "Other"] = (map[expense.category || "Other"] || 0) + number(expense.total);
    return Object.entries(map).map(([category, amount]) => ({ category, amount, percent: selectedIncome ? (amount / selectedIncome) * 100 : 0 })).sort((a, b) => b.amount - a.amount);
  }, [expenses, selectedIncome]);

  function removeExpense(expense) {
    if (!window.confirm(`Delete ${expense.store} for ${money(expense.total)}?`)) return;
    persist((current) => ({
      ...current,
      expenses: current.expenses.filter((item) => item.id !== expense.id),
      fuelEntries: current.fuelEntries.filter((item) => item.sourceExpenseId !== expense.id),
      settings: expense.paymentMethod === "credit" ? current.settings : { ...current.settings, bankBalance: number(current.settings.bankBalance) + number(expense.total) },
    }));
    notify("Expense removed and balance adjusted.");
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
    persist((current) => ({ ...current, cardPayments: current.cardPayments.filter((item) => item.id !== payment.id), settings: { ...current.settings, bankBalance: number(current.settings.bankBalance) + number(payment.amount) } }));
    notify("Card payment removed and bank balance restored.");
  }

  return (
    <>
      <MonthNavigator label={scope === "all" ? "All months" : monthLabel(month)} onPrevious={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} action={<Button compact onClick={() => setMonth(currentMonth())}>Today</Button>} />
      <Segmented columns={2} label="Ledger period" value={scope} onChange={setScope} options={[{ value: "month", label: "Selected month" }, { value: "all", label: "All records" }]} />
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
        {expenses.length ? expenses.map((expense) => (
          <div className="row with-icon" key={expense.id}>
            <span className="icon-box"><Icon name={expense.paymentMethod === "credit" ? "card" : "ledger"} /></span>
            <span className="truncate"><strong>{expense.store}</strong><br /><span className="helper">{expense.date} - {expense.category}{expense.paymentMethod === "credit" ? " - credit" : ""}</span></span>
            <span className="row-actions"><strong className="money text-out">-{money(expense.total)}</strong><IconButton icon="edit" label="Edit expense" onClick={() => openModal({ content: <EditExpenseModal expense={expense} vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })} /><IconButton icon="trash" label="Delete expense" className="danger" onClick={() => removeExpense(expense)} /></span>
          </div>
        )) : <div className="helper">No expenses in this view.</div>}
      </Card>

      <Card>
        <CardHeader label="Income received" helper="Deposits recorded manually or from income schedules" />
        {incomes.length ? incomes.map((income) => (
          <div className="row with-icon" key={income.id}>
            <span className="icon-box" style={{ color: "var(--inflow)" }}><Icon name="arrow-down-left" /></span>
            <span className="truncate"><strong>{income.name}</strong><br /><span className="helper">{income.date}{income.savings ? ` - ${money(income.savings)} to savings` : ""}</span></span>
            <span className="row-actions"><strong className="money text-in">+{money(income.amount)}</strong><IconButton icon="trash" label="Delete income" className="danger" onClick={() => removeIncome(income)} /></span>
          </div>
        )) : <div className="helper">No income deposits in this view.</div>}
      </Card>

      <Card>
        <CardHeader label="Credit card payments" helper="Bank transfers shown separately and excluded from Spent" />
        {payments.length ? payments.map((payment) => {
          const card = vault.creditCards.find((item) => item.id === payment.cardId);
          return <div className="row with-icon" key={payment.id}><span className="icon-box"><Icon name="card" /></span><span><strong>{card ? `${card.bank} ${card.last4 ? `...${card.last4}` : card.name}` : "Card payment"}</strong><br /><span className="helper">{payment.date}</span></span><span className="row-actions"><strong className="money">{money(payment.amount)}</strong><IconButton icon="trash" label="Delete card payment" className="danger" onClick={() => removePayment(payment)} /></span></div>;
        }) : <div className="helper">No credit-card payments in this view.</div>}
      </Card>
    </>
  );
}

function EditExpenseModal({ expense, vault, persist, notify, onClose }) {
  const [draft, setDraft] = useState({ ...expense });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  function save() {
    const oldImpact = expense.paymentMethod === "credit" ? 0 : number(expense.total);
    const newImpact = draft.paymentMethod === "credit" ? 0 : number(draft.total);
    persist({
      ...vault,
      expenses: vault.expenses.map((item) => item.id === expense.id ? { ...draft, total: number(draft.total), subtotal: number(draft.subtotal), tax: number(draft.tax), cardId: draft.paymentMethod === "credit" ? draft.cardId || "" : "" } : item),
      settings: { ...vault.settings, bankBalance: number(vault.settings.bankBalance) + oldImpact - newImpact },
    });
    notify("Expense updated and balance reconciled.");
    onClose();
  }
  return (
    <Modal label="Ledger" title="Edit expense" onClose={onClose}>
      <div className="form-stack">
        <Field label="Store"><Input value={draft.store} onChange={(event) => update("store", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Date"><Input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></Field><Field label="Category"><Select value={draft.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field></div>
        <div className="field-grid"><Field label="Total"><Input inputMode="decimal" value={draft.total} onChange={(event) => update("total", event.target.value)} /></Field><Field label="Paid with"><Select value={draft.paymentMethod || "bank"} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field></div>
        {draft.paymentMethod === "credit" && <Field label="Card"><Select value={draft.cardId || ""} onChange={(event) => update("cardId", event.target.value)}><option value="">Unspecified</option>{vault.creditCards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field>}
        <Button kind="primary" onClick={save}><Icon name="save" />Save changes</Button>
      </div>
    </Modal>
  );
}
