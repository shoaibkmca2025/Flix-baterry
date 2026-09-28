import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useStore } from '@felix/shared/store';
import { getAccessToken } from '@felix/shared/api/session';
import { createPlant, deletePlant, listPlants, updatePlant, type PlantDetails, type PlantInfo } from '@felix/shared/api/masters';
import { errorMessage } from '@felix/shared/api/client';
import type { Plant } from '@felix/shared/domain';
import { T } from '@felix/shared/ui/theme';
import { X, B, Btn, Card, CardH, Chip, Field, Banner, KV } from '@felix/shared/ui/kit';
import { Dialog, ToggleRow, useA } from './ui';

type Draft = { name: string; active: boolean; location: string; contactName: string; contactPhone: string; notes: string; was?: Plant };
const DETAILS = ['location', 'contactName', 'contactPhone', 'notes'] as const;
const count = (n: number) => `${n} ${n === 1 ? 'battery' : 'batteries'}`;

/**
 * Head office's plants (memory.md D-19): add, edit the name and details, switch off, and delete one
 * that no battery is counted under. The public masters bundle carries names only, so the details
 * come from the admin-only GET /masters/plants and live here — the regular sync never wipes them.
 * One hook, used by the Plants tab and by "Batteries by plant", so both behave the same.
 */
