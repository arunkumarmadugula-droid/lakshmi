import { REGIONS, normalizeCountry } from "../data/defaults.js";
import { todayISO } from "./format.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FORMAT = "lakshmi-partner-update";
const JOINT_FORMAT = "lakshmi-joint-account-update";
const VERSION = 1;
const ENTITIES = ["expenses", "refunds", "splitReimbursements", "creditCards", "cardStatements", "cardPayments", "jointTransfers"];

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(size = 24) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function encodeInvite(value) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeInvite(value) {
  return JSON.parse(decoder.decode(base64UrlToBytes(value)));
}

function syncAad(householdId, deviceId) {
  return encoder.encode(`${FORMAT}-v${VERSION}:${householdId}:${deviceId}`);
}

function jointSyncAad(householdId, deviceId) {
  return encoder.encode(`${JOINT_FORMAT}-v${VERSION}:${householdId}:${deviceId}`);
}

async function syncKey(rawKey, usages) {
  return crypto.subtle.importKey("raw", base64UrlToBytes(rawKey), { name: "AES-GCM" }, false, usages);
}

function comparable(record) {
  if (!record) return "";
  const { syncSequence, partnerSequence, updatedAt, ...stable } = record;
  return JSON.stringify(stable);
}

function withSyncDefaults(vault) {
  const next = structuredClone(vault);
  next.partnerSync ||= {};
  next.partnerSync.deviceId ||= randomToken(12);
  next.partnerSync.nextSequence = Math.max(1, Number(next.partnerSync.nextSequence) || 1);
  next.partnerSync.lastSentSequence = Math.max(0, Number(next.partnerSync.lastSentSequence) || 0);
  next.partnerSync.changeLog = Array.isArray(next.partnerSync.changeLog) ? next.partnerSync.changeLog : [];
  next.partnerSync.importedDevices = next.partnerSync.importedDevices && typeof next.partnerSync.importedDevices === "object" ? next.partnerSync.importedDevices : {};
  return next;
}

export function enableHouseholdLink(vault, partnerName = "Partner") {
  const next = withSyncDefaults(vault);
  next.householdLink = {
    ...(next.householdLink || {}),
    enabled: true,
    role: "primary",
    householdId: next.householdLink?.householdId || randomToken(16),
    syncKey: next.householdLink?.syncKey || randomToken(32),
    primaryName: next.profile?.name || next.householdLink?.primaryName || "Household",
    partnerName: String(partnerName || "Partner").trim() || "Partner",
    country: normalizeCountry(next.settings?.country),
    currency: next.profile?.currency || "CAD",
    locale: next.profile?.locale || "en-CA",
    linkedAt: next.householdLink?.linkedAt || new Date().toISOString(),
  };
  return next;
}

export function disableHouseholdLink(vault) {
  const next = structuredClone(vault);
  next.householdLink = {
    ...(next.householdLink || {}),
    enabled: false,
    householdId: "",
    syncKey: "",
    linkedAt: null,
  };
  next.partnerSync = { ...next.partnerSync, importedDevices: {}, changeLog: [], lastSentSequence: 0, nextSequence: 1 };
  return next;
}

export function householdInviteUrl(link, currentUrl = globalThis.location?.href || "") {
  if (!link?.enabled || !link.householdId || !link.syncKey) throw new Error("Enable household linking before creating an invitation.");
  const url = new URL(currentUrl);
  url.hash = `lakshmi-invite=${encodeInvite({
    format: "lakshmi-household-invite",
    version: VERSION,
    householdId: link.householdId,
    syncKey: link.syncKey,
    primaryName: link.primaryName || "Household",
    partnerName: link.partnerName || "Partner",
    country: normalizeCountry(link.country || (link.currency === "INR" ? "IN" : "CA")),
    currency: link.currency === "INR" ? "INR" : "CAD",
    locale: link.locale === "en-IN" ? "en-IN" : "en-CA",
  })}`;
  return url.toString();
}

