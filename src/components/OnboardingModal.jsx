import { useMemo, useState } from "react";
import { estimatePayroll, FREQUENCY_LABELS, PROVINCE_OPTIONS } from "../lib/finance.js";
import { money, number, todayISO, uid } from "../lib/format.js";
import { Button, Field, Icon, IconButton, Input, Modal, Select } from "./ui.jsx";

const STARTER_BUDGETS = ["Housing", "Groceries", "Dining", "Fuel", "Utilities", "Debt & EMI"];

export default function OnboardingModal({ vault, persist, notify, onFinish }) {
  const [step, setStep] = useState(0);
  const [balances, setBalances] = useState({ bank: "", savings: "" });
  const [salary, setSalary] = useState({ company: "", annualSalary: "", province: vault.settings.province || "ON", frequency: "biweekly", nextDate: todayISO(), savingsPercent: "" });
  const [cards, setCards] = useState([{ id: uid("setup-card"), bank: "", name: "Credit card", last4: "", statementDay: "", dueDay: "" }]);
  const [budgets, setBudgets] = useState(Object.fromEntries(STARTER_BUDGETS.map((category) => [category, ""])));
  const payroll = useMemo(() => estimatePayroll({ annualSalary: salary.annualSalary, province: salary.province, frequency: salary.frequency }), [salary]);
  const steps = ["Balances", "Income", "Cards", "Budgets", "Ready"];

  function updateSalary(key, value) {
    setSalary((current) => ({ ...current, [key]: value }));
  }

  function updateCard(id, key, value) {
    setCards((current) => current.map((card) => card.id === id ? { ...card, [key]: value } : card));
  }

  async function complete(nextTab = "board") {
    await persist((current) => {
      const incomeSources = [...current.incomeSources];
      if (number(salary.annualSalary) > 0) {
        const sourceId = uid("income-source");
        const effectiveDate = salary.nextDate || todayISO();
        incomeSources.unshift({
          id: sourceId,
          kind: "salary",
          owner: "me",
          name: salary.company.trim() || "My salary",
          company: salary.company.trim(),
          annualSalary: number(salary.annualSalary),
          province: salary.province,
          frequency: salary.frequency,
          amount: Math.round(payroll.netPay * 100) / 100,
          baseNetPay: Math.round(payroll.netPay * 100) / 100,
          benefitsPerPay: 0,
          rrspAnnual: 0,
          payAdjustments: [],
          nextDate: effectiveDate,
          savingsPercent: number(salary.savingsPercent),
          active: true,
          autoPost: true,
          salaryHistory: [{ id: uid("salary-rate"), effectiveDate, annualSalary: number(salary.annualSalary), amount: Math.round(payroll.netPay * 100) / 100, reason: "Initial setup" }],
          createdAt: new Date().toISOString(),
        });
      }
      const creditCards = [...current.creditCards];
      for (const card of cards.filter((item) => item.bank.trim())) {
        creditCards.unshift({
          id: uid("card"),
          bank: card.bank.trim(),
          name: card.name.trim() || "Credit card",
          last4: String(card.last4 || "").slice(-4),
          statementDay: Math.min(31, Math.max(1, number(card.statementDay) || 1)),
          dueDay: Math.min(31, Math.max(1, number(card.dueDay) || 21)),
          active: true,
          useLastAmountEstimate: false,
        });
      }
      return {
        ...current,
        settings: {
          ...current.settings,
          province: salary.province || current.settings.province,
          bankBalance: number(balances.bank),
          savingsBalance: number(balances.savings),
          balancesConfigured: true,
          onboardingComplete: true,
          onboardingVersion: 1,
        },
        incomeSources,
        creditCards,
        budgets: { ...current.budgets, ...Object.fromEntries(Object.entries(budgets).map(([category, value]) => [category, number(value)])) },
      };
    });
    notify("Private setup completed.");
    onFinish(nextTab);
  }

  function skip() {
    persist((current) => ({ ...current, settings: { ...current.settings, onboardingComplete: true, onboardingVersion: 1 } }));
    notify("Setup skipped. You can add these details from their tabs.");
    onFinish("add");
  }

  return (
    <Modal label={`First setup - ${step + 1} of ${steps.length}`} title={steps[step]} onClose={skip}>
      <div className="setup-progress" aria-label="Setup progress">{steps.map((label, index) => <i key={label} className={index <= step ? "complete" : ""} />)}</div>
      <div className="form-stack">
        {step === 0 && <>
          <div className="security-banner"><span className="icon-box"><Icon name="shield" /></span><div><strong>Starting balances</strong><div className="helper">These become the opening values for this encrypted profile.</div></div></div>
          <Field label="Available bank balance"><Input autoFocus inputMode="decimal" value={balances.bank} placeholder="0.00" onChange={(event) => setBalances((current) => ({ ...current, bank: event.target.value }))} /></Field>
          <Field label="Savings balance"><Input inputMode="decimal" value={balances.savings} placeholder="0.00" onChange={(event) => setBalances((current) => ({ ...current, savings: event.target.value }))} /></Field>
        </>}

        {step === 1 && <>
          <div className="security-banner"><span className="icon-box"><Icon name="banknote" /></span><div><strong>Primary salary</strong><div className="helper">Leave annual salary blank to add income later.</div></div></div>
          <Field label="Company"><Input value={salary.company} onChange={(event) => updateSalary("company", event.target.value)} /></Field>
          <div className="field-grid"><Field label="Annual salary"><Input autoFocus inputMode="decimal" value={salary.annualSalary} placeholder="0" onChange={(event) => updateSalary("annualSalary", event.target.value)} /></Field><Field label="Province"><Select value={salary.province} onChange={(event) => updateSalary("province", event.target.value)}>{PROVINCE_OPTIONS.map((item) => <option value={item.code} key={item.code}>{item.code}</option>)}</Select></Field></div>
          <div className="field-grid"><Field label="Frequency"><Select value={salary.frequency} onChange={(event) => updateSalary("frequency", event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></Select></Field><Field label="First expected deposit"><Input type="date" value={salary.nextDate} onChange={(event) => updateSalary("nextDate", event.target.value)} /></Field></div>
          <Field label="Savings split %"><Input inputMode="decimal" min="0" max="100" value={salary.savingsPercent} placeholder="0" onChange={(event) => updateSalary("savingsPercent", event.target.value)} /></Field>
          {number(salary.annualSalary) > 0 && <div className="balance-strip"><div><div className="label">Estimated net / pay</div><strong className="money">{money(payroll.netPay)}</strong></div><div><div className="label">Frequency</div><strong>{FREQUENCY_LABELS[salary.frequency]}</strong></div></div>}
        </>}

        {step === 2 && <>
          <div className="security-banner"><span className="icon-box"><Icon name="card" /></span><div><strong>Credit-card reminders</strong><div className="helper">Add up to three cards. Statement amounts can be scanned later.</div></div></div>
          {cards.map((card, index) => <div className="setup-card-row" key={card.id}>
            <div className="card-header no-margin"><div className="label">Card {index + 1}</div>{cards.length > 1 && <IconButton icon="trash" label="Remove card" className="danger" onClick={() => setCards((current) => current.filter((item) => item.id !== card.id))} />}</div>
            <div className="field-grid"><Field label="Bank"><Input value={card.bank} onChange={(event) => updateCard(card.id, "bank", event.target.value)} /></Field><Field label="Last 4"><Input inputMode="numeric" maxLength={4} value={card.last4} onChange={(event) => updateCard(card.id, "last4", event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field></div>
            <Field label="Card name"><Input value={card.name} onChange={(event) => updateCard(card.id, "name", event.target.value)} /></Field>
            <div className="field-grid"><Field label="Statement day"><Input inputMode="numeric" value={card.statementDay} placeholder="1" onChange={(event) => updateCard(card.id, "statementDay", event.target.value)} /></Field><Field label="Due day"><Input inputMode="numeric" value={card.dueDay} placeholder="21" onChange={(event) => updateCard(card.id, "dueDay", event.target.value)} /></Field></div>
          </div>)}
          {cards.length < 3 && <Button compact onClick={() => setCards((current) => [...current, { id: uid("setup-card"), bank: "", name: "Credit card", last4: "", statementDay: "", dueDay: "" }])}><Icon name="plus" />Add another card</Button>}
        </>}

        {step === 3 && <>
          <div className="security-banner"><span className="icon-box"><Icon name="budget" /></span><div><strong>Starter monthly budgets</strong><div className="helper">Detailed items can be added under each category later.</div></div></div>
          {STARTER_BUDGETS.map((category) => <Field label={category} key={category}><Input inputMode="decimal" value={budgets[category]} placeholder="0" onChange={(event) => setBudgets((current) => ({ ...current, [category]: event.target.value }))} /></Field>)}
        </>}

        {step === 4 && <>
          <div className="security-banner"><span className="icon-box"><Icon name="check" /></span><div><strong>Your private vault is ready</strong><div className="helper">Vehicle setup uses the bundled Canadian catalogue and can be completed next.</div></div></div>
          <div className="row"><span>Opening bank</span><strong className="money">{money(balances.bank)}</strong></div>
          <div className="row"><span>Opening savings</span><strong className="money">{money(balances.savings)}</strong></div>
          <div className="row"><span>Income</span><strong>{number(salary.annualSalary) > 0 ? `${salary.company || "Salary"} - ${money(payroll.netPay)}/pay` : "Add later"}</strong></div>
          <div className="row"><span>Cards</span><strong>{cards.filter((item) => item.bank.trim()).length}</strong></div>
        </>}

        <div className="button-row setup-actions">
          {step > 0 && <Button kind="ghost" onClick={() => setStep((value) => value - 1)}><Icon name="left" />Back</Button>}
          {step < steps.length - 1 && <Button kind="primary" onClick={() => setStep((value) => value + 1)}>Continue<Icon name="right" /></Button>}
          {step === steps.length - 1 && <><Button kind="primary" onClick={() => complete("board")}><Icon name="check" />Finish</Button><Button onClick={() => complete("fuel")}><Icon name="car" />Add vehicle next</Button></>}
        </div>
        {step === 0 && <Button kind="ghost" compact onClick={skip}>Skip setup</Button>}
      </div>
    </Modal>
  );
}
