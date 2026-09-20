<<<<<<< HEAD
import { useCallback, useEffect } from 'react';
import type { Challan, Dealer, Entry, Item, State } from '../domain';
import { deriveCode } from '../domain';
import { useStore } from '../store';
import { listDealers, type DealerResult } from './dealers';
import { listEntries, type EntryWithItems } from './entries';
import { getMastersBundle, type City } from './masters';
import { listChallans, type ChallanResult } from './returns';
import { dealerStatusLabel } from './session';

// The screens still render from the local store (memory.md §7), so what the server holds is
// pulled in and translated into that shape. Server records win over anything local with the
// same id; local drafts and unsent work are kept.

const ENTRY_TYPE: Record<EntryWithItems['entryType'], string> = { replacement: 'Replacement', sales_return: 'Sales Return', regular_sales: 'Regular Sales' };
const ENTRY_STATUS: Record<EntryWithItems['status'], Entry['status']> = { submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' };
export const RETURN_STAGE: Record<ChallanResult['lines'][number]['stage'], string> = { in_transit: 'In transit', received: 'Received', testing: 'Testing', repaired: 'Repaired', scrapped: 'Scrapped', closed: 'Closed' };
const FAULT_LABEL: Record<string, string> = { not_holding_charge: 'Not holding charge', low_backup: 'Low backup', swollen_case: 'Swollen case', leaking: 'Leaking', other: 'Other' };

export function toLocalDealer(d: DealerResult, cities: City[]): Dealer {
  return {
    id: d.id, name: d.name, contact: d.contactPerson, mobile: d.mobile,
    email: d.email || '', city: cities.find(c => c.id === d.cityId)?.name || d.cityId,
    place: d.place || '', address: d.address,
    pin: d.pin, state: d.state, status: dealerStatusLabel(d.status),
  };
}

export function toLocalEntry(e: EntryWithItems): Entry {
  const items: Item[] = e.items.map(it => ({
    id: it.id, model: it.modelId, code: it.batteryCode, ...deriveCode(it.batteryCode),
    oldSerial: it.oldBatteryCode || '', mfg: deriveCode(it.batteryCode).mfg, rpl: e.entryDate.slice(0, 7), rtn: '', wr: it.oldBatteryCode || '',
    remarks: it.remarks || '', fault: it.faultCode ? FAULT_LABEL[it.faultCode] || it.faultCode : undefined,
  }));
  return {
    id: e.ref, serverId: e.id, dealerId: e.dealerId, type: ENTRY_TYPE[e.entryType] || e.entryType, date: e.entryDate,
    customer: e.customerName || '', place: e.place, order: '', remarks: e.remarks || '', items,
    status: ENTRY_STATUS[e.status] || 'Submitted', evidence: [], gps: e.gps || undefined, signature: e.signature || undefined,
    createdAt: e.createdAt, retries: 0, coverTold: e.coverToldAt || undefined,
    decision: e.decisionReason ? { reason: e.decisionReason, at: e.decidedAt || e.updatedAt } : undefined,
  };
}

/** `refOf` turns the server's entry uuid into the app's entry id (the ENT- ref). */
export function toLocalChallan(c: ChallanResult, refOf: (entryId: string) => string): Challan {
  return {
    no: c.no, serverId: c.id, dealerId: c.dealerId, at: c.dispatchedAt, vehicle: c.vehicleNo || '', driver: c.driverName || '',
    receivedAt: c.receivedAt || undefined,
    entryIds: [...new Set(c.lines.map(l => refOf(l.entryId)))],
    rows: c.lines.map(l => ({ serial: l.batteryCode, model: l.modelId, ref: refOf(l.entryId), fault: l.faultCode ? FAULT_LABEL[l.faultCode] || l.faultCode : '—', lineId: l.id, stage: RETURN_STAGE[l.stage] })),
  };
}

/** Where each entry's old battery is, from its challan line (the furthest stage wins). */
export function returnStates(challans: Challan[]): Map<string, { state: string; note: string }> {
  const order = Object.values(RETURN_STAGE);
  const out = new Map<string, { state: string; note: string }>();
  for (const c of challans) for (const r of c.rows) {
    if (!r.stage) continue;
    const cur = out.get(r.ref);
    if (!cur || order.indexOf(r.stage) > order.indexOf(cur.state)) out.set(r.ref, { state: r.stage, note: `Challan ${c.no}${c.vehicle ? ` · ${c.vehicle}` : ''}` });
  }
  return out;
}

const KEEP_LOCAL: Entry['status'][] = ['Draft', 'Pending sync'];

/** Merges a page of server entries into local state. */
export function mergeEntries(s: State, fromServer: Entry[], replaceAll: boolean): State {
  const ids = new Set(fromServer.map(e => e.id));
  const local = new Map(s.entries.map(e => [e.id, e]));
  // Photos and the handover note only exist on the phone that captured them — keep those.
  const merged = fromServer.map(e => { const l = local.get(e.id); return l ? { ...e, evidence: l.evidence, evidenceTags: l.evidenceTags, handover: l.handover } : e; });
  const kept = s.entries.filter(e => !ids.has(e.id) && (!replaceAll || KEEP_LOCAL.includes(e.status)));
  return { ...s, entries: [...merged, ...kept], lastSync: new Date().toISOString() };
}

export function mergeDealers(s: State, fromServer: Dealer[]): State {
  const ids = new Set(fromServer.map(d => d.id));
  return { ...s, dealers: [...fromServer, ...s.dealers.filter(d => !ids.has(d.id))] };
}

/**
 * Pulls the caller's entries (and, for head office, every dealer) from the server into the
 * local store. Runs once on mount; call the returned function to refresh (after a decision,
 * on a pull-to-refresh). Errors are swallowed — a 401 already signs the app out via the client.
 */
export function useServerSync(token: string | null, scope: 'dealer' | 'admin') {
  const { setState } = useStore();
  const refresh = useCallback(async () => {
    if (!token) return;
    const [entriesPage, challanPage] = await Promise.all([listEntries({ limit: 200 }, token), listChallans({ limit: 200 }, token)]);
    const refOf = new Map(entriesPage.items.map(e => [e.id, e.ref]));
    const challans = challanPage.items.map(c => toLocalChallan(c, id => refOf.get(id) || id));
    const where = returnStates(challans);
    const fromServer = entriesPage.items.map(toLocalEntry).map(e => { const w = where.get(e.id); return w ? { ...e, returnState: w.state, returnNote: w.note } : e; });
    // Challans that never reached the server (made before this build) are dropped: the entries
    // come back as "to send back", so the dealer can dispatch them again for real.
    const withChallans = (s: State): State => ({ ...s, challans });
    if (scope === 'admin') {
      const [dealersPage, masters] = await Promise.all([listDealers({ limit: 200 }, token), getMastersBundle().catch(() => ({ cities: [] as City[] }))]);
      const dealers = dealersPage.items.map(d => toLocalDealer(d, masters.cities));
      // Head office sees the real register only — the demo entries would sit beside real ones otherwise.
      setState(s => withChallans(mergeEntries(mergeDealers(s, dealers), fromServer, true)));
    } else {
      setState(s => withChallans(mergeEntries(s, fromServer, false)));
    }
  }, [token, scope, setState]);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  return refresh;
=======
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useStore } from '../store';
import type { State } from '../domain';
import { fetchHydrated, type Hydrated } from './mapping';
import { getAccessToken, loadSession, useAccessToken } from './session';

// The hooks half of the bridge — the mapping itself is in mapping.ts (pure, testable in Node).
export { entryStatusOf, fetchHydrated, returnStageOf, toBattery, toDealer, toEntry, type Hydrated } from './mapping';

let inflight: Promise<Hydrated | null> | null = null;

/** Pull the backend into the store. Safe to call often — concurrent calls share one request. */
export async function syncStore(setState: (fn: (s: State) => State) => void): Promise<Hydrated | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const [session, token] = await Promise.all([loadSession(), getAccessToken()]);
    if (!session || !token) return null;
    const data = await fetchHydrated(session, token);
    setState((s) => ({ ...s, ...data }));
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** `sync()` for screens: re-hydrate after a write, report failures as a toast, never throw. */
export function useSync() {
  const { setState, notify } = useStore();
  const [syncing, setSyncing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const sync = useCallback(async (quiet = false) => {
    setSyncing(true);
    try {
      const r = await syncStore(setState);
      return r !== null;
    } catch {
      if (!quiet) notify('Could not refresh from the server. Showing the last data received.');
      return false;
    } finally {
      if (alive.current) setSyncing(false);
    }
  }, [setState, notify]);
  return { sync, syncing };
}

/** Keeps a signed-in app current: one sync at mount and one every time it returns to the foreground. */
export function useAutoSync(enabled: boolean) {
  const { sync } = useSync();
  useEffect(() => {
    if (!enabled) return;
    sync(true);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') sync(true); });
    return () => sub.remove();
  }, [enabled, sync]);
}

/**
 * Whether this session is a real sign-in (the store is the server's data). Screens use it to
 * refuse local-only edits that the server does not support yet — otherwise the next sync would
 * silently undo them.
 */
export function useLive(): boolean {
  return useAccessToken() !== null;
>>>>>>> b158bc606378210ac0bd3c76354a171dff52e481
}