export function readHouseholdInvite(currentHash = globalThis.location?.hash || "") {
  const match = String(currentHash).match(/^#lakshmi-invite=(.+)$/);
  if (!match) return null;
  try {
    const invite = decodeInvite(match[1]);
    if (invite?.format !== "lakshmi-household-invite" || invite.version !== VERSION || !invite.householdId || !invite.syncKey) return null;
    if (base64UrlToBytes(invite.syncKey).length !== 32) return null;
    return invite;
  } catch {
    return null;
  }
}

export function acceptHouseholdInvite(vault, invite) {
  if (!invite?.householdId || !invite?.syncKey) throw new Error("This household invitation is invalid.");
  const next = withSyncDefaults(vault);
  const country = normalizeCountry(invite.country || (invite.currency === "INR" ? "IN" : next.settings?.country));
  const region = REGIONS[country];
  next.profile = { ...next.profile, name: invite.partnerName || next.profile.name, currency: region.currency, locale: region.locale };
  next.householdLink = {
    enabled: true,
    role: "partner",
    householdId: invite.householdId,
    syncKey: invite.syncKey,
    primaryName: invite.primaryName || "Household",
    partnerName: invite.partnerName || next.profile.name || "Partner",
    country,
    currency: region.currency,
    locale: region.locale,
    linkedAt: new Date().toISOString(),
  };
  next.settings = { ...next.settings, country, onboardingComplete: true, onboardingVersion: 1 };
  return next;
}

export function recordPartnerChanges(previousVault, requestedVault) {
  if (requestedVault.householdLink?.role !== "partner" || !requestedVault.householdLink?.enabled) return requestedVault;
  const next = withSyncDefaults(requestedVault);
  const previous = withSyncDefaults(previousVault);
  let sequence = next.partnerSync.nextSequence;
  const operations = [];
  for (const entity of ENTITIES) {
    const before = new Map((previous[entity] || []).map((record) => [record.id, record]));
    const after = new Map((next[entity] || []).map((record) => [record.id, record]));
    next[entity] = (next[entity] || []).map((record) => {
      if (record.originDeviceId && record.originDeviceId !== next.partnerSync.deviceId) return record;
      const existing = before.get(record.id);
      if (existing && comparable(existing) === comparable(record)) return record;
      const changedAt = new Date().toISOString();
      const synced = { ...record, owner: "partner", originDeviceId: next.partnerSync.deviceId, syncSequence: sequence, updatedAt: changedAt };
      operations.push({ sequence, entity, action: "upsert", record: synced, changedAt });
      sequence += 1;
      return synced;
    });
    for (const [id, record] of before) {
      if (after.has(id)) continue;
      if (record.originDeviceId && record.originDeviceId !== next.partnerSync.deviceId) continue;
      const changedAt = new Date().toISOString();
      operations.push({ sequence, entity, action: "delete", id, changedAt, owner: record.owner || "partner" });
      sequence += 1;
    }
  }
  if (!operations.length) return next;
  next.partnerSync.nextSequence = sequence;
  next.partnerSync.changeLog = [...next.partnerSync.changeLog, ...operations].slice(-5000);
  return next;
}

export function pendingPartnerChanges(vault) {
  const sent = Number(vault.partnerSync?.lastSentSequence) || 0;
  return (vault.partnerSync?.changeLog || []).filter((operation) => Number(operation.sequence) > sent).length;
}

export async function buildPartnerUpdate(vault, { full = false } = {}) {
  const next = withSyncDefaults(vault);
  const link = next.householdLink;
  if (!link?.enabled || link.role !== "partner" || !link.householdId || !link.syncKey) throw new Error("This profile is not linked as a household companion.");
  const lastSent = Number(next.partnerSync.lastSentSequence) || 0;
  const toSequence = Math.max(lastSent, Number(next.partnerSync.nextSequence) - 1);
  const operations = next.partnerSync.changeLog.filter((operation) => Number(operation.sequence) > lastSent && Number(operation.sequence) <= toSequence);
  if (!full && !operations.length) throw new Error("There are no new partner updates to send.");
  const payload = full
    ? { full: true, records: Object.fromEntries(ENTITIES.map((entity) => [entity, (next[entity] || []).filter((record) => (record.originDeviceId || next.partnerSync.deviceId) === next.partnerSync.deviceId)])) }
    : { full: false, operations };
  const body = {
    version: VERSION,
    householdId: link.householdId,
    deviceId: next.partnerSync.deviceId,
    partnerName: link.partnerName || next.profile?.name || "Partner",
    fromSequence: full ? 1 : lastSent + 1,
    toSequence,
    exportedAt: new Date().toISOString(),
    ...payload,
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await syncKey(link.syncKey, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: syncAad(link.householdId, next.partnerSync.deviceId) }, key, encoder.encode(JSON.stringify(body))));
  const envelope = {
    format: FORMAT,
    version: VERSION,
    householdId: link.householdId,
    deviceId: next.partnerSync.deviceId,
    fromSequence: body.fromSequence,
    toSequence,
    full,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(encrypted),
  };
  const suffix = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const file = new File([JSON.stringify(envelope)], `lakshmi-partner-update-${suffix}.lakshmi-update`, { type: "application/vnd.lakshmi.partner-update+json" });
  return { file, toSequence, count: full ? ENTITIES.reduce((sum, entity) => sum + body.records[entity].length, 0) : operations.length, full };
}

