import { useState } from "react";
import { CATEGORIES, DRIVE_THROUGH_BUCKETS } from "../data/defaults.js";
import { expenseRefundStatus, ownerMatches, reconcileCardTransactions } from "../lib/finance.js";
import { blankDraft, parseAiResult, prepareDocument } from "../lib/importers.js";
import { analyzeDocument } from "../lib/openai.js";
import { copySplitExpense, saveSplitPdf, shareSplitExpense } from "../lib/share.js";
import { storeEncryptedDocument } from "../lib/vaultDb.js";
import { money, number, todayISO, uid } from "../lib/format.js";
import { Button, Card, CardHeader, Field, FileButton, Icon, IconButton, Input, Modal, Segmented, Select } from "../components/ui.jsx";

const ACCEPT = "image/*,application/pdf,.pdf";
const CAMERA_ACCEPT = "image/jpeg,image/png,image/heic,image/heif,image/*";

function decorateDraft(kind, value, fromAi = false) {
  if (kind === "payslip") {
    return {
      ...value,
      applyToIncome: true,
      nextDate: value.payDate || todayISO(),
      autoCalculateNet: !fromAi,
    };
  }
  if (kind === "receipt") {
    const uncertain = value.transactionType === "uncertain";
    return {
      ...value,
      transactionType: value.transactionType === "refund" ? "refund" : "expense",
      originalExpenseId: value.originalExpenseId || "",
      warnings: uncertain ? ["Confirm whether this is an expense or refund.", ...(value.warnings || [])] : (value.warnings || []),
      splitEnabled: !!value.splitEnabled,
      splitCount: Math.max(2, Math.round(number(value.splitCount) || 2)),
    };
  }
  return value;
}

