import { useEffect, useMemo, useState } from "react";
import { BUDGET_SUBCATEGORIES, CATEGORIES } from "../data/defaults.js";
import { budgetActuals, estimatePayroll, FREQUENCY_LABELS, monthStats, monthlyEquivalent, PROVINCE_OPTIONS } from "../lib/finance.js";
import { currentMonth, money, number, todayISO, uid } from "../lib/format.js";
import { parseAiResult, prepareDocument, shareForChatGPT } from "../lib/importers.js";
import { Button, Card, CardHeader, EmptyState, Field, FileButton, Icon, IconButton, Input, Modal, Segmented, Select, Textarea } from "../components/ui.jsx";

export default function BudgetTab({ vault, persist, notify, openModal }) {
  const [mode, setMode] = useState("income");
  const salaries = vault.incomeSources.filter((item) => item.kind === "salary");
  const salary = salaries[0];
  const stats = monthStats(vault, currentMonth());
  const projectedIncome = vault.incomeSources.filter((item) => item.active !== false).reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.frequency), 0);
  const totalBudget = Object.values(vault.budgets).reduce((sum, value) => sum + number(value), 0);
  const activePayroll = salary?.annualSalary ? estimatePayroll({ annualSalary: salary.annualSalary, province: salary.province || vault.settings.province, frequency: salary.frequency, rrspAnnual: salary.rrspAnnual, benefitsPerPay: salary.benefitsPerPay }) : null;

  async function uploadPayslip(file) {
    try {
      notify("Reading the payslip locally...");
      const prepared = await prepareDocument(file, "payslip");
      openModal({ content: <BudgetPayslipReview prepared={prepared} draftValue={{ ...prepared.draft, applyToIncome: true, nextDate: prepared.draft.payDate || todayISO() }} vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> });
    } catch (reason) {
      notify(reason.message || "The payslip could not be opened.");
    }
  }

  return (
    <>
      <Segmented label="Budget view" value={mode} onChange={setMode} options={[{ value: "income", label: "Income" }, { value: "budgets", label: "Budgets" }, { value: "savings", label: "Savings" }]} />
      {mode === "income" && (
        <>
          <Card>
            <CardHeader label="Household income" helper="Schedules auto-post deposits from the first expected date" action={<Button compact onClick={() => openModal({ content: <IncomeEditor vault={vault} source={null} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="plus" />Add</Button>} />
            {vault.incomeSources.length ? vault.incomeSources.map((source) => (
              <div className="row with-icon" key={source.id}>
                <span className="icon-box" style={{ color: "var(--inflow)" }}><Icon name={source.kind === "salary" ? "banknote" : "arrow-down-left"} /></span>
                <span className="truncate"><strong>{source.name}</strong><br /><span className="helper">{money(source.amount)} {FREQUENCY_LABELS[source.frequency]?.toLowerCase()} - next {source.nextDate}</span></span>
                <IconButton icon="edit" label="Edit income" onClick={() => openModal({ content: <IncomeEditor vault={vault} source={source} persist={persist} notify={notify} onClose={() => openModal(null)} /> })} />
              </div>
            )) : <EmptyState icon="banknote" title="Add your first income" helper="Salary, spouse income, rent, or business income." />}
          </Card>

          {activePayroll && (
            <Card>
              <CardHeader label={`${salary.owner === "spouse" ? "Spouse" : "Your"} salary - Canada 2026 estimate`} helper={`${salary.company || salary.name} - ${activePayroll.provinceName}`} action={<Button compact onClick={() => openModal({ content: <IncomeEditor vault={vault} source={salary} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="edit" />Edit</Button>} />
              <div className="metric-grid">
                <div className="metric-tile in"><div className="label">Net / pay</div><div className="metric-value">{money(activePayroll.netPay, 0)}</div><div className="helper">{FREQUENCY_LABELS[salary.frequency]}</div></div>
                <div className="metric-tile"><div className="label">Net / month</div><div className="metric-value">{money(activePayroll.netMonth, 0)}</div><div className="helper">after tax</div></div>
                <div className="metric-tile"><div className="label">Gross / pay</div><div className="metric-value">{money(activePayroll.grossPay, 0)}</div><div className="helper">{activePayroll.periods} pays</div></div>
              </div>
              {[
                ["Federal tax", activePayroll.federal / activePayroll.periods],
                [`${activePayroll.provinceName} tax`, activePayroll.provincial / activePayroll.periods],
                ["CPP / QPP", activePayroll.cpp / activePayroll.periods],
                ["EI / QPIP", (activePayroll.ei + activePayroll.qpip) / activePayroll.periods],
                ["Benefits", activePayroll.benefitsPerPay],
              ].map(([label, value]) => <div className="row" key={label}><span>{label}</span><strong className="money">-{money(value)}</strong></div>)}
              <div className="tax-note">Planning estimate using 2026 payroll parameters. A real payslip remains the source of truth.</div>
            </Card>
          )}

          <Card>
            <CardHeader label="Payslip actuals" helper="PDF, screenshot, or photo" action={<FileButton accept="image/*,application/pdf,.pdf" onFile={uploadPayslip}><Icon name="upload" />Upload payslip</FileButton>} />
            {vault.payslips.length ? vault.payslips.slice(0, 4).map((payslip) => (
              <div className="row with-icon" key={payslip.id}><span className="icon-box"><Icon name="file" /></span><span className="truncate"><strong>{payslip.employer}</strong><br /><span className="helper">{payslip.payDate} - {payslip.owner === "spouse" ? "spouse" : "my salary"}</span></span><strong className="money text-in">{money(payslip.netPay)}</strong></div>
            )) : <div className="helper">No payslip actuals saved yet.</div>}
          </Card>

          <Card>
            <CardHeader label="Monthly cash flow" helper="Projected schedules and current recorded spending" />
            <div className="row"><span>Projected household inflow</span><strong className="money text-in">{money(projectedIncome)}</strong></div>
            <div className="row"><span>Budgeted expenses</span><strong className="money text-out">-{money(totalBudget)}</strong></div>
            <div className="row"><span>Projected cash left</span><strong className={`money ${projectedIncome - totalBudget >= 0 ? "text-saved" : "text-out"}`}>{money(projectedIncome - totalBudget)}</strong></div>
            <div className="row"><span>Already spent this month</span><strong className="money">{money(stats.spent)}</strong></div>
            <div className="row"><span>Left to spend</span><strong className="money">{money(totalBudget - stats.spent)}</strong></div>
          </Card>
        </>
      )}

      {mode === "budgets" && <BudgetCategories vault={vault} persist={persist} notify={notify} openModal={openModal} />}
      {mode === "savings" && <SavingsView vault={vault} persist={persist} notify={notify} />}
    </>
  );
}

function IncomeEditor({ vault, source, persist, notify, onClose }) {
  const [kind, setKind] = useState(source?.kind || "salary");
  const [form, setForm] = useState(source || {
    id: uid("income-source"), kind: "salary", name: "My salary", company: "", owner: vault.incomeSources.some((item) => item.owner === "me" && item.kind === "salary") ? "spouse" : "me",
    annualSalary: 85000, province: vault.settings.province || "ON", frequency: "biweekly", benefitsPerPay: 0, rrspAnnual: 0,
    amount: 0, nextDate: todayISO(), savingsPercent: 0, active: true, autoPost: true,
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const payroll = kind === "salary" ? estimatePayroll({ annualSalary: form.annualSalary, province: form.province, frequency: form.frequency, benefitsPerPay: form.benefitsPerPay, rrspAnnual: form.rrspAnnual }) : null;
  function save() {
    const item = kind === "salary"
      ? { ...form, kind, name: form.company?.trim() || (form.owner === "spouse" ? "Spouse salary" : "My salary"), amount: payroll.netPay, annualSalary: number(form.annualSalary), benefitsPerPay: number(form.benefitsPerPay), rrspAnnual: number(form.rrspAnnual), savingsPercent: number(form.savingsPercent) }
      : { ...form, kind: "other", name: form.name?.trim() || "Other income", amount: number(form.amount), savingsPercent: number(form.savingsPercent) };
    const exists = vault.incomeSources.some((entry) => entry.id === item.id);
    persist({ ...vault, settings: { ...vault.settings, province: item.province || vault.settings.province }, incomeSources: exists ? vault.incomeSources.map((entry) => entry.id === item.id ? item : entry) : [item, ...vault.incomeSources] });
    notify("Income schedule saved.");
    onClose();
  }
  function remove() {
    if (!source || !window.confirm(`Delete ${source.name}? Future deposits will stop.`)) return;
    persist({ ...vault, incomeSources: vault.incomeSources.filter((entry) => entry.id !== source.id) });
    notify("Income schedule removed. Recorded deposits remain in Ledger.");
    onClose();
  }
  return (
    <Modal label="Income" title={source ? "Edit income schedule" : "Add income schedule"} onClose={onClose}>
      <div className="form-stack">
        <Segmented columns={2} label="Income type" value={kind} onChange={setKind} options={[{ value: "salary", label: "Salary" }, { value: "other", label: "Other income" }]} />
        {kind === "salary" ? (
          <>
            <div className="field-grid"><Field label="Belongs to"><Select value={form.owner || "me"} onChange={(event) => update("owner", event.target.value)}><option value="me">Me</option><option value="spouse">Spouse</option></Select></Field><Field label="Province"><Select value={form.province || "ON"} onChange={(event) => update("province", event.target.value)}>{PROVINCE_OPTIONS.map((item) => <option value={item.code} key={item.code}>{item.code}</option>)}</Select></Field></div>
            <Field label="Company"><Input value={form.company || ""} onChange={(event) => update("company", event.target.value)} /></Field>
            <div className="field-grid"><Field label="Annual salary"><Input inputMode="decimal" value={form.annualSalary ?? ""} onChange={(event) => update("annualSalary", event.target.value)} /></Field><Field label="Frequency"><Select value={form.frequency || "biweekly"} onChange={(event) => update("frequency", event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></Select></Field></div>
            <div className="field-grid"><Field label="Benefits / pay"><Input inputMode="decimal" value={form.benefitsPerPay ?? ""} onChange={(event) => update("benefitsPerPay", event.target.value)} /></Field><Field label="RRSP / year"><Input inputMode="decimal" value={form.rrspAnnual ?? ""} onChange={(event) => update("rrspAnnual", event.target.value)} /></Field></div>
            <div className="metric-grid"><div className="metric-tile in"><div className="label">Net / pay</div><div className="metric-value">{money(payroll.netPay, 0)}</div></div><div className="metric-tile"><div className="label">Tax / pay</div><div className="metric-value">{money((payroll.federal + payroll.provincial) / payroll.periods, 0)}</div></div><div className="metric-tile"><div className="label">CPP + EI</div><div className="metric-value">{money((payroll.cpp + payroll.ei + payroll.qpip) / payroll.periods, 0)}</div></div></div>
          </>
        ) : (
          <><Field label="Income name"><Input value={form.name || ""} onChange={(event) => update("name", event.target.value)} placeholder="Rent, business income, benefit" /></Field><div className="field-grid"><Field label="Amount per deposit"><Input inputMode="decimal" value={form.amount ?? ""} onChange={(event) => update("amount", event.target.value)} /></Field><Field label="Frequency"><Select value={form.frequency || "monthly"} onChange={(event) => update("frequency", event.target.value)}><option value="once">One time</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field></div></>
        )}
        <div className="field-grid"><Field label="First expected deposit"><Input type="date" value={form.nextDate || todayISO()} onChange={(event) => update("nextDate", event.target.value)} /></Field><Field label="Savings split %"><Input inputMode="decimal" min="0" max="100" value={form.savingsPercent ?? 0} onChange={(event) => update("savingsPercent", event.target.value)} /></Field></div>
        <label className="check-row"><input type="checkbox" checked={form.autoPost !== false} onChange={(event) => update("autoPost", event.target.checked)} /><span>Automatically record deposits when their scheduled date arrives</span></label>
        <div className="button-row"><Button kind="primary" onClick={save}><Icon name="save" />Save income</Button>{source && <Button kind="danger" onClick={remove}><Icon name="trash" />Delete</Button>}</div>
      </div>
    </Modal>
  );
}

function BudgetPayslipReview({ prepared, draftValue, vault, persist, notify, onClose }) {
  const [draft, setDraft] = useState(draftValue);
  const [json, setJson] = useState("");
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function share() {
    try { await shareForChatGPT(prepared); notify("Shared with ChatGPT. Paste its JSON result below."); } catch (reason) { if (reason.name !== "AbortError") notify(reason.message); }
  }
  function loadJson() {
    try { setDraft({ ...parseAiResult(json, "payslip"), applyToIncome: true, nextDate: draft.nextDate || todayISO() }); notify("AI result loaded."); } catch (reason) { notify(reason.message); }
  }
  function save() {
    const payslip = { ...draft, id: uid("payslip"), grossPay: number(draft.grossPay), netPay: number(draft.netPay), sourceFileName: prepared.fileName, createdAt: new Date().toISOString() };
    const matching = vault.incomeSources.find((item) => item.kind === "salary" && item.owner === payslip.owner);
    let incomeSources = vault.incomeSources;
    if (draft.applyToIncome) {
      if (matching) incomeSources = incomeSources.map((item) => item.id === matching.id ? { ...item, name: payslip.employer || item.name, company: payslip.employer || item.company, amount: payslip.netPay, frequency: payslip.frequency || item.frequency, nextDate: draft.nextDate || item.nextDate } : item);
      else incomeSources = [{ id: uid("income-source"), kind: "salary", owner: payslip.owner || "me", name: payslip.employer || "Salary", company: payslip.employer || "", amount: payslip.netPay, frequency: payslip.frequency || "biweekly", nextDate: draft.nextDate || payslip.payDate || todayISO(), active: true, autoPost: true, savingsPercent: 0 }, ...incomeSources];
    }
    persist({ ...vault, payslips: [payslip, ...vault.payslips].slice(0, 48), incomeSources });
    notify("Payslip actual saved and income updated.");
    onClose();
  }
  return (
    <Modal label="Payslip actual" title="Review before applying" onClose={onClose}>
      <div className="form-stack">
        <div className="button-row"><Button kind="ai" onClick={share}><Icon name="ai" />Send to ChatGPT</Button></div>
        <Field label="Paste AI JSON"><Textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder='{"employer":"..."}' /></Field>
        <Button compact disabled={!json.trim()} onClick={loadJson}><Icon name="check" />Load JSON</Button>
        <Field label="Employer"><Input value={draft.employer || ""} onChange={(event) => update("employer", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Belongs to"><Select value={draft.owner || "me"} onChange={(event) => update("owner", event.target.value)}><option value="me">My salary</option><option value="spouse">Spouse salary</option></Select></Field><Field label="Pay date"><Input type="date" value={draft.payDate || todayISO()} onChange={(event) => update("payDate", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Gross"><Input inputMode="decimal" value={draft.grossPay ?? ""} onChange={(event) => update("grossPay", event.target.value)} /></Field><Field label="Net"><Input inputMode="decimal" value={draft.netPay ?? ""} onChange={(event) => update("netPay", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Frequency"><Select value={draft.frequency || "biweekly"} onChange={(event) => update("frequency", event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></Select></Field><Field label="Next deposit"><Input type="date" value={draft.nextDate || todayISO()} onChange={(event) => update("nextDate", event.target.value)} /></Field></div>
        <label className="check-row"><input type="checkbox" checked={draft.applyToIncome !== false} onChange={(event) => update("applyToIncome", event.target.checked)} /><span>Apply this net pay to the matching income schedule</span></label>
        <Button kind="primary" disabled={!draft.employer || number(draft.netPay) <= 0} onClick={save}><Icon name="save" />Save payslip</Button>
      </div>
    </Modal>
  );
}

function BudgetCategories({ vault, persist, notify, openModal }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(CATEGORIES.map((category) => [category, vault.budgets[category] ?? ""])));
  const [expanded, setExpanded] = useState("");
  const actuals = budgetActuals(vault, currentMonth());
  useEffect(() => setDrafts(Object.fromEntries(CATEGORIES.map((category) => [category, vault.budgets[category] ?? ""]))), [vault.budgets]);
  function commit(category) {
    persist({ ...vault, budgets: { ...vault.budgets, [category]: number(drafts[category]) } });
  }
  function removeItem(item) {
    persist({ ...vault, budgetItems: vault.budgetItems.filter((entry) => entry.id !== item.id), recurringExpenses: vault.recurringExpenses.filter((entry) => entry.budgetItemId !== item.id) });
    notify("Budget detail removed.");
  }
  return (
    <Card>
      <CardHeader label="Category budgets" helper="Tap a category to manage scheduled details" />
      {CATEGORIES.map((category) => {
        const actual = actuals.find((item) => item.category === category)?.actual || 0;
        const budget = number(drafts[category]);
        const items = vault.budgetItems.filter((item) => item.category === category);
        return <div key={category} style={{ borderTop: "1px solid var(--line)" }}>
          <div className="row" style={{ borderTop: 0 }}>
            <button type="button" className="button ghost" style={{ justifyContent: "flex-start", paddingLeft: 0 }} onClick={() => setExpanded(expanded === category ? "" : category)}><Icon name="chevron-down" />{category}</button>
            <span className="inline-actions"><Input inputMode="decimal" value={drafts[category]} placeholder="0" aria-label={`${category} monthly budget`} onChange={(event) => setDrafts((current) => ({ ...current, [category]: event.target.value }))} onBlur={() => commit(category)} style={{ width: 84, textAlign: "right" }} /><span className="helper">/mo</span></span>
          </div>
          {budget > 0 && <div className={`progress ${actual > budget ? "over" : ""}`} style={{ marginBottom: expanded === category ? 8 : 10 }}><span style={{ width: `${Math.min(100, (actual / budget) * 100)}%` }} /></div>}
          {expanded === category && <div style={{ paddingBottom: 10 }}>{items.map((item) => <div className="row" key={item.id}><span>{item.name}<br /><span className="helper">{item.scheduled ? `${FREQUENCY_LABELS[item.frequency]} from ${item.nextDate}` : "Budget detail"}</span></span><span className="row-actions"><strong className="money">{money(item.amount)}</strong><IconButton icon="trash" label="Remove detail" className="danger" onClick={() => removeItem(item)} /></span></div>)}<Button compact onClick={() => openModal({ content: <BudgetItemModal category={category} vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="plus" />Add detail</Button></div>}
        </div>;
      })}
    </Card>
  );
}

function BudgetItemModal({ category, vault, persist, notify, onClose }) {
  const [form, setForm] = useState({ name: BUDGET_SUBCATEGORIES[category]?.[0] || "Other", customName: "", amount: "", scheduled: false, frequency: "monthly", nextDate: todayISO(), autoPost: false, paymentMethod: "bank" });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function save() {
    const name = form.name === "Other" ? form.customName.trim() || "Other" : form.name;
    const item = { id: uid("budget-item"), category, name, amount: number(form.amount), scheduled: form.scheduled, frequency: form.frequency, nextDate: form.nextDate, autoPost: form.autoPost, paymentMethod: form.paymentMethod };
    const recurring = form.scheduled ? { id: uid("recurring"), budgetItemId: item.id, category, name, amount: item.amount, frequency: item.frequency, nextDate: item.nextDate, autoPost: item.autoPost, paymentMethod: item.paymentMethod, active: true } : null;
    persist({ ...vault, budgetItems: [item, ...vault.budgetItems], recurringExpenses: recurring ? [recurring, ...vault.recurringExpenses] : vault.recurringExpenses });
    notify("Budget detail saved.");
    onClose();
  }
  return (
    <Modal label={category} title="Add budget detail" onClose={onClose}>
      <div className="form-stack">
        <Field label="Item"><Select value={form.name} onChange={(event) => update("name", event.target.value)}>{(BUDGET_SUBCATEGORIES[category] || ["Other"]).map((item) => <option key={item}>{item}</option>)}</Select></Field>
        {form.name === "Other" && <Field label="Name"><Input value={form.customName} onChange={(event) => update("customName", event.target.value)} /></Field>}
        <Field label="Monthly amount"><Input inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} /></Field>
        <label className="check-row"><input type="checkbox" checked={form.scheduled} onChange={(event) => update("scheduled", event.target.checked)} /><span>Add this item to the cash-flow calendar</span></label>
        {form.scheduled && <><div className="field-grid"><Field label="Frequency"><Select value={form.frequency} onChange={(event) => update("frequency", event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field><Field label="First date"><Input type="date" value={form.nextDate} onChange={(event) => update("nextDate", event.target.value)} /></Field></div><Field label="Paid with"><Select value={form.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field><label className="check-row"><input type="checkbox" checked={form.autoPost} onChange={(event) => update("autoPost", event.target.checked)} /><span>Automatically post this expense when due</span></label></>}
        <Button kind="primary" disabled={number(form.amount) <= 0} onClick={save}><Icon name="save" />Save detail</Button>
      </div>
    </Modal>
  );
}

function SavingsView({ vault, persist, notify }) {
  const [direction, setDirection] = useState("to-savings");
  const [amount, setAmount] = useState("");
  const [goal, setGoal] = useState(vault.settings.savingsGoal || "");
  const progress = number(goal) ? (number(vault.settings.savingsBalance) / number(goal)) * 100 : 0;
  function transfer() {
    const value = number(amount);
    if (value <= 0) return;
    if (direction === "to-savings" && value > number(vault.settings.bankBalance)) { notify("The transfer is larger than the available bank balance."); return; }
    if (direction === "to-bank" && value > number(vault.settings.savingsBalance)) { notify("The transfer is larger than the savings balance."); return; }
    const toSavings = direction === "to-savings";
    const record = { id: uid("savings-transfer"), date: todayISO(), direction, amount: value, createdAt: new Date().toISOString() };
    persist({ ...vault, savingsTransfers: [record, ...vault.savingsTransfers], settings: { ...vault.settings, bankBalance: number(vault.settings.bankBalance) + (toSavings ? -value : value), savingsBalance: number(vault.settings.savingsBalance) + (toSavings ? value : -value) } });
    setAmount("");
    notify("Savings transfer recorded.");
  }
  return (
    <>
      <Card>
        <CardHeader label="Savings allocation" helper="A private bucket separate from available bank cash" />
        <div className="metric-grid"><div className="metric-tile"><div className="label">Available</div><div className="metric-value">{money(vault.settings.bankBalance, 0)}</div><div className="helper">bank</div></div><div className="metric-tile saved"><div className="label">Savings</div><div className="metric-value">{money(vault.settings.savingsBalance, 0)}</div><div className="helper">protected bucket</div></div><div className="metric-tile"><div className="label">Goal</div><div className="metric-value">{Math.round(progress)}%</div><div className="helper">funded</div></div></div>
        <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${Math.min(100, progress)}%` }} /></div>
      </Card>
      <Card>
        <CardHeader label="Move money" />
        <div className="form-stack"><Segmented columns={2} label="Transfer direction" value={direction} onChange={setDirection} options={[{ value: "to-savings", label: "Bank to savings" }, { value: "to-bank", label: "Savings to bank" }]} /><Field label="Amount"><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Button kind="primary" disabled={number(amount) <= 0} onClick={transfer}><Icon name="savings" />Transfer</Button></div>
      </Card>
      <Card>
        <CardHeader label="Savings goal" />
        <Field label="Target balance"><Input inputMode="decimal" value={goal} onChange={(event) => setGoal(event.target.value)} onBlur={() => persist({ ...vault, settings: { ...vault.settings, savingsGoal: number(goal) } })} /></Field>
        {vault.savingsTransfers.slice(0, 8).map((item) => <div className="row" key={item.id}><span>{item.date}<br /><span className="helper">{item.direction === "to-savings" ? "Added to savings" : "Moved back to bank"}</span></span><strong className={`money ${item.direction === "to-savings" ? "text-in" : "text-out"}`}>{item.direction === "to-savings" ? "+" : "-"}{money(item.amount)}</strong></div>)}
      </Card>
    </>
  );
}
