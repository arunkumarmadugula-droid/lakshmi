import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVault } from "../src/data/defaults.js";
import {
  acceptHouseholdInvite,
  buildJointAccountUpdate,
  buildPartnerUpdate,
  enableHouseholdLink,
  householdInviteUrl,
  importPartnerUpdate,
  importJointAccountUpdate,
  markPartnerUpdateSent,
  pendingPartnerChanges,
  readHouseholdInvite,
  recordPartnerChanges,
} from "../src/lib/partnerSync.js";
import { jointAccountBalance } from "../src/lib/finance.js";

function linkedPair() {
  const primary = enableHouseholdLink(createEmptyVault("Primary"), "Asha");
  const companion = acceptHouseholdInvite(createEmptyVault("Asha"), {
    householdId: primary.householdLink.householdId,
    syncKey: primary.householdLink.syncKey,
    primaryName: "Primary",
    partnerName: "Asha",
  });
  return { primary, companion };
}

test("manual partner sends use checkpoints, import once, and continue from the prior send", async () => {
  let { primary, companion } = linkedPair();
  const firstDraft = structuredClone(companion);
  firstDraft.expenses.unshift({ id: "coffee", date: "2026-07-01", store: "Tim Hortons", category: "Dining", total: 4.5, paymentMethod: "credit" });
  companion = recordPartnerChanges(companion, firstDraft);
  assert.equal(pendingPartnerChanges(companion), 1);

  const first = await buildPartnerUpdate(companion);
  const firstImport = await importPartnerUpdate(primary, first.file);
  primary = firstImport.vault;
  assert.equal(firstImport.applied, 1);
  assert.equal(primary.expenses[0].owner, "partner");
  companion = markPartnerUpdateSent(companion, first.toSequence);
  assert.equal(pendingPartnerChanges(companion), 0);

  const secondDraft = structuredClone(companion);
  secondDraft.expenses.unshift({ id: "breakfast", date: "2026-07-04", store: "Cafe", category: "Dining", total: 12, paymentMethod: "bank" });
  companion = recordPartnerChanges(companion, secondDraft);
  const second = await buildPartnerUpdate(companion);
  assert.equal(second.count, 1);
  assert.equal(second.toSequence, first.toSequence + 1);

  const secondImport = await importPartnerUpdate(primary, second.file);
  primary = secondImport.vault;
  assert.equal(secondImport.applied, 1);
  assert.equal(primary.expenses.length, 2);
  const duplicate = await importPartnerUpdate(primary, second.file);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.vault.expenses.length, 2);
});

test("a missing incremental update is rejected and a full resync repairs the sequence", async () => {
  let { primary, companion } = linkedPair();
  const firstDraft = structuredClone(companion);
  firstDraft.expenses.push({ id: "one", date: "2026-07-01", store: "One", category: "Other", total: 1 });
  companion = recordPartnerChanges(companion, firstDraft);
  const missing = await buildPartnerUpdate(companion);
  companion = markPartnerUpdateSent(companion, missing.toSequence);

  const secondDraft = structuredClone(companion);
  secondDraft.expenses.push({ id: "two", date: "2026-07-02", store: "Two", category: "Other", total: 2 });
  companion = recordPartnerChanges(companion, secondDraft);
  const later = await buildPartnerUpdate(companion);
  await assert.rejects(() => importPartnerUpdate(primary, later.file), (error) => error.code === "SYNC_GAP");

  const full = await buildPartnerUpdate(companion, { full: true });
  const repaired = await importPartnerUpdate(primary, full.file);
  primary = repaired.vault;
  assert.equal(repaired.full, true);
  assert.deepEqual(primary.expenses.map((item) => item.id).sort(), ["one", "two"]);
});

test("partner cards, payments, and joint transfers synchronize without mixing the primary ledger", async () => {
  let { primary, companion } = linkedPair();
  const draft = structuredClone(companion);
  draft.creditCards.push({ id: "partner-card", bank: "Partner Bank", name: "Visa", last4: "4242", owner: "partner", dueDay: 21, active: true });
  draft.cardStatements.push({ id: "partner-statement", cardId: "partner-card", owner: "partner", statementDate: "2026-07-01", dueDate: "2026-07-21", statementBalance: 240, documentId: "local-only" });
  draft.cardPayments.push({ id: "partner-payment", cardId: "partner-card", statementId: "partner-statement", owner: "partner", date: "2026-07-15", amount: 240 });
  draft.jointAccount = { enabled: true, name: "Joint account", openingBalance: 0 };
  draft.jointTransfers.push({ id: "partner-joint", owner: "partner", direction: "to-joint", date: "2026-07-15", amount: 300 });
  companion = recordPartnerChanges(companion, draft);
  assert.equal(pendingPartnerChanges(companion), 4);
  const update = await buildPartnerUpdate(companion);
  const imported = await importPartnerUpdate(primary, update.file);
  primary = imported.vault;
  assert.equal(primary.creditCards[0].owner, "partner");
  assert.equal(primary.cardStatements[0].documentId, "");
  assert.equal(primary.cardPayments[0].owner, "partner");
  assert.equal(primary.jointAccount.enabled, true);
  assert.equal(jointAccountBalance(primary), 300);
});

test("primary shares only the reconciled joint account back to the companion", async () => {
  const pair = linkedPair();
  const primary = structuredClone(pair.primary);
  primary.jointAccount = { enabled: true, name: "Family chequing", openingBalance: 500 };
  primary.jointTransfers.push({ id: "primary-transfer", owner: "me", direction: "to-joint", date: "2026-07-10", amount: 250 });
  const file = await buildJointAccountUpdate(primary);
  const imported = await importJointAccountUpdate(pair.companion, file);
  assert.equal(imported.vault.jointAccount.name, "Family chequing");
  assert.equal(imported.vault.expenses.length, 0);
  assert.equal(jointAccountBalance(imported.vault), 750);
});

test("household invitations lock the companion to the primary country and currency", () => {
  const primary = enableHouseholdLink(createEmptyVault("India household", "IN"), "Asha");
  const invitationUrl = householdInviteUrl(primary.householdLink, "https://example.test/lakshmi/");
  const invitation = readHouseholdInvite(new URL(invitationUrl).hash);
  const companion = acceptHouseholdInvite(createEmptyVault("Asha", "CA"), invitation);
  assert.equal(invitation.country, "IN");
  assert.equal(companion.settings.country, "IN");
  assert.equal(companion.profile.currency, "INR");
  assert.equal(companion.profile.locale, "en-IN");
});