function suggestedOriginalExpense(vault, draft, ownerScope) {
  if (draft.transactionType !== "refund") return "";
  const normalizedStore = String(draft.store || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = vault.expenses.filter((expense) => {
    const store = String(expense.store || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return ownerMatches(expense, ownerScope) && expense.date <= (draft.date || todayISO()) && expenseRefundStatus(vault, expense).remaining + 0.005 >= number(draft.total)
      && (!normalizedStore || store.includes(normalizedStore) || normalizedStore.includes(store));
  });
  return candidates.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.id || "";
}

function receiptMath(current, overrides = {}) {
  const next = { ...current, ...overrides };
  const itemSubtotal = (next.items || []).reduce((sum, item) => sum + number(item.lineTotal), 0);
  if (!next.manualSubtotal && (next.items || []).some((item) => number(item.lineTotal) !== 0)) next.subtotal = Math.round(itemSubtotal * 100) / 100;
  next.total = Math.max(0, Math.round((number(next.subtotal) + number(next.tax) + number(next.tip) - number(next.discount)) * 100) / 100);
  return next;
}

function payslipMath(current, overrides = {}) {
  const next = { ...current, ...overrides };
  if (!next.autoCalculateNet) return next;
  const adjustment = (next.deductions || []).reduce((sum, item) => sum + (item.direction === "in" ? number(item.amount) : -number(item.amount)), 0);
  next.netPay = Math.max(0, Math.round((number(next.grossPay) + adjustment) * 100) / 100);
  return next;
}

export default function AddTab({ vault, persist, notify, openModal, profileId, keyObject, currentOwner = "me", companion = false }) {
  const [mode, setMode] = useState("receipt");
  const [draft, setDraft] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function changeMode(value) {
    setMode(value);
    setDraft(null);
    setPrepared(null);
    setError("");
    setBusy("");
  }

  function startManual() {
    const next = blankDraft(mode);
    if (mode === "payslip") {
      const salary = vault.incomeSources.find((item) => item.kind === "salary");
      if (salary) {
        next.employer = salary.company || salary.name || "";
        next.owner = salary.owner || "me";
        next.frequency = salary.frequency || "biweekly";
        next.netPay = number(salary.amount) || "";
        next.payDate = todayISO();
      }
    }
    setPrepared(null);
    setDraft(decorateDraft(mode, next));
    setError("");
  }

  function startRefund() {
    setMode("receipt");
    setPrepared(null);
    setDraft(decorateDraft("receipt", { ...blankDraft("receipt"), transactionType: "refund" }));
    setError("");
  }

  async function loadFile(file) {
    setBusy("Preparing securely...");
    setError("");
    try {
      const document = await prepareDocument(file, mode);
      setPrepared(document);
      setDraft(decorateDraft(mode, document.draft));
      if (!vault.ai?.apiKey) {
        setError("The document is ready for manual review. Add an OpenAI API key in protected Settings to analyze documents automatically.");
        return;
      }
      setBusy("Reading with AI...");
      try {
        const result = await analyzeDocument({
          apiKey: vault.ai.apiKey,
          model: vault.ai.model,
          prepared: document,
          kind: mode,
        });
        const scanReferenceDate = todayISO(new Date(document.archiveFile?.lastModified || Date.now()));
        const parsed = decorateDraft(mode, parseAiResult(result.draft, mode, { referenceDate: scanReferenceDate }), true);
        if (mode === "receipt") parsed.originalExpenseId = suggestedOriginalExpense(vault, parsed, currentOwner === "partner" ? "partner" : "mine");
        setDraft(parsed);
        await persist((current) => ({
          ...current,
          ai: { ...current.ai, usage: [result.usage, ...(current.ai?.usage || [])].slice(0, 500) },
        }));
        notify("AI review is ready. Check the details before saving.");
      } catch (reason) {
        setError(`${reason.message || "AI analysis failed"} You can still review and enter the details manually.`);
      }
    } catch (reason) {
      if (reason?.name !== "AbortError") setError(reason.message || "This document could not be prepared.");
    } finally {
      setBusy("");
    }
  }

  function discard() {
    setDraft(null);
    setPrepared(null);
    setError("");
    setBusy("");
  }

  async function archiveDocument(recordId, date, kind) {
    if (!prepared?.archiveFile) return "";
    const metadata = await storeEncryptedDocument(profileId, keyObject, prepared.archiveFile, { recordId, date, kind });
    return metadata?.id || "";
  }

  async function saveReceipt() {
    const total = number(draft.total);
    if (!draft.store?.trim() || total <= 0) {
      setError("Add a store and total before saving.");
      return;
    }
    setBusy("Saving securely...");
    try {
      const id = uid(draft.transactionType === "refund" ? "refund" : "expense");
      const date = draft.date || todayISO();
      const originalBeforeArchive = draft.transactionType === "refund" ? vault.expenses.find((item) => item.id === draft.originalExpenseId) : null;
      if (originalBeforeArchive && total > expenseRefundStatus(vault, originalBeforeArchive).remaining + 0.005) throw new Error(`Only ${money(expenseRefundStatus(vault, originalBeforeArchive).remaining)} remains refundable for that purchase.`);
      const documentId = await archiveDocument(id, date, draft.transactionType === "refund" ? "refund" : "receipt");
      const splitCount = Math.max(2, Math.round(number(draft.splitCount) || 2));
      if (draft.transactionType === "refund") {
        const original = originalBeforeArchive;
        const refund = {
          id,
          originalExpenseId: original?.id || "",
          store: draft.store.trim(),
          date,
          effectiveDate: original?.date || date,
          category: original?.category || draft.category || "Other",
          amount: total,
          subtotal: number(draft.subtotal),
          tax: number(draft.tax),
          refundMethod: draft.paymentMethod || "bank",
          cardId: draft.paymentMethod === "credit" ? draft.cardId || original?.cardId || "" : "",
          items: (draft.items || []).filter((item) => item.name?.trim()).map((item) => ({ ...item, id: item.id || uid("item"), qty: number(item.qty) || 1, lineTotal: Math.abs(number(item.lineTotal)) })),
          owner: currentOwner,
          source: prepared ? "document" : "manual",
          sourceFileName: prepared?.fileName || "",
          documentId,
          originalReceiptNumber: draft.originalReceiptNumber || "",
          createdAt: new Date().toISOString(),
        };
        await persist((current) => ({
          ...current,
          refunds: [refund, ...(current.refunds || [])],
          settings: refund.refundMethod === "bank" ? { ...current.settings, bankBalance: number(current.settings.bankBalance) + total } : current.settings,
        }));
        discard();
        notify(`${money(total)} refund saved. It reduces spending and is not counted as income.`);
        return;
      }
      const expense = {
        id,
        store: draft.store.trim(),
        date,
        category: draft.category || "Other",
        subtotal: number(draft.subtotal),
        tax: number(draft.tax),
        tip: number(draft.tip),
        discount: number(draft.discount),
        total,
        paymentMethod: draft.paymentMethod || "bank",
        cardId: draft.paymentMethod === "credit" ? draft.cardId || "" : "",
        items: (draft.items || []).filter((item) => item.name?.trim()).map((item) => ({
          ...item,
          id: item.id || uid("item"),
          qty: number(item.qty) || 1,
          lineTotal: number(item.lineTotal),
        })),
        split: draft.splitEnabled ? {
          count: splitCount,
          expectedReimbursement: Math.round((total - total / splitCount) * 100) / 100,
        } : null,
        source: prepared ? "document" : "manual",
        sourceFileName: prepared?.fileName || "",
        documentId,
        owner: currentOwner,
        createdAt: new Date().toISOString(),
      };
      await persist((current) => {
        const next = { ...current, expenses: [expense, ...current.expenses] };
        if (expense.paymentMethod !== "credit") {
          next.settings = { ...next.settings, bankBalance: number(next.settings.bankBalance) - total };
        }
        if (expense.category === "Fuel" && number(draft.litres) > 0 && current.vehicles[0]) {
          next.fuelEntries = [{
            id: uid("fuel"),
            vehicleId: current.vehicles[0].id,
            date: expense.date,
            station: expense.store,
            odometer: number(draft.odometer),
            litres: number(draft.litres),
            cost: total,
            octane: draft.octane || "Regular",
            sourceExpenseId: expense.id,
          }, ...current.fuelEntries];
        }
        return next;
      });
      discard();
      notify("Saved to Ledger and included in Spent.");
      if (expense.split) {
        openModal({ content: <SplitShareModal expense={expense} notify={notify} onClose={() => openModal(null)} /> });
      }
    } catch (reason) {
      setError(reason.message || "The receipt could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function savePayslip() {
    if (!draft.employer?.trim() || number(draft.netPay) <= 0) {
      setError("Add the employer and net pay before saving.");
      return;
    }
    setBusy("Saving securely...");
    try {
      const id = uid("payslip");
      const payDate = draft.payDate || todayISO();
      const documentId = await archiveDocument(id, payDate, "payslip");
      const payslip = {
        ...draft,
        id,
        employer: draft.employer.trim(),
        payDate,
        grossPay: number(draft.grossPay),
        netPay: number(draft.netPay),
        ytdGross: number(draft.ytdGross),
        ytdNet: number(draft.ytdNet),
        deductions: (draft.deductions || []).filter((item) => item.name?.trim()).map((item) => ({
          ...item,
          id: item.id || uid("deduction"),
          amount: number(item.amount),
          ytd: number(item.ytd),
          direction: item.direction === "in" ? "in" : "out",
        })),
        sourceFileName: prepared?.fileName || "",
        documentId,
        createdAt: new Date().toISOString(),
      };
      delete payslip.autoCalculateNet;
      delete payslip.applyToIncome;
      delete payslip.nextDate;
      await persist((current) => {
        let incomeSources = current.incomeSources;
        let matching = current.incomeSources.find((source) => source.owner === (draft.owner || "me") && source.kind === "salary");
        if (draft.applyToIncome) {
          if (matching) {
            let salaryHistory = [...(matching.salaryHistory || [])];
            if (!salaryHistory.length) salaryHistory.push({ id: uid("salary-rate"), effectiveDate: matching.startDate || String(matching.createdAt || "").slice(0, 10) || "0000-01-01", reason: "Previous salary rate", amount: number(matching.amount), annualSalary: number(matching.annualSalary), province: matching.province, frequency: matching.frequency });
            const actualRate = { id: uid("salary-rate"), effectiveDate: payDate, reason: "Payslip actual", amount: payslip.netPay, annualSalary: number(matching.annualSalary), province: matching.province, frequency: draft.frequency || matching.frequency, benefitsPerPay: number(matching.benefitsPerPay), rrspAnnual: number(matching.rrspAnnual), payAdjustments: matching.payAdjustments || [] };
            salaryHistory = salaryHistory.some((item) => item.effectiveDate === payDate) ? salaryHistory.map((item) => item.effectiveDate === payDate ? { ...actualRate, id: item.id || actualRate.id } : item) : [...salaryHistory, actualRate];
            matching = {
              ...matching,
              name: payslip.employer,
              company: payslip.employer,
              amount: payslip.netPay,
              frequency: draft.frequency || matching.frequency,
              nextDate: draft.nextDate || matching.nextDate,
              salaryHistory,
            };
            incomeSources = current.incomeSources.map((source) => source.id === matching.id ? matching : source);
          } else {
            matching = {
              id: uid("income-source"),
              name: payslip.employer,
              company: payslip.employer,
              owner: draft.owner || "me",
              kind: "salary",
              amount: payslip.netPay,
              frequency: draft.frequency || "biweekly",
              nextDate: draft.nextDate || payDate,
              active: true,
              autoPost: true,
              savingsPercent: 0,
              salaryHistory: [{ id: uid("salary-rate"), effectiveDate: payDate, reason: "Payslip actual", amount: payslip.netPay, frequency: draft.frequency || "biweekly" }],
            };
            incomeSources = [matching, ...current.incomeSources];
          }
        }
        let incomeTransactions = current.incomeTransactions;
        let settings = current.settings;
        if (draft.applyToIncome && matching) {
          const existing = current.incomeTransactions.find((item) => item.sourceId === matching.id && item.date === payDate);
          const savings = Math.min(payslip.netPay, Math.max(0, payslip.netPay * number(matching.savingsPercent) / 100));
          const transaction = {
            ...(existing || {}),
            id: existing?.id || uid("income"),
            payslipId: payslip.id,
            sourceId: matching.id,
            name: payslip.employer,
            owner: draft.owner || "me",
            amount: payslip.netPay,
            savings,
            date: payDate,
            source: "payslip",
            createdAt: existing?.createdAt || new Date().toISOString(),
          };
          incomeTransactions = existing
            ? current.incomeTransactions.map((item) => item.id === existing.id ? transaction : item)
            : [transaction, ...current.incomeTransactions];
          settings = {
            ...current.settings,
            bankBalance: number(current.settings.bankBalance) + (payslip.netPay - savings) - (number(existing?.amount) - number(existing?.savings)),
            savingsBalance: number(current.settings.savingsBalance) + savings - number(existing?.savings),
          };
        }
        return {
          ...current,
          payslips: [payslip, ...current.payslips].slice(0, 48),
          incomeSources,
          incomeTransactions,
          settings,
        };
      });
      discard();
      notify("Payslip saved and the matching income actual was reconciled.");
    } catch (reason) {
      setError(reason.message || "The payslip could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function saveCardStatement() {
    if (!draft.bank?.trim() || !draft.dueDate || number(draft.statementBalance) < 0) {
      setError("Add the bank, due date, and statement balance before saving.");
      return;
    }
    setBusy("Saving securely...");
    try {
      const statementId = uid("statement");
      const statementDate = draft.statementDate || todayISO();
      const documentId = await archiveDocument(statementId, statementDate, "card");
      await persist((current) => {
        let card = current.creditCards.find((item) => draft.last4 && item.last4 === draft.last4 && String(item.bank || "").toLowerCase() === draft.bank.toLowerCase())
          || current.creditCards.find((item) => String(item.bank || "").toLowerCase() === draft.bank.toLowerCase() && String(item.name || "").toLowerCase() === String(draft.cardName || "").toLowerCase());
        let creditCards = current.creditCards;
        if (!card) {
          card = {
            id: uid("card"),
            bank: draft.bank.trim(),
            name: draft.cardName || "Credit card",
            last4: String(draft.last4 || "").slice(-4),
            statementDay: Number(String(statementDate).slice(8, 10)) || 1,
            dueDay: Number(String(draft.dueDate).slice(8, 10)) || 21,
            active: true,
            useLastAmountEstimate: false,
            owner: currentOwner,
          };
          creditCards = [card, ...creditCards];
        } else {
          creditCards = creditCards.map((item) => item.id === card.id ? {
            ...item,
            bank: draft.bank.trim(),
            name: draft.cardName || item.name,
            last4: String(draft.last4 || item.last4).slice(-4),
            statementDay: Number(String(statementDate).slice(8, 10)) || item.statementDay,
            dueDay: Number(String(draft.dueDate).slice(8, 10)) || item.dueDay,
            owner: item.owner || currentOwner,
          } : item);
        }
        const statement = {
          id: statementId,
          cardId: card.id,
          statementDate,
          dueDate: draft.dueDate,
          statementBalance: number(draft.statementBalance),
          minimumPayment: number(draft.minimumPayment),
          owner: currentOwner,
          transactions: reconcileCardTransactions(current, card.id, draft.transactions || []),
          sourceFileName: prepared?.fileName || "",
          documentId,
          createdAt: new Date().toISOString(),
        };
        return { ...current, creditCards, cardStatements: [statement, ...current.cardStatements] };
      });
      discard();
      notify("Statement saved. It is tracked separately from Spent.");
    } catch (reason) {
      setError(reason.message || "The statement could not be saved.");
    } finally {
      setBusy("");
    }
  }

  const copy = mode === "receipt"
    ? { label: "Add a bill", helper: "Camera, photo, or PDF. Review every item before saving." }
    : mode === "payslip"
      ? { label: "Add a payslip", helper: "Camera, screenshot, or PDF. Review pay and deductions." }
      : { label: "Add a card statement", helper: "Capture balance, generation date, and due date." };

  return (
    <>
      <Segmented columns={companion ? 2 : undefined} label="Document type" value={mode} onChange={changeMode} options={companion ? [
        { value: "receipt", label: "Receipt" },
        { value: "card", label: "Card bill" },
      ] : [
        { value: "receipt", label: "Receipt" },
        { value: "payslip", label: "Payslip" },
        { value: "card", label: "Card bill" },
      ]} />

      {!draft && (
        <Card>
          <CardHeader label={copy.label} helper={copy.helper} action={mode === "receipt" ? <Icon name="ai" /> : null} />
          <div className="button-row">
            <FileButton accept={CAMERA_ACCEPT} capture="environment" onFile={loadFile} kind="primary" disabled={!!busy}><Icon name="camera" />Camera</FileButton>
            <FileButton accept={ACCEPT} onFile={loadFile} disabled={!!busy}><Icon name="image" />Photo / PDF</FileButton>
          </div>
          {busy && <div className="upload-status" role="status">{busy}</div>}
          {error && <div className="error-text">{error}</div>}
        </Card>
      )}

      {draft && (
        <>
          {mode === "receipt" && <ReceiptReview draft={draft} setDraft={setDraft} cards={vault.creditCards} vault={vault} currentOwner={currentOwner} onSave={saveReceipt} onDiscard={discard} disabled={!!busy} />}
          {mode === "payslip" && <PayslipReview draft={draft} setDraft={setDraft} onSave={savePayslip} onDiscard={discard} disabled={!!busy} />}
          {mode === "card" && <CardReview draft={draft} setDraft={setDraft} onSave={saveCardStatement} onDiscard={discard} disabled={!!busy} />}
          {busy && <div className="upload-status" role="status">{busy}</div>}
          {error && <div className="error-text">{error}</div>}
        </>
      )}

      {!draft && (
        <Card>
          <CardHeader
            label="Manual entry"
            helper={mode === "receipt" ? "Cash, rent, recurring items, or anything unexpected" : mode === "payslip" ? "Enter payslip actuals without a document" : "Set up a card or statement without a document"}
            action={mode === "receipt" ? <span className="inline-actions"><IconButton icon="restore" label="Add refund manually" onClick={startRefund} /><Button kind="ghost" onClick={startManual}><Icon name="plus" />Add</Button></span> : <Button kind="ghost" onClick={startManual}><Icon name="plus" />Add</Button>}
            noMargin
          />
        </Card>
      )}

      {!draft && mode === "receipt" && <DriveThroughFavorites vault={vault} persist={persist} notify={notify} openModal={openModal} currentOwner={currentOwner} />}

      {!companion && <button className="fab" type="button" aria-label="Add money movement" title="Add money movement" onClick={() => openModal({ content: <QuickInflowModal vault={vault} persist={persist} notify={notify} onRefund={() => { openModal(null); startRefund(); }} onClose={() => openModal(null)} /> })}><Icon name="plus" size={20} strokeWidth={2.2} /></button>}
    </>
  );
}

function ReceiptReview({ draft, setDraft, cards, vault, currentOwner, onSave, onDiscard, disabled }) {
  const update = (key, value) => setDraft((current) => ["tax", "tip", "discount"].includes(key) ? receiptMath(current, { [key]: value }) : { ...current, [key]: value });
  const updateItem = (id, key, value) => setDraft((current) => receiptMath(current, { items: current.items.map((item) => item.id === id ? { ...item, [key]: value } : item), manualSubtotal: false }));
  const removeItem = (id) => setDraft((current) => receiptMath(current, { items: current.items.filter((item) => item.id !== id), manualSubtotal: false }));
  const splitCount = Math.max(2, Math.round(number(draft.splitCount) || 2));
  const ownerScope = currentOwner === "partner" ? "partner" : "mine";
  const refundable = vault.expenses.filter((expense) => ownerMatches(expense, ownerScope) && expense.date <= (draft.date || todayISO()) && expenseRefundStatus(vault, expense).remaining > 0.005).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  function chooseOriginal(value) {
    const expense = vault.expenses.find((item) => item.id === value);
    setDraft((current) => ({
      ...current,
      originalExpenseId: value,
      category: expense?.category || current.category,
      cardId: expense?.paymentMethod === "credit" ? expense.cardId || current.cardId : current.cardId,
      paymentMethod: expense?.paymentMethod === "credit" ? "credit" : current.paymentMethod,
    }));
  }
  return (
    <section className="receipt-paper">
      <Segmented columns={2} label="Transaction type" value={draft.transactionType || "expense"} onChange={(value) => setDraft((current) => ({ ...current, transactionType: value, splitEnabled: value === "refund" ? false : current.splitEnabled }))} options={[{ value: "expense", label: "Expense" }, { value: "refund", label: "Refund" }]} />
      <div className="receipt-head">
        <Input className="receipt-input" aria-label="Store" value={draft.store || ""} placeholder="Store name" onChange={(event) => update("store", event.target.value)} style={{ textAlign: "center", fontWeight: 700 }} />
        <div className="helper">Review before saving</div>
      </div>
      <div className="field-grid" style={{ marginBottom: 8 }}>
        <Field label="Date"><Input type="date" value={draft.date || todayISO()} onChange={(event) => update("date", event.target.value)} /></Field>
        <Field label="Category"><Select value={draft.category || "Other"} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field>
      </div>
      {draft.transactionType === "refund" && <Field label="Original purchase (optional)"><Select value={draft.originalExpenseId || ""} onChange={(event) => chooseOriginal(event.target.value)}><option value="">Not linked</option>{refundable.map((expense) => <option key={expense.id} value={expense.id}>{expense.date} - {expense.store} - {money(expenseRefundStatus(vault, expense).remaining)} available</option>)}</Select></Field>}
      {(draft.items || []).map((item) => (
        <div className="row" key={item.id}>
          <div>
            <Input className="receipt-input" value={item.name || ""} placeholder="Item" onChange={(event) => updateItem(item.id, "name", event.target.value)} />
            <div className="inline-actions">
              <Input className="receipt-input" inputMode="decimal" value={item.qty ?? 1} aria-label="Quantity" onChange={(event) => updateItem(item.id, "qty", event.target.value)} style={{ width: 48 }} />
              <Select className="receipt-input" value={item.unit || "ea"} aria-label="Unit" onChange={(event) => updateItem(item.id, "unit", event.target.value)} style={{ width: 64 }}>{["ea", "kg", "g", "lb", "L", "ml"].map((unit) => <option key={unit}>{unit}</option>)}</Select>
              <IconButton icon="trash" label="Remove item" className="danger" onClick={() => removeItem(item.id)} />
            </div>
          </div>
          <Input className="receipt-input receipt-amount" inputMode="decimal" value={item.lineTotal ?? ""} placeholder="0.00" aria-label="Line total" onChange={(event) => updateItem(item.id, "lineTotal", event.target.value)} />
        </div>
      ))}
      <Button kind="ghost" compact onClick={() => setDraft((current) => ({ ...current, items: [...(current.items || []), { id: uid("item"), name: "", qty: 1, unit: "ea", lineTotal: "" }] }))}><Icon name="plus" />Add item</Button>
      <div className="row"><span>Subtotal</span><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.subtotal ?? ""} onChange={(event) => setDraft((current) => receiptMath(current, { subtotal: event.target.value, manualSubtotal: true }))} /></div>
      <div className="row"><span>Tax</span><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.tax ?? ""} onChange={(event) => update("tax", event.target.value)} /></div>
      <div className="row"><span>Tip</span><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.tip ?? ""} onChange={(event) => update("tip", event.target.value)} /></div>
      <div className="row"><span>Discount</span><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.discount ?? ""} onChange={(event) => update("discount", event.target.value)} /></div>
      <div className="row"><strong>Total</strong><Input className="receipt-input receipt-amount" inputMode="decimal" value={draft.total ?? ""} onChange={(event) => update("total", event.target.value)} style={{ fontWeight: 700 }} /></div>
      <div className="field-grid" style={{ marginTop: 10 }}>
        <Field label={draft.transactionType === "refund" ? "Refunded to" : "Paid with"}><Select value={draft.paymentMethod || "bank"} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field>
        {draft.paymentMethod === "credit" ? <Field label="Card"><Select value={draft.cardId || ""} onChange={(event) => update("cardId", event.target.value)}><option value="">Unspecified</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field> : <div />}
      </div>
      {draft.transactionType !== "refund" && draft.category === "Fuel" && (
        <div className="form-stack" style={{ marginTop: 10 }}>
          <div className="field-grid"><Field label="Odometer"><Input inputMode="decimal" value={draft.odometer || ""} onChange={(event) => update("odometer", event.target.value)} /></Field><Field label="Litres"><Input inputMode="decimal" value={draft.litres || ""} onChange={(event) => update("litres", event.target.value)} /></Field></div>
          <Field label="Octane"><Select value={draft.octane || "Regular"} onChange={(event) => update("octane", event.target.value)}><option>Regular</option><option>Mid-grade</option><option>Premium</option><option>Diesel</option></Select></Field>
        </div>
      )}
      {draft.transactionType !== "refund" && <div className="split-card">
        <label className="check-row"><input type="checkbox" checked={!!draft.splitEnabled} onChange={(event) => update("splitEnabled", event.target.checked)} /><span>Split this bill</span></label>
        {draft.splitEnabled && (
          <div className="field-grid" style={{ marginTop: 10 }}>
            <Field label="People including you"><Input inputMode="numeric" value={draft.splitCount ?? 2} onChange={(event) => update("splitCount", event.target.value)} /></Field>
            <div className="split-summary"><span className="label">Your share</span><strong>{money(number(draft.total) / splitCount)}</strong><span className="helper">Collect {money(number(draft.total) - number(draft.total) / splitCount)}</span></div>
          </div>
        )}
      </div>}
      {!!draft.warnings?.length && <div className="notice-inline">{draft.warnings.join(" ")}</div>}
      <div className="button-row" style={{ marginTop: 12 }}><Button kind="primary" disabled={disabled} onClick={onSave}><Icon name="check" />{draft.transactionType === "refund" ? "Save refund" : "Save to ledger"}</Button><Button kind="ghost" disabled={disabled} onClick={onDiscard}>Discard</Button></div>
    </section>
  );
}

function PayslipReview({ draft, setDraft, onSave, onDiscard, disabled }) {
  const update = (key, value) => setDraft((current) => key === "grossPay" ? payslipMath(current, { [key]: value }) : { ...current, [key]: value });
  const updateDeduction = (id, key, value) => setDraft((current) => payslipMath(current, { deductions: current.deductions.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  const removeDeduction = (id) => setDraft((current) => payslipMath(current, { deductions: current.deductions.filter((item) => item.id !== id) }));
  return (
    <Card>
      <CardHeader label="Payslip review" helper="Assign the payslip before applying it to household income." />
      <div className="form-stack">
        <Field label="Employer"><Input value={draft.employer || ""} onChange={(event) => update("employer", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Belongs to"><Select value={draft.owner || "me"} onChange={(event) => update("owner", event.target.value)}><option value="me">My salary</option><option value="spouse">Spouse salary</option></Select></Field><Field label="Pay date"><Input type="date" value={draft.payDate || todayISO()} onChange={(event) => update("payDate", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Gross pay"><Input inputMode="decimal" value={draft.grossPay ?? ""} onChange={(event) => update("grossPay", event.target.value)} /></Field><Field label="Net pay"><Input inputMode="decimal" value={draft.netPay ?? ""} onChange={(event) => update("netPay", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Frequency"><Select value={draft.frequency || "biweekly"} onChange={(event) => update("frequency", event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="semimonthly">Semi-monthly</option><option value="monthly">Monthly</option></Select></Field><Field label="Next deposit"><Input type="date" value={draft.nextDate || draft.payDate || todayISO()} onChange={(event) => update("nextDate", event.target.value)} /></Field></div>
        {(draft.deductions || []).map((item) => (
          <div className="deduction-row" key={item.id}>
            <Field label="Description"><Input value={item.name || ""} onChange={(event) => updateDeduction(item.id, "name", event.target.value)} /></Field>
            <Field label="Direction"><Select value={item.direction || "out"} onChange={(event) => updateDeduction(item.id, "direction", event.target.value)}><option value="out">Out</option><option value="in">In</option></Select></Field>
            <Field label="This pay"><Input inputMode="decimal" value={item.amount ?? ""} onChange={(event) => updateDeduction(item.id, "amount", event.target.value)} /></Field>
            <IconButton icon="trash" label="Remove line" className="danger" onClick={() => removeDeduction(item.id)} />
          </div>
        ))}
        <Button kind="ghost" compact onClick={() => setDraft((current) => ({ ...current, deductions: [...(current.deductions || []), { id: uid("deduction"), name: "", amount: "", ytd: "", direction: "out" }] }))}><Icon name="plus" />Add pay line</Button>
        <label className="check-row"><input type="checkbox" checked={!!draft.autoCalculateNet} onChange={(event) => setDraft((current) => payslipMath({ ...current, autoCalculateNet: event.target.checked }))} /><span>Calculate net pay from gross and pay lines</span></label>
        <label className="check-row"><input type="checkbox" checked={draft.applyToIncome !== false} onChange={(event) => update("applyToIncome", event.target.checked)} /><span>Reconcile this actual with household income and bank balance</span></label>
        {!!draft.warnings?.length && <div className="notice-inline">{draft.warnings.join(" ")}</div>}
        <div className="button-row"><Button kind="primary" disabled={disabled} onClick={onSave}><Icon name="check" />Save payslip</Button><Button kind="ghost" disabled={disabled} onClick={onDiscard}>Discard</Button></div>
      </div>
    </Card>
  );
}

function CardReview({ draft, setDraft, onSave, onDiscard, disabled }) {
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateTransaction = (index, key, value) => setDraft((current) => ({ ...current, transactions: (current.transactions || []).map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  const removeTransaction = (index) => setDraft((current) => ({ ...current, transactions: (current.transactions || []).filter((_, itemIndex) => itemIndex !== index) }));
  return (
    <Card>
      <CardHeader label="Statement review" helper="Creates reminders and stays separate from monthly Spent." />
      <div className="form-stack">
        <div className="field-grid"><Field label="Bank"><Input value={draft.bank || ""} onChange={(event) => update("bank", event.target.value)} /></Field><Field label="Last 4"><Input inputMode="numeric" maxLength={4} value={draft.last4 || ""} onChange={(event) => update("last4", event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field></div>
        <Field label="Card name"><Input value={draft.cardName || ""} onChange={(event) => update("cardName", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Generated"><Input type="date" value={draft.statementDate || todayISO()} onChange={(event) => update("statementDate", event.target.value)} /></Field><Field label="Due date"><Input type="date" value={draft.dueDate || todayISO()} onChange={(event) => update("dueDate", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Statement balance"><Input inputMode="decimal" value={draft.statementBalance ?? ""} onChange={(event) => update("statementBalance", event.target.value)} /></Field><Field label="Minimum payment"><Input inputMode="decimal" value={draft.minimumPayment ?? ""} onChange={(event) => update("minimumPayment", event.target.value)} /></Field></div>
        <details className="settings-section"><summary><span><Icon name="ledger" />Statement transactions ({(draft.transactions || []).length})</span><Icon name="chevron-down" /></summary><div className="settings-section-body">
          {(draft.transactions || []).map((transaction, index) => <div className="statement-transaction-editor" key={transaction.id || `${transaction.date}-${index}`}><div className="field-grid"><Field label="Date"><Input type="date" value={transaction.date || ""} onChange={(event) => updateTransaction(index, "date", event.target.value)} /></Field><Field label="Type"><Select value={transaction.direction || "debit"} onChange={(event) => updateTransaction(index, "direction", event.target.value)}><option value="debit">Purchase</option><option value="credit">Refund / credit</option></Select></Field></div><Field label="Description"><Input value={transaction.description || ""} onChange={(event) => updateTransaction(index, "description", event.target.value)} /></Field><div className="inline-actions"><Field label="Amount"><Input inputMode="decimal" value={transaction.amount ?? ""} onChange={(event) => updateTransaction(index, "amount", event.target.value)} /></Field><IconButton icon="trash" label="Remove transaction" className="danger" onClick={() => removeTransaction(index)} /></div></div>)}
          <Button compact onClick={() => setDraft((current) => ({ ...current, transactions: [...(current.transactions || []), { id: uid("statement-transaction"), date: current.statementDate || todayISO(), description: "", amount: "", direction: "debit" }] }))}><Icon name="plus" />Add transaction</Button>
        </div></details>
        {!!draft.warnings?.length && <div className="notice-inline">{draft.warnings.join(" ")}</div>}
        <div className="button-row"><Button kind="primary" disabled={disabled} onClick={onSave}><Icon name="check" />Save statement</Button><Button kind="ghost" disabled={disabled} onClick={onDiscard}>Discard</Button></div>
      </div>
    </Card>
  );
}

function SplitShareModal({ expense, notify, onClose }) {
  async function share() {
    try {
      const result = await shareSplitExpense(expense);
      notify(result === "copied" ? "Split details copied." : "Share sheet opened.");
    } catch (reason) {
      if (reason?.name !== "AbortError") notify(reason.message || "The split could not be shared.");
    }
  }
  async function copy() {
    try {
      await copySplitExpense(expense);
      notify("Split details copied.");
    } catch {
      notify("Clipboard access is unavailable on this browser.");
    }
  }
  return (
    <Modal label="Bill split" title="Share with your group?" onClose={onClose}>
      <div className="split-preview">
        <strong>{expense.store}</strong>
        <span>{money(expense.total)} / {expense.split.count} people</span>
        <span className="helper">{money(number(expense.total) / expense.split.count)} each</span>
      </div>
      <div className="button-row" style={{ marginTop: 14 }}>
        <Button kind="primary" onClick={share}><Icon name="share" />Share</Button>
        <Button onClick={copy}><Icon name="copy" />Copy</Button>
        <Button onClick={() => { saveSplitPdf(expense); notify("Split PDF created."); }}><Icon name="download" />PDF</Button>
      </div>
    </Modal>
  );
}

function DriveThroughFavorites({ vault, persist, notify, openModal, currentOwner }) {
  const favorites = vault.quickFavorites || [];
  return (
    <Card>
      <CardHeader label="Drive-through favourites" helper="Fast capture without a receipt. Amount always starts blank." action={<Button compact onClick={() => openModal({ content: <FavoriteManager vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="edit" />Manage</Button>} />
      {favorites.length ? <div className="favorite-grid">{favorites.map((favorite) => (
        <button type="button" className="favorite-button" key={favorite.id} onClick={() => openModal({ content: <QuickSpendModal favorite={favorite} vault={vault} persist={persist} notify={notify} currentOwner={currentOwner} onClose={() => openModal(null)} /> })}>
          <span className="icon-box"><Icon name="coffee" /></span><span className="truncate"><strong>{favorite.name}</strong><span>{favorite.bucket}</span></span><Icon name="right" />
        </button>
      ))}</div> : <div className="helper">Add a favourite merchant to create a receiptless expense in a few taps.</div>}
    </Card>
  );
}

function QuickSpendModal({ favorite, vault, persist, notify, currentOwner, onClose }) {
  const [form, setForm] = useState({
    merchant: favorite.name || "",
    bucket: favorite.bucket || "Coffee",
    category: favorite.category || "Dining",
    amount: "",
    date: todayISO(),
    paymentMethod: favorite.paymentMethod || "credit",
    cardId: favorite.cardId || "",
    notes: "",
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function save() {
    const total = number(form.amount);
    if (!form.merchant.trim() || total <= 0) return;
    const expense = {
      id: uid("expense"),
      store: form.merchant.trim(),
      date: form.date,
      category: form.category || "Dining",
      subtotal: total,
      tax: 0,
      tip: 0,
      discount: 0,
      total,
      paymentMethod: form.paymentMethod,
      cardId: form.paymentMethod === "credit" ? form.cardId : "",
      owner: currentOwner,
      items: [{ id: uid("item"), name: form.bucket || "Drive-through", qty: 1, unit: "ea", lineTotal: total }],
      source: "quick-spend",
      notes: form.notes.trim(),
      needsDetails: !form.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    persist((current) => ({
      ...current,
      expenses: [expense, ...current.expenses],
      settings: expense.paymentMethod === "credit" ? current.settings : { ...current.settings, bankBalance: number(current.settings.bankBalance) - total },
    }));
    notify(`${money(total)} quick expense saved for ${expense.store}.`);
    onClose();
  }
  return (
    <Modal label="Receiptless expense" title={favorite.name || "Quick spend"} onClose={onClose}>
      <div className="form-stack">
        <div className="security-banner"><span className="icon-box"><Icon name="coffee" /></span><div><strong>{form.bucket}</strong><div className="helper">Saved with the current date. Add a note now or complete it later in Ledger.</div></div></div>
        <Field label="Merchant"><Input value={form.merchant} onChange={(event) => update("merchant", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Bucket"><Select value={form.bucket} onChange={(event) => update("bucket", event.target.value)}>{DRIVE_THROUGH_BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}</Select></Field><Field label="Amount"><Input autoFocus inputMode="decimal" value={form.amount} placeholder="0.00" onChange={(event) => update("amount", event.target.value)} /></Field></div>
        <div className="field-grid"><Field label="Date"><Input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></Field><Field label="Category"><Select value={form.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field></div>
        <div className="field-grid"><Field label="Paid with"><Select value={form.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field>{form.paymentMethod === "credit" ? <Field label="Card"><Select value={form.cardId} onChange={(event) => update("cardId", event.target.value)}><option value="">Unspecified</option>{vault.creditCards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field> : <div />}</div>
        <Field label="What did you buy? (optional)"><Input value={form.notes} placeholder="Coffee and breakfast" onChange={(event) => update("notes", event.target.value)} /></Field>
        <Button kind="primary" disabled={!form.merchant.trim() || number(form.amount) <= 0} onClick={save}><Icon name="check" />Save quick expense</Button>
      </div>
    </Modal>
  );
}

function FavoriteManager({ vault, persist, notify, onClose }) {
  const [items, setItems] = useState(vault.quickFavorites || []);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ name: "", bucket: "Coffee", category: "Dining", paymentMethod: "credit", cardId: "" });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function choose(item) {
    setSelectedId(item.id);
    setForm({ name: item.name || "", bucket: item.bucket || "Coffee", category: item.category || "Dining", paymentMethod: item.paymentMethod || "credit", cardId: item.cardId || "" });
  }
  function reset() {
    setSelectedId("");
    setForm({ name: "", bucket: "Coffee", category: "Dining", paymentMethod: "credit", cardId: "" });
  }
  function save() {
    if (!form.name.trim()) return;
    const item = { id: selectedId || uid("favorite"), ...form, name: form.name.trim(), cardId: form.paymentMethod === "credit" ? form.cardId : "" };
    const next = selectedId ? items.map((entry) => entry.id === selectedId ? item : entry) : [...items, item];
    setItems(next);
    persist((current) => ({ ...current, quickFavorites: next }));
    notify(selectedId ? "Favourite updated." : "Favourite added.");
    reset();
  }
  function remove() {
    if (!selectedId) return;
    const next = items.filter((entry) => entry.id !== selectedId);
    setItems(next);
    persist((current) => ({ ...current, quickFavorites: next }));
    notify("Favourite removed.");
    reset();
  }
  return (
    <Modal label="Quick capture" title="Drive-through favourites" onClose={onClose}>
      <div className="form-stack">
        {items.map((item) => <button className="profile-row" type="button" key={item.id} onClick={() => choose(item)} aria-pressed={selectedId === item.id}><span className="icon-box"><Icon name="coffee" /></span><span className="truncate"><strong>{item.name}</strong><br /><span className="helper">{item.bucket} - {item.category}</span></span><Icon name="edit" /></button>)}
        <Field label="Merchant"><Input value={form.name} placeholder="Tim Hortons" onChange={(event) => update("name", event.target.value)} /></Field>
        <div className="field-grid"><Field label="Broad bucket"><Select value={form.bucket} onChange={(event) => update("bucket", event.target.value)}>{DRIVE_THROUGH_BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}</Select></Field><Field label="Ledger category"><Select value={form.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field></div>
        <div className="field-grid"><Field label="Usual payment"><Select value={form.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field>{form.paymentMethod === "credit" ? <Field label="Usual card"><Select value={form.cardId} onChange={(event) => update("cardId", event.target.value)}><option value="">Ask each time</option>{vault.creditCards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field> : <div />}</div>
        <div className="button-row"><Button kind="primary" disabled={!form.name.trim()} onClick={save}><Icon name="save" />{selectedId ? "Update" : "Add favourite"}</Button>{selectedId && <Button kind="danger" onClick={remove}><Icon name="trash" />Delete</Button>}<Button kind="ghost" onClick={reset}>Clear</Button></div>
      </div>
    </Modal>
  );
}

function QuickInflowModal({ vault, persist, notify, onRefund, onClose }) {
  const outstanding = vault.expenses.map((expense) => {
    const expected = number(expense.split?.expectedReimbursement);
    const received = (vault.splitReimbursements || []).filter((item) => item.expenseId === expense.id).reduce((sum, item) => sum + number(item.amount), 0);
    return { expense, expected, received, remaining: Math.max(0, expected - received) };
  }).filter((item) => item.expected > 0 && item.remaining > 0.005);
  const [form, setForm] = useState({
    kind: vault.settings.balancesConfigured ? "extra" : "balance",
    name: "",
    amount: "",
    savings: "",
    date: todayISO(),
    expenseId: outstanding[0]?.expense.id || "",
  });
  const [error, setError] = useState("");
  const selected = outstanding.find((item) => item.expense.id === form.expenseId);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  function changeKind(value) {
    if (value === "refund") {
      onRefund?.();
      return;
    }
    setForm((current) => ({ ...current, kind: value, amount: value === "split" ? selected?.remaining || "" : "", savings: value === "split" ? "" : current.savings }));
    setError("");
  }

  function changeExpense(value) {
    const item = outstanding.find((entry) => entry.expense.id === value);
    setForm((current) => ({ ...current, expenseId: value, amount: item?.remaining || "" }));
  }

  function save() {
    const amount = number(form.amount);
    const savings = Math.max(0, Math.min(amount, number(form.savings)));
    if (form.kind === "split") {
      if (!selected || amount <= 0) {
        setError("Choose a split bill and enter the repayment received.");
        return;
      }
      if (amount > selected.remaining + 0.005) {
        setError(`Only ${money(selected.remaining)} remains to be repaid for this bill.`);
        return;
      }
      const repayment = {
        id: uid("split-repayment"),
        expenseId: selected.expense.id,
        person: form.name.trim() || "Bill split repayment",
        amount,
        date: form.date,
        owner: selected.expense.owner || "me",
        createdAt: new Date().toISOString(),
      };
      persist((current) => ({
        ...current,
        splitReimbursements: [repayment, ...(current.splitReimbursements || [])],
        settings: { ...current.settings, bankBalance: number(current.settings.bankBalance) + amount },
      }));
      notify(`${money(amount)} applied to ${selected.expense.store}.`);
      onClose();
      return;
    }
    if (amount < 0 || (form.kind !== "balance" && amount <= 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (form.kind === "balance") {
      if (savings > amount) {
        setError("Savings cannot be more than the total current balance.");
        return;
      }
      persist((current) => ({ ...current, settings: { ...current.settings, bankBalance: amount - savings, savingsBalance: savings, balancesConfigured: true } }));
      notify("Opening balances saved.");
    } else {
      const transaction = {
        id: uid("income"),
        name: form.name.trim() || (form.kind === "gift" ? "Gift" : "Additional income"),
        amount,
        savings,
        date: form.date,
        source: "manual",
        owner: "household",
        createdAt: new Date().toISOString(),
      };
      persist((current) => ({
        ...current,
        incomeTransactions: [transaction, ...current.incomeTransactions],
        settings: {
          ...current.settings,
          bankBalance: number(current.settings.bankBalance) + amount - savings,
          savingsBalance: number(current.settings.savingsBalance) + savings,
        },
      }));
      notify(`${money(amount)} added to inflow.`);
    }
    onClose();
  }

  return (
    <Modal label="Quick entry" title="Money movement" onClose={onClose}>
      <div className="form-stack">
        <Field label="Type"><Select value={form.kind} onChange={(event) => changeKind(event.target.value)}><option value="extra">Additional income</option><option value="gift">Gift</option><option value="split" disabled={!outstanding.length}>Bill split repayment</option><option value="refund">Refund</option><option value="balance">Opening balance</option></Select></Field>
        {form.kind === "split" && <Field label="Split bill"><Select value={form.expenseId} onChange={(event) => changeExpense(event.target.value)}>{outstanding.map((item) => <option key={item.expense.id} value={item.expense.id}>{item.expense.date} - {item.expense.store} - {money(item.remaining)} left</option>)}</Select></Field>}
        {form.kind !== "balance" && <Field label={form.kind === "split" ? "Paid by" : "Description"}><Input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder={form.kind === "split" ? "Name of person" : "What was this for?"} /></Field>}
        <div className="field-grid">
          <Field label={form.kind === "balance" ? "Total current balance" : "Amount received"}><Input inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} /></Field>
          {form.kind !== "split" && <Field label={form.kind === "balance" ? "Move to savings" : "Move to savings"}><Input inputMode="decimal" value={form.savings} onChange={(event) => update("savings", event.target.value)} /></Field>}
        </div>
        {form.kind !== "balance" && <Field label="Date"><Input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></Field>}
        {error && <div className="error-text">{error}</div>}
        <Button kind="primary" onClick={save}><Icon name="check" />Save</Button>
      </div>
    </Modal>
  );
}
