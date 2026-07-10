import { useState } from "react";
import { CATEGORIES } from "../data/defaults.js";
import { blankDraft, copyAiPrompt, parseAiResult, prepareDocument, readClipboardImage, shareForChatGPT } from "../lib/importers.js";
import { money, number, todayISO, uid } from "../lib/format.js";
import { Button, Card, CardHeader, Field, FileButton, Icon, IconButton, Input, Modal, Segmented, Select, Textarea } from "../components/ui.jsx";

const ACCEPT = "image/*,application/pdf,.pdf";

export default function AddTab({ vault, persist, notify, openModal }) {
  const [mode, setMode] = useState("receipt");
  const [draft, setDraft] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  function changeMode(value) {
    setMode(value);
    setDraft(null);
    setPrepared(null);
    setError("");
    setPasteOpen(false);
  }

  async function loadFile(file, shareImmediately = false) {
    setBusy(true);
    setError("");
    try {
      const document = await prepareDocument(file, mode);
      setPrepared(document);
      setDraft(mode === "payslip" ? { ...document.draft, applyToIncome: true, nextDate: document.draft.payDate || todayISO() } : document.draft);
      const reduction = document.originalBytes > document.preparedBytes
        ? ` Compressed ${Math.round((1 - document.preparedBytes / document.originalBytes) * 100)}%.`
        : "";
      notify(`${file.name} is ready for review.${reduction}`);
      if (shareImmediately) {
        const result = await shareForChatGPT(document);
        notify(result === "shared" ? "Shared with ChatGPT. Paste its JSON result when ready." : "AI prompt copied. Add the document in ChatGPT, then paste the JSON result.");
        setPasteOpen(true);
      }
    } catch (reason) {
      if (reason?.name !== "AbortError") setError(reason.message || "This document could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function pasteImage() {
    setBusy(true);
    setError("");
    try {
      const document = await readClipboardImage(mode);
      setPrepared(document);
      setDraft(mode === "payslip" ? { ...document.draft, applyToIncome: true, nextDate: document.draft.payDate || todayISO() } : document.draft);
      notify("Clipboard image is ready for review.");
    } catch (reason) {
      setError(reason.message || "Clipboard access is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function sharePrepared() {
    if (!prepared) return;
    try {
      const result = await shareForChatGPT(prepared);
      notify(result === "shared" ? "Shared. Return with the JSON result." : "Prompt copied to the clipboard.");
      setPasteOpen(true);
    } catch (reason) {
      if (reason?.name !== "AbortError") notify(reason.message || "The document could not be shared.");
    }
  }

  function loadAiResult() {
    try {
      setDraft(parseAiResult(pasteValue, mode));
      setPasteOpen(false);
      setError("");
      notify("AI result loaded for editing.");
    } catch (reason) {
      setError(reason.message);
    }
  }

  function discard() {
    setDraft(null);
    setPrepared(null);
    setError("");
    setPasteValue("");
  }

  function saveReceipt() {
    const total = number(draft.total);
    if (!draft.store?.trim() || total <= 0) {
      setError("Add a store and total before saving.");
      return;
    }
    const expense = {
      id: uid("expense"),
      store: draft.store.trim(),
      date: draft.date || todayISO(),
      category: draft.category || "Other",
      subtotal: number(draft.subtotal),
      tax: number(draft.tax),
      total,
      paymentMethod: draft.paymentMethod || "bank",
      cardId: draft.paymentMethod === "credit" ? draft.cardId || "" : "",
      items: (draft.items || []).filter((item) => item.name?.trim()).map((item) => ({ ...item, id: item.id || uid("item"), qty: number(item.qty) || 1, lineTotal: number(item.lineTotal) })),
      source: prepared ? "document" : "manual",
      sourceFileName: prepared?.fileName || "",
      createdAt: new Date().toISOString(),
    };
    persist((current) => {
      const next = { ...current, expenses: [expense, ...current.expenses] };
      if (expense.paymentMethod !== "credit") next.settings = { ...next.settings, bankBalance: number(next.settings.bankBalance) - total };
      if (expense.category === "Fuel" && number(draft.litres) > 0 && current.vehicles[0]) {
        next.fuelEntries = [{
          id: uid("fuel"), vehicleId: current.vehicles[0].id, date: expense.date, station: expense.store,
          odometer: number(draft.odometer), litres: number(draft.litres), cost: total,
          octane: draft.octane || "Regular", sourceExpenseId: expense.id,
        }, ...current.fuelEntries];
      }
      return next;
    });
    discard();
    notify("Saved to Ledger and included in Spent.");
  }

  function savePayslip() {
    if (!draft.employer?.trim() || number(draft.netPay) <= 0) {
      setError("Add the employer and net pay before saving.");
      return;
    }
    const payslip = {
      ...draft,
      id: uid("payslip"),
      employer: draft.employer.trim(),
      grossPay: number(draft.grossPay), netPay: number(draft.netPay), ytdGross: number(draft.ytdGross), ytdNet: number(draft.ytdNet),
      deductions: (draft.deductions || []).filter((item) => item.name?.trim()).map((item) => ({ ...item, id: item.id || uid("deduction"), amount: number(item.amount), ytd: number(item.ytd) })),
      sourceFileName: prepared?.fileName || "",
      createdAt: new Date().toISOString(),
    };
    persist((current) => {
      const matching = current.incomeSources.find((source) => source.owner === payslip.owner && source.kind === "salary");
      let incomeSources = current.incomeSources;
      if (draft.applyToIncome) {
        if (matching) incomeSources = current.incomeSources.map((source) => source.id === matching.id ? { ...source, name: payslip.employer, company: payslip.employer, amount: payslip.netPay, frequency: payslip.frequency, nextDate: draft.nextDate || source.nextDate } : source);
        else incomeSources = [{
          id: uid("income-source"), name: payslip.employer, company: payslip.employer, owner: payslip.owner || "me",
          kind: "salary", amount: payslip.netPay, frequency: payslip.frequency || "biweekly",
          nextDate: draft.nextDate || payslip.payDate || todayISO(), active: true, autoPost: true, savingsPercent: 0,
        }, ...current.incomeSources];
      }
      return { ...current, payslips: [payslip, ...current.payslips].slice(0, 48), incomeSources };
    });
    discard();
    notify("Payslip actuals saved to Income.");
  }

  function saveCardStatement() {
    if (!draft.bank?.trim() || !draft.dueDate || number(draft.statementBalance) < 0) {
      setError("Add the bank, due date, and statement balance before saving.");
      return;
    }
    persist((current) => {
      let card = current.creditCards.find((item) => draft.last4 && item.last4 === draft.last4)
        || current.creditCards.find((item) => String(item.bank || "").toLowerCase() === draft.bank.toLowerCase() && String(item.name || "").toLowerCase() === String(draft.cardName || "").toLowerCase());
      let creditCards = current.creditCards;
      if (!card) {
        card = {
          id: uid("card"), bank: draft.bank.trim(), name: draft.cardName || "Credit card", last4: String(draft.last4 || "").slice(-4),
          statementDay: Number(String(draft.statementDate || "").slice(8, 10)) || 1,
          dueDay: Number(String(draft.dueDate || "").slice(8, 10)) || 21,
          active: true, useLastAmountEstimate: false,
        };
        creditCards = [card, ...creditCards];
      } else {
        creditCards = creditCards.map((item) => item.id === card.id ? { ...item, bank: draft.bank.trim(), name: draft.cardName || item.name, last4: String(draft.last4 || item.last4).slice(-4), statementDay: Number(String(draft.statementDate).slice(8, 10)) || item.statementDay, dueDay: Number(String(draft.dueDate).slice(8, 10)) || item.dueDay } : item);
      }
      const statement = {
        id: uid("statement"), cardId: card.id, statementDate: draft.statementDate || todayISO(), dueDate: draft.dueDate,
        statementBalance: number(draft.statementBalance), minimumPayment: number(draft.minimumPayment),
        sourceFileName: prepared?.fileName || "", createdAt: new Date().toISOString(),
      };
      return { ...current, creditCards, cardStatements: [statement, ...current.cardStatements] };
    });
    discard();
    notify("Statement saved. It is separate from Spent.");
  }

  const copy = mode === "receipt"
    ? { label: "Add a bill", helper: "Scan, upload, or enter manually. Review every item before saving." }
    : mode === "payslip"
      ? { label: "Add a payslip", helper: "PDF, screenshot, or photo. Review actual pay and deductions." }
      : { label: "Add card statement", helper: "Capture card, balance, generation date, and due date." };

  return (
    <>
      <Segmented label="Document type" value={mode} onChange={changeMode} options={[{ value: "receipt", label: "Receipt" }, { value: "payslip", label: "Payslip" }, { value: "card", label: "Card bill" }]} />

      {!draft && (
        <Card>
          <CardHeader label={copy.label} helper={copy.helper} action={mode === "receipt" ? <Icon name="ai" /> : null} />
          <div className="button-row">
            <FileButton accept="image/*" capture="environment" onFile={(file) => loadFile(file)} kind="primary" disabled={busy}><Icon name="camera" />Camera</FileButton>
            <FileButton accept={ACCEPT} onFile={(file) => loadFile(file)} disabled={busy}><Icon name="image" />Photo / PDF</FileButton>
            {mode === "receipt" && <Button onClick={pasteImage} disabled={busy}><Icon name="clipboard" />Paste</Button>}
            <FileButton accept={ACCEPT} onFile={(file) => loadFile(file, true)} kind="ai" disabled={busy}><Icon name="ai" />AI read</FileButton>
          </div>
          <div className="upload-status">{busy ? "Preparing locally..." : "Files stay local unless you choose AI read and share them with ChatGPT."}</div>
          {error && <div className="error-text">{error}</div>}
        </Card>
      )}

      {draft && (
        <>
          <div className="button-row">
            {prepared && <Button kind="ai" onClick={sharePrepared}><Icon name="ai" />Send to ChatGPT</Button>}
            <Button kind="ghost" onClick={() => setPasteOpen((value) => !value)}><Icon name="clipboard" />Paste AI JSON</Button>
          </div>
          {mode === "receipt" && <ReceiptReview draft={draft} setDraft={setDraft} cards={vault.creditCards} onSave={saveReceipt} onDiscard={discard} />}
          {mode === "payslip" && <PayslipReview draft={draft} setDraft={setDraft} onSave={savePayslip} onDiscard={discard} />}
          {mode === "card" && <CardReview draft={draft} setDraft={setDraft} onSave={saveCardStatement} onDiscard={discard} />}
          {error && <div className="error-text">{error}</div>}
        </>
      )}

      {pasteOpen && (
        <Card>
          <CardHeader label="AI result" helper="Paste the JSON returned by ChatGPT." action={<Button kind="ghost" compact onClick={() => copyAiPrompt(mode).then(() => notify("Prompt copied."))}><Icon name="copy" />Copy prompt</Button>} />
          <Textarea value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder='{"store":"..."}' />
          <div className="button-row" style={{ marginTop: 8 }}><Button kind="primary" disabled={!pasteValue.trim()} onClick={loadAiResult}><Icon name="check" />Load for review</Button><Button kind="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button></div>
        </Card>
      )}

      {!draft && (
        <Card>
          <CardHeader label="Manual entry" helper={mode === "receipt" ? "Cash, rent, recurring items, or anything unexpected" : mode === "payslip" ? "Enter payslip actuals without a document" : "Set up a card or statement without a document"} action={<Button kind="ghost" onClick={() => setManualOpen((value) => !value)}><Icon name={manualOpen ? "x" : "plus"} />{manualOpen ? "Close" : "Add"}</Button>} noMargin={!manualOpen} />
          {manualOpen && <Button kind="primary" onClick={() => { setDraft({ ...blankDraft(mode), applyToIncome: mode === "payslip", nextDate: todayISO() }); setManualOpen(false); }}><Icon name="edit" />Open manual form</Button>}
        </Card>
      )}

      <button className="fab" type="button" aria-label="Add inflow or opening balance" title="Add inflow" onClick={() => openModal({ content: <QuickInflowModal vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="plus" size={20} strokeWidth={2.2} /></button>
    </>
  );
}

function ReceiptReview({ draft, setDraft, cards, onSave, onDiscard }) {
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateItem = (id, key, value) => setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  const removeItem = (id) => setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
  return (
    <section className="receipt-paper">
      <div className="receipt-head"><Input className="receipt-input" aria-label="Store" value={draft.store || ""} placeholder="Store name" onChange={(event) => update("store", event.target.value)} style={{ textAlign: "center", fontWeight: 700 }} /><div className="helper">Review before saving</div></div>
      <div className="field-grid" style={{ marginBottom: 8 }}>
        <Field label="Date"><Input type="date" value={draft.date || todayISO()} onChange={(event) => update("date", event.target.value)} /></Field>
        <Field label="Category"><Select value={draft.category || "Other"} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field>
      </div>
      {(draft.items || []).map((item) => (
        <div className="row" key={item.id}>
          <div><Input className="receipt-input" value={item.name || ""} placeholder="Item" onChange={(event) => updateItem(item.id, "name", event.target.value)} /><div className="inline-actions"><Input className="receipt-input" inputMode="decimal" value={item.qty ?? 1} aria-label="Quantity" onChange={(event) => updateItem(item.id, "qty", event.target.value)} style={{ width: 48 }} /><Select className="receipt-input" value={item.unit || "ea"} aria-label="Unit" onChange={(event) => updateItem(item.id, "unit", event.target.value)} style={{ width: 64 }}>{["ea", "kg", "g", "lb", "L", "ml"].map((unit) => <option key={unit}>{unit}</option>)}</Select><IconButton icon="trash" label="Remove item" className="danger" onClick={() => removeItem(item.id)} /></div></div>
          <Input className="receipt-input receipt-amount" inputMode="decimal" value={item.lineTotal ?? ""} placeholder="0.00" aria-label="Line total" onChange={(event) => updateItem(item.id, "lineTotal", event.target.value)} />
        </div>
      ))}
      <Button kind="ghost" compact onClick={() => setDraft((current) => ({ ...current, items: [...(current.items || []), { id: uid("item"), name: "", qty: 1, unit: "ea", lineTotal: "" }] }))}><Icon name="plus" />Add item</Button>
      <div className="row"><span>Subtotal</span><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.subtotal ?? ""} onChange={(event) => update("subtotal", event.target.value)} /></div>
      <div className="row"><span>Tax</span><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.tax ?? ""} onChange={(event) => update("tax", event.target.value)} /></div>
      <div className="row"><strong>Total</strong><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.total ?? ""} onChange={(event) => update("total", event.target.value)} style={{ fontWeight: 700 }} /></div>
      <div className="field-grid" style={{ marginTop: 10 }}>
        <Field label="Paid with"><Select value={draft.paymentMethod || "bank"} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field>
        {draft.paymentMethod === "credit" ? <Field label="Card"><Select value={draft.cardId || ""} onChange={(event) => update("cardId", event.target.value)}><option value="">Unspecified</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field> : <div />}
      </div>
      {draft.category === "Fuel" && <div className="form-stack" style={{ marginTop: 10 }}><div className="field-grid"><Field label="Odometer"><Input inputMode="decimal" value={draft.odometer || ""} onChange={(event) => update("odometer", event.target.value)} /></Field><Field label="Litres"><Input inputMode="decimal" value={draft.litres || ""} onChange={(event) => update("litres", event.target.value)} /></Field></div><Field label="Octane"><Select value={draft.octane || "Regular"} onChange={(event) => update("octane", event.target.value)}><option>Regular</option><option>Mid-grade</option><option>Premium</option><option>Diesel</option></Select></Field></div>}
      <div className="button-row" style={{ marginTop: 12 }}><Button kind="primary" onClick={onSave}><Icon name="check" />Save to ledger</Button><Button kind="ghost" onClick={onDiscard}>Discard</Button></div>
    </section>
  );
}

function PayslipReview({ draft, setDraft, onSave, onDiscard }) {
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateDeduction = (id, key, value) => setDraft((current) => ({ ...current, deductions: current.deductions.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  return (
    <Card>
      <CardHeader label="Payslip review" helper="Assign the payslip before applying it to household income." />
      <div className="form-stack">
        <Field label="Employer"><Input value={draft.employer || ""} onChange={(event) => update("employer", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Belongs to"><Select value={draft.owner || "me"} onChange={(event) => update("owner", event.target.value)}><option value="me">My salary</option><option value="spouse">Spouse salary</option></Select></Field><Field label="Pay date"><Input type="date" value={draft.payDate || todayISO()} onChange={(event) => update("payDate", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Gross pay"><Input inputMode="decimal" value={draft.grossPay ?? ""} onChange={(event) => update("grossPay", event.target.value)} /></Field><Field label="Net pay"><Input inputMode="decimal" value={draft.netPay ?? ""} onChange={(event) => update("netPay", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Frequency"><Select value={draft.frequency || "biweekly"} onChange={(event) => update("frequency", event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></Select></Field><Field label="Next deposit"><Input type="date" value={draft.nextDate || draft.payDate || todayISO()} onChange={(event) => update("nextDate", event.target.value)} /></Field></div>
        {(draft.deductions || []).map((item) => <div className="field-grid" key={item.id}><Field label="Deduction"><Input value={item.name || ""} onChange={(event) => updateDeduction(item.id, "name", event.target.value)} /></Field><Field label="This pay"><Input inputMode="decimal" value={item.amount ?? ""} onChange={(event) => updateDeduction(item.id, "amount", event.target.value)} /></Field></div>)}
        <Button kind="ghost" compact onClick={() => setDraft((current) => ({ ...current, deductions: [...(current.deductions || []), { id: uid("deduction"), name: "", amount: "", ytd: "" }] }))}><Icon name="plus" />Add deduction</Button>
        <label className="check-row"><input type="checkbox" checked={draft.applyToIncome !== false} onChange={(event) => update("applyToIncome", event.target.checked)} /><span>Use this net pay and frequency for the matching income schedule</span></label>
        <div className="button-row"><Button kind="primary" onClick={onSave}><Icon name="check" />Save payslip</Button><Button kind="ghost" onClick={onDiscard}>Discard</Button></div>
      </div>
    </Card>
  );
}

function CardReview({ draft, setDraft, onSave, onDiscard }) {
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Card>
      <CardHeader label="Statement review" helper="This creates a bill reminder and never duplicates monthly Spent." />
      <div className="form-stack">
        <div className="field-grid"><Field label="Bank"><Input value={draft.bank || ""} onChange={(event) => update("bank", event.target.value)} /></Field><Field label="Last 4"><Input inputMode="numeric" maxLength={4} value={draft.last4 || ""} onChange={(event) => update("last4", event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field></div>
        <Field label="Card name"><Input value={draft.cardName || ""} onChange={(event) => update("cardName", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Generated"><Input type="date" value={draft.statementDate || todayISO()} onChange={(event) => update("statementDate", event.target.value)} /></Field><Field label="Due date"><Input type="date" value={draft.dueDate || todayISO()} onChange={(event) => update("dueDate", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Statement balance"><Input inputMode="decimal" value={draft.statementBalance ?? ""} onChange={(event) => update("statementBalance", event.target.value)} /></Field><Field label="Minimum payment"><Input inputMode="decimal" value={draft.minimumPayment ?? ""} onChange={(event) => update("minimumPayment", event.target.value)} /></Field></div>
        <div className="button-row"><Button kind="primary" onClick={onSave}><Icon name="check" />Save statement</Button><Button kind="ghost" onClick={onDiscard}>Discard</Button></div>
      </div>
    </Card>
  );
}

function QuickInflowModal({ vault, persist, notify, onClose }) {
  const [form, setForm] = useState({ kind: vault.settings.balancesConfigured ? "extra" : "balance", name: "", amount: "", savings: "", date: todayISO() });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function save() {
    const amount = number(form.amount);
    const savings = Math.max(0, Math.min(amount, number(form.savings)));
    if (amount < 0 || (form.kind !== "balance" && amount <= 0)) return;
    if (form.kind === "balance") {
      persist({ ...vault, settings: { ...vault.settings, bankBalance: amount, savingsBalance: savings, balancesConfigured: true } });
      notify("Opening balances saved.");
    } else {
      const transaction = { id: uid("income"), name: form.name.trim() || "Additional income", amount, savings, date: form.date, source: "manual", owner: "household", createdAt: new Date().toISOString() };
      persist({ ...vault, incomeTransactions: [transaction, ...vault.incomeTransactions], settings: { ...vault.settings, bankBalance: number(vault.settings.bankBalance) + amount - savings, savingsBalance: number(vault.settings.savingsBalance) + savings } });
      notify(`${money(amount)} added to inflow.`);
    }
    onClose();
  }
  return (
    <Modal label="Quick inflow" title="Income or opening balance" onClose={onClose}>
      <div className="form-stack">
        <Field label="Type"><Select value={form.kind} onChange={(event) => update("kind", event.target.value)}><option value="extra">Additional income</option><option value="repayment">Friend repayment</option><option value="gift">Gift</option><option value="balance">Opening balances</option></Select></Field>
        {form.kind !== "balance" && <Field label="Description"><Input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="What was this for?" /></Field>}
        <div className="field-grid"><Field label={form.kind === "balance" ? "Available bank balance" : "Amount received"}><Input inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} /></Field><Field label={form.kind === "balance" ? "Savings balance" : "Move to savings"}><Input inputMode="decimal" value={form.savings} onChange={(event) => update("savings", event.target.value)} /></Field></div>
        {form.kind !== "balance" && <Field label="Date"><Input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></Field>}
        <Button kind="primary" onClick={save}><Icon name="check" />Save</Button>
      </div>
    </Modal>
  );
}