export function usePlantManager() {
  const a = useA(); const { state, setState, canEdit } = useStore();
  const [info, setInfo] = useState<Record<string, PlantInfo>>({});
  const [draft, setDraft] = useState<Draft | null>(null), [doomed, setDoomed] = useState<Plant | null>(null);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken(); if (!token) return;
    try { setInfo(Object.fromEntries((await listPlants(token)).map(p => [p.id, p]))); }
    catch { /* the details are extra — the names still show from the sync */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Batteries counted under a plant, as far as this console has loaded them (the server has the final say). */
  const used = (id: string) => state.challans.reduce((t, c) => t + c.rows.filter(r => r.plantId === id).length, 0);
  const token = async () => { const t = await getAccessToken(); if (!t) setErr('Plants are kept on the server. Sign in to change them.'); return t; };
  const keep = (saved: PlantInfo, isNew: boolean) => {
    const plant: Plant = { id: saved.id, name: saved.name, active: saved.active };
    setState(s => ({ ...s, plants: isNew ? [...(s.plants ?? []), plant] : (s.plants ?? []).map(x => x.id === plant.id ? plant : x) }));
    setInfo(m => ({ ...m, [saved.id]: saved }));
    return plant;
  };

  const add = () => { setErr(''); setDraft({ name: '', active: true, location: '', contactName: '', contactPhone: '', notes: '' }); };
  const edit = (p: Plant) => {
    const d = info[p.id]; setErr('');
    setDraft({ name: p.name, active: p.active, location: d?.location ?? '', contactName: d?.contactName ?? '', contactPhone: d?.contactPhone ?? '', notes: d?.notes ?? '', was: p });
  };
  const remove = (p: Plant) => { setErr(''); setDoomed(p); };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim(), was = draft.was, before = was ? info[was.id] : undefined;
    if (name.length < 2) { setErr('Enter the plant name.'); return; }
    const details: Required<PlantDetails> = { location: draft.location.trim(), contactName: draft.contactName.trim(), contactPhone: draft.contactPhone.trim(), notes: draft.notes.trim() };
    // an edit sends only what changed; an emptied detail goes as '' and the server clears it
    const change: { name?: string; active?: boolean } & PlantDetails = {};
    if (was) {
      if (name !== was.name) change.name = name;
      if (draft.active !== was.active) change.active = draft.active;
      for (const k of DETAILS) if (details[k] !== (before?.[k] ?? '')) change[k] = details[k];
      if (!Object.keys(change).length) { setDraft(null); return; }
    }
    const t = await token(); if (!t) return;
    setBusy(true);
    try {
      const filled = Object.fromEntries(Object.entries(details).filter(([, v]) => v)) as PlantDetails;
      const plant = keep(was ? await updatePlant(was.id, change, t) : await createPlant({ name, ...filled }, t), !was);
      setDraft(null);
      a.toast(!was ? `${plant.name} added. It is in the arrival form now.`
        : 'active' in change ? (plant.active ? `${plant.name} is switched back on.` : `${plant.name} is switched off. Batteries already under it keep its name.`)
        : `${plant.name} saved.`);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const switchOff = async () => {
    if (!doomed) return;
    const t = await token(); if (!t) return;
    setBusy(true);
    try { const plant = keep(await updatePlant(doomed.id, { active: false }, t), false); setDoomed(null); a.toast(`${plant.name} is switched off. Batteries already under it keep its name.`); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!doomed) return;
    const t = await token(); if (!t) return;
    setBusy(true);
    try {
      await deletePlant(doomed.id, t);
      setState(s => ({ ...s, plants: (s.plants ?? []).filter(x => x.id !== doomed.id) }));
      setInfo(m => { const next = { ...m }; delete next[doomed.id]; return next; });
      a.toast(`${doomed.name} deleted.`); setDoomed(null);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const inUse = doomed ? used(doomed.id) : 0;
  const dialogs = <>
    <Dialog open={!!draft} title={draft?.was ? `Edit ${draft.was.name}` : 'Add a plant'} sub="Name, where it is, and who to call there" onClose={() => setDraft(null)} width={500}>{draft && <>
      <Field label="Plant name" req value={draft.name} onChange={name => { setDraft({ ...draft, name }); setErr(''); }} ph="e.g. Sinnar plant" autoFocus />
      <Field label="Location" value={draft.location} onChange={location => { setDraft({ ...draft, location }); setErr(''); }} ph="e.g. MIDC Sinnar, Nashik" />
      <Field label="Contact person" value={draft.contactName} onChange={contactName => { setDraft({ ...draft, contactName }); setErr(''); }} ph="Who to call at the plant" />
      <Field label="Phone" phone value={draft.contactPhone} onChange={contactPhone => { setDraft({ ...draft, contactPhone }); setErr(''); }} ph="e.g. 98220 12345" />
      <Field label="Notes" multiline value={draft.notes} onChange={notes => { setDraft({ ...draft, notes }); setErr(''); }} ph="Anything head office should know about this plant" />
      {draft.was ? <Card style={{ paddingVertical: 0, marginBottom: 13 }}><ToggleRow last label="Offer it in the arrival form" sub="Switch off a plant that no longer makes batteries" value={draft.active} onChange={active => { setDraft({ ...draft, active }); setErr(''); }} /></Card> : null}
      {err ? <Banner tone="bad" icon="alert" style={{ marginBottom: 13 }}>{err}</Banner> : null}
      <Btn kind="blue" icon="check" label={draft.was ? 'Save plant' : 'Add plant'} disabled={busy} onPress={save} />
      {draft.was ? <Btn kind="ghost" icon="x" label="Delete plant" color={T.terminal} borderColor="#F0C7BC" style={{ marginTop: 9 }} onPress={() => { const p = draft.was!; setDraft(null); remove(p); }} /> : null}
    </>}</Dialog>
    <Dialog open={!!doomed} title={doomed ? `Delete ${doomed.name}?` : ''} onClose={() => setDoomed(null)} width={460}>{doomed && (inUse ? <>
      <Banner tone="warn" icon="alert" style={{ marginBottom: 13 }}><B>{count(inUse)} counted under {doomed.name}.</B> Deleting it would leave them without a plant, so it is not allowed.</Banner>
      <X s={14} c={T.slate} style={{ marginBottom: 14 }}>{doomed.active ? 'Switch it off instead: it leaves the arrival form, and those batteries keep its name.' : 'It is already switched off, so it no longer shows in the arrival form. Those batteries keep its name.'}</X>
      {err ? <Banner tone="bad" icon="alert" style={{ marginBottom: 13 }}>{err}</Banner> : null}
      {doomed.active ? <Btn kind="blue" icon="check" label="Switch it off" disabled={busy} onPress={switchOff} /> : null}
      <Btn kind="ghost" label="Close" style={{ marginTop: 9 }} onPress={() => setDoomed(null)} />
    </> : <>
      <X s={14} c={T.slate} style={{ marginBottom: 14 }}>No battery is counted under <B>{doomed.name}</B>, so it can be deleted. It leaves the arrival form and the plant list. This cannot be undone.</X>
      {err ? <Banner tone="bad" icon="alert" style={{ marginBottom: 13 }}>{err}</Banner> : null}
      <Btn kind="danger" icon="x" label="Delete plant" disabled={busy} onPress={confirmDelete} />
      <Btn kind="ghost" label="Keep it" style={{ marginTop: 9 }} onPress={() => setDoomed(null)} />
    </>)}</Dialog>
  </>;

  return { info, used, add, edit, remove, dialogs, canManage: canEdit };
}

/** One plant's details, with Edit and Delete — shown when a plant is picked on "Batteries by plant". */
export function PlantCard({ plant, pm }: { plant: Plant; pm: ReturnType<typeof usePlantManager> }) {
  const d = pm.info[plant.id];
  return <Card style={{ marginBottom: 0 }}>
    <CardH title={plant.name} right={plant.active ? <Chip tone="live" icon="check" label="In the arrival form" /> : <Chip tone="mute" icon="clock" label="Switched off" />} />
    <KV cols={2} pairs={[['Location', d?.location || '—'], ['Contact person', d?.contactName || '—'], ['Phone', d?.contactPhone || '—'], ['Batteries counted', String(pm.used(plant.id))]]} />
    {d?.notes ? <X s={13.5} c={T.slate} style={{ marginTop: 4 }}>{d.notes}</X> : null}
    {pm.canManage ? <View style={{ flexDirection: 'row', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
      <Btn kind="ghost" sm icon="pen" label="Edit plant" onPress={() => pm.edit(plant)} />
      <Btn kind="ghost" sm icon="x" label="Delete plant" color={T.terminal} borderColor="#F0C7BC" onPress={() => pm.remove(plant)} />
    </View> : null}
  </Card>;
}