export function markPartnerUpdateSent(vault, toSequence) {
  const next = structuredClone(vault);
  const sequence = Math.max(Number(next.partnerSync?.lastSentSequence) || 0, Number(toSequence) || 0);
  next.partnerSync = {
    ...next.partnerSync,
    lastSentSequence: sequence,
    lastSentAt: new Date().toISOString(),
    changeLog: (next.partnerSync?.changeLog || []).filter((operation) => Number(operation.sequence) > sequence),
  };
  return next;
}

function applyOperation(vault, operation, deviceId) {
  if (!ENTITIES.includes(operation.entity) || !["upsert", "delete"].includes(operation.action)) return false;
  const records = vault[operation.entity] || [];
  if (operation.action === "delete") {
    vault[operation.entity] = records.filter((record) => !(record.id === operation.id && record.originDeviceId === deviceId));
    return true;
  }
  if (!operation.record?.id) return false;
  const incoming = { ...operation.record, owner: "partner", originDeviceId: deviceId, partnerSequence: Number(operation.sequence) };
  if (incoming.documentId) {
    incoming.remoteDocumentName = incoming.sourceFileName || "Stored on partner device";
    incoming.documentId = "";
  }
  const index = records.findIndex((record) => record.id === incoming.id);
  if (index >= 0) {
    if (Number(records[index].partnerSequence) >= Number(operation.sequence)) return false;
    vault[operation.entity] = records.map((record, recordIndex) => recordIndex === index ? incoming : record);
  } else {
    vault[operation.entity] = [incoming, ...records];
  }
  return true;
}

export async function importPartnerUpdate(vault, file) {
  if (!file || Number(file.size) <= 0 || Number(file.size) > 8 * 1024 * 1024) throw new Error("Partner update files must be between 1 byte and 8 MB.");
  let envelope;
  try {
    envelope = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a readable Lakshmi partner update.");
  }
  const link = vault.householdLink;
  if (envelope?.format !== FORMAT || envelope.version !== VERSION || !envelope.ciphertext || !envelope.iv) throw new Error("That file is not a supported partner update.");
  if (!link?.enabled || link.role !== "primary" || envelope.householdId !== link.householdId) throw new Error("This update belongs to a different household link.");
  let payload;
  try {
    const key = await syncKey(link.syncKey, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(envelope.iv), additionalData: syncAad(link.householdId, envelope.deviceId) }, key, base64UrlToBytes(envelope.ciphertext));
    payload = JSON.parse(decoder.decode(decrypted));
  } catch {
    throw new Error("The partner update could not be decrypted or has been altered.");
  }
  if (payload.householdId !== link.householdId || payload.deviceId !== envelope.deviceId) throw new Error("The partner update identity does not match its encrypted contents.");
  const next = withSyncDefaults(vault);
  const imported = next.partnerSync.importedDevices[payload.deviceId] || { lastSequence: 0 };
  const previousSequence = Number(imported.lastSequence) || 0;
  if (!payload.full && Number(payload.fromSequence) > previousSequence + 1) {
    const error = new Error(`An earlier partner update is missing. Ask ${payload.partnerName || "your partner"} to send a Full resync.`);
    error.code = "SYNC_GAP";
    throw error;
  }
  let applied = 0;
  if (payload.full) {
    for (const entity of ENTITIES) {
      const ownRecords = (next[entity] || []).filter((record) => record.originDeviceId !== payload.deviceId);
      const partnerRecords = (payload.records?.[entity] || []).map((record) => {
        const incoming = { ...record, owner: "partner", originDeviceId: payload.deviceId, partnerSequence: Number(payload.toSequence) || 0 };
        if (incoming.documentId) {
          incoming.remoteDocumentName = incoming.sourceFileName || "Stored on partner device";
          incoming.documentId = "";
        }
        return incoming;
      });
      next[entity] = [...partnerRecords, ...ownRecords];
      applied += partnerRecords.length;
    }
  } else {
    for (const operation of (payload.operations || []).sort((a, b) => Number(a.sequence) - Number(b.sequence))) {
      if (Number(operation.sequence) <= previousSequence) continue;
      if (applyOperation(next, operation, payload.deviceId)) applied += 1;
    }
  }
  const lastSequence = Math.max(previousSequence, Number(payload.toSequence) || 0);
  next.partnerSync.importedDevices[payload.deviceId] = {
    deviceId: payload.deviceId,
    partnerName: payload.partnerName || link.partnerName || "Partner",
    lastSequence,
    lastImportedAt: new Date().toISOString(),
    lastFileDate: payload.exportedAt || null,
  };
  if ((next.jointTransfers || []).length && !next.jointAccount?.enabled) next.jointAccount = { ...(next.jointAccount || {}), enabled: true, name: next.jointAccount?.name || "Joint account", openingBalance: Number(next.jointAccount?.openingBalance) || 0, createdAt: next.jointAccount?.createdAt || new Date().toISOString() };
  next.householdLink = { ...next.householdLink, partnerName: payload.partnerName || next.householdLink.partnerName || "Partner" };
  return { vault: next, applied, duplicate: !applied && Number(payload.toSequence) <= previousSequence, full: !!payload.full, lastSequence, partnerName: payload.partnerName || "Partner" };
}

export async function buildJointAccountUpdate(vault) {
  const next = withSyncDefaults(vault);
  const link = next.householdLink;
  if (!link?.enabled || link.role !== "primary" || !link.householdId || !link.syncKey) throw new Error("Enable the linked household before sharing the joint account.");
  const body = {
    version: VERSION,
    householdId: link.householdId,
    deviceId: next.partnerSync.deviceId,
    exportedAt: new Date().toISOString(),
    jointAccount: next.jointAccount || { enabled: false, name: "Joint account", openingBalance: 0 },
    jointTransfers: (next.jointTransfers || []).map((record) => ({ ...record, originDeviceId: record.originDeviceId || next.partnerSync.deviceId })),
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await syncKey(link.syncKey, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: jointSyncAad(link.householdId, next.partnerSync.deviceId) }, key, encoder.encode(JSON.stringify(body))));
  const envelope = {
    format: JOINT_FORMAT,
    version: VERSION,
    householdId: link.householdId,
    deviceId: next.partnerSync.deviceId,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(encrypted),
  };
  const suffix = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return new File([JSON.stringify(envelope)], `lakshmi-joint-account-${suffix}.lakshmi-joint`, { type: "application/vnd.lakshmi.joint-account+json" });
}

export async function importJointAccountUpdate(vault, file) {
  if (!file || Number(file.size) <= 0 || Number(file.size) > 2 * 1024 * 1024) throw new Error("Joint-account update files must be between 1 byte and 2 MB.");
  let envelope;
  try {
    envelope = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a readable Lakshmi joint-account update.");
  }
  const link = vault.householdLink;
  if (envelope?.format !== JOINT_FORMAT || envelope.version !== VERSION || !envelope.ciphertext || !envelope.iv) throw new Error("That file is not a supported joint-account update.");
  if (!link?.enabled || link.role !== "partner" || envelope.householdId !== link.householdId) throw new Error("This joint-account update belongs to a different household link.");
  let payload;
  try {
    const key = await syncKey(link.syncKey, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(envelope.iv), additionalData: jointSyncAad(link.householdId, envelope.deviceId) }, key, base64UrlToBytes(envelope.ciphertext));
    payload = JSON.parse(decoder.decode(decrypted));
  } catch {
    throw new Error("The joint-account update could not be decrypted or has been altered.");
  }
  if (payload.householdId !== link.householdId || payload.deviceId !== envelope.deviceId) throw new Error("The joint-account update identity does not match its encrypted contents.");
  const next = withSyncDefaults(vault);
  const incoming = Array.isArray(payload.jointTransfers) ? payload.jointTransfers : [];
  const incomingIds = new Set(incoming.map((record) => record.id));
  const lastSent = Number(next.partnerSync.lastSentSequence) || 0;
  const pendingLocal = (next.jointTransfers || []).filter((record) => record.originDeviceId === next.partnerSync.deviceId && Number(record.syncSequence) > lastSent && !incomingIds.has(record.id));
  next.jointAccount = { ...(next.jointAccount || {}), ...(payload.jointAccount || {}) };
  next.jointTransfers = [...incoming, ...pendingLocal].sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)));
  next.partnerSync.lastJointImportedAt = new Date().toISOString();
  return { vault: next, transfers: incoming.length, pendingLocal: pendingLocal.length };
}

export function partnerUpdateSummary(vault) {
  const devices = Object.values(vault.partnerSync?.importedDevices || {});
  return {
    devices,
    latest: devices.sort((a, b) => String(b.lastImportedAt).localeCompare(String(a.lastImportedAt)))[0] || null,
    pending: pendingPartnerChanges(vault),
    lastSentAt: vault.partnerSync?.lastSentAt || null,
    today: todayISO(),
  };
}
