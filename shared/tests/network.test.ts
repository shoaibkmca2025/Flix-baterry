import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newEntry, newItem, type Entry, type State } from '../domain';
import { initialState } from '../seed';
import { REGISTER_COLUMNS, registerRow, batteryDates, mmyy, issuedOn, replacedForLine, warrantyView, entryErrors, distributorStage, isDealerShop, networkEntries, refunds, specialLine, specialOutcome, specialWaiting, toSendBack } from '../data';

// Head office → distributor → dealer (client, 2 Oct 2026). In a distributor's app the store
// holds his own requests and his dealers'; dealer-1 is the distributor, dealer-1a his dealer.
const rep = (id: string, dealerId: string, status: Entry['status']): Entry =>
  ({ ...newEntry(dealerId), id, status, date: '2026-10-02', createdAt: `2026-10-02T0${id.length % 9}:00:00Z`, items: [{ ...newItem(), oldSerial: `OLD-${id}`, code: `NEW-${id}` }] });
const state = { entries: [
  rep('E1', 'dealer-1', 'Submitted'),           // his own, sent to head office
  rep('E2', 'dealer-1a', 'With distributor'),   // his dealer's, still waiting for him
  rep('E3', 'dealer-1a', 'Submitted'),          // his dealer's, approved by him → head office
  { ...rep('E4', 'dealer-1', 'Draft') },
] } as unknown as State;

test("a distributor sends back his own old batteries and those of his dealers' requests he approved", () => {
  assert.deepEqual(toSendBack(state, 'dealer-1').map(e => e.id), ['E1']);
  // E2 waits for his approval; E3 is approved but its old battery has not reached him yet (client, 3 Oct 2026)
  assert.deepEqual(toSendBack(state, 'dealer-1', true).map(e => e.id).sort(), ['E1']);
  const arrived = { ...state, entries: state.entries.map(e => e.id === 'E3' ? { ...e, items: e.items.map(it => ({ ...it, arrivedAtDistributor: '2026-10-03T10:00:00Z' })) } : e) } as State;
  assert.deepEqual(toSendBack(arrived, 'dealer-1', true).map(e => e.id).sort(), ['E1', 'E3']); // once marked arrived, it can go
  assert.deepEqual(networkEntries(state, 'dealer-1').map(e => e.id).sort(), ['E1', 'E2', 'E3', 'E4']);
  assert.deepEqual(refunds(state, 'dealer-1', true).checking.map(e => e.id).sort(), ['E1', 'E3']);
});

test('a shop is a distributor unless it says it is a dealer (every shop from before is one)', () => {
  assert.equal(isDealerShop({ kind: 'Dealer' }), true);
  assert.equal(isDealerShop({ kind: 'Distributor' }), false);
  assert.equal(isDealerShop({}), false);
  assert.equal(isDealerShop(undefined), false);
});

// A replacement for a battery past its warranty term is a SPECIAL request (client, 3 Oct 2026):
// its old battery cannot be sent on until head office approves it in Correction requests.
test('a special request is held until head office approves it', () => {
  const special = (id: string, dealerId: string, sp: Entry['special'], arrived = true): Entry => {
    const e = rep(id, dealerId, 'Submitted');
    return { ...e, special: sp, items: e.items.map(it => ({ ...it, coverCase: 'Expired' as const, coverTermEnd: '2026-07-31', coverEnd: '2026-09-30', arrivedAtDistributor: arrived ? '2026-10-03T10:00:00Z' : undefined })) };
  };
  const s = { entries: [special('S1', 'dealer-1a', 'Pending'), special('S2', 'dealer-1a', 'Approved'), special('S3', 'dealer-1', 'Pending'), special('S4', 'dealer-1a', 'Pending', false)] } as unknown as State;
  assert.deepEqual(toSendBack(s, 'dealer-1', true).map(e => e.id), ['S2']); // only the approved one can go
  const stage = (id: string) => { const e = s.entries.find(x => x.id === id)!; return distributorStage(e, e.items[0]!).key; };
  assert.equal(stage('S1'), 'held');      // he has the battery, head office has not decided
  assert.equal(stage('S2'), 'arrived');   // approved: ready to send
  assert.equal(stage('S4'), 'awaiting');  // he can still receive it while it waits
  assert.equal(specialWaiting(s.entries[0]!), true);
  assert.equal(specialWaiting({ ...s.entries[0]!, status: 'With distributor' }), false); // not head office's yet
});

test('"warranty exceeded by X days" counts from the end of the term', () => {
  assert.match(specialLine({ coverCase: 'Extension', coverTermEnd: '2025-12-31', coverEnd: '2026-02-28' }, '2026-01-10'), /^Warranty exceeded by 10 days · warranty ended 31 Dec 2025 · extension to 28 Feb 2026$/);
  assert.match(specialLine({ coverCase: 'Extension', coverTermEnd: '2025-12-31', coverEnd: '2026-02-28' }, '2026-01-01'), /by 1 day ·/);
  assert.match(specialLine({ coverCase: 'Expired', coverTermEnd: '2025-12-31', coverEnd: '2026-02-28' }, '2026-03-01'), /by 60 days · warranty ended 31 Dec 2025 · extension ended 28 Feb 2026$/);
  assert.equal(specialLine({}, '2026-03-01'), '');
  assert.match(specialOutcome({ coverCase: 'Expired' }), /NO warranty/);
  assert.match(specialOutcome({ coverCase: 'Extension', coverEnd: '2026-02-28' }), /keeps the old end date/);
});

// The form used to refuse a battery past its cover outright ("warranty ran out … cannot be
// claimed"), which would have stopped a special request at the counter (client, 3 Oct 2026).
test('a battery past its cover gets through the form — it is sent as a special request', () => {
  const s = structuredClone(initialState);
  const model = s.models.find(m => m.active)!;
  const e = { ...newEntry(s.dealers[0]!.id), customer: 'Test customer' };
  // made five years ago: long past any term + grace, and not on record anywhere
  e.items = [{ ...newItem(), model: model.id, oldModel: model.id, code: '26090991', serial: '0991', mfg: '2026-09', oldSerial: '21010991', fault: 'Low backup' }];
  assert.equal(entryErrors(e, s)['items.0.oldSerial'], undefined);
});

// The battery from the client's screenshots (6 Oct 2026): GPM1000, 12 months + 2, made May 2025,
// on a request dated 6 Oct 2026. The card said "exceeded by 159 days", the request page "expired 98
// days ago". Every screen now reads it through warrantyView, so there is one answer.
test('a battery reads the same on every screen: counted from the end of the warranty, at the request date', () => {
  const dates = { termEnd: '2026-04-30', coverEnd: '2026-06-30' };
  const v = warrantyView(dates, '2026-10-06')!;
  assert.equal(v.kind, 'expired');
  assert.equal(v.days, 159);
  assert.equal(v.headline, 'Warranty exceeded by 159 days');
  assert.equal(v.detail, 'Warranty ended 30 Apr 2026 · extension ended 30 Jun 2026');
  // the special-request card prints the very same words
  assert.equal(specialLine({ coverCase: 'Expired', coverTermEnd: dates.termEnd, coverEnd: dates.coverEnd }, '2026-10-06'), 'Warranty exceeded by 159 days · warranty ended 30 Apr 2026 · extension ended 30 Jun 2026');
  // inside the extension, and inside the warranty
  assert.deepEqual(warrantyView(dates, '2026-05-10')!.kind, 'extension');
  assert.equal(warrantyView(dates, '2026-05-10')!.headline, 'Warranty exceeded by 10 days');
  assert.equal(warrantyView(dates, '2026-04-30')!.kind, 'term'); // the last day of the warranty is still inside it
  assert.equal(warrantyView(dates, '2026-02-28')!.detail, 'Warranty to 30 Apr 2026 · extension to 30 Jun 2026');
  assert.equal(warrantyView({ ...dates, noWarranty: true }, '2026-02-28')!.kind, 'none');
});

// Head office voids a repeated entry (client, 6 Oct 2026): the server's 'void' is the store's
// 'Cancelled', read as "Voided" everywhere, and it leaves the distributor's to-do lists.
test('a voided request reads Voided and leaves every queue', () => {
  const v = { ...rep('V1', 'dealer-1a', 'Cancelled'), voidReason: 'Repeated entry' } as Entry;
  assert.equal(distributorStage(v, v.items[0]!).key, 'voided');
  assert.match(distributorStage(v, v.items[0]!).hint, /Repeated entry/);
  assert.deepEqual(toSendBack({ entries: [{ ...v, items: v.items.map(it => ({ ...it, arrivedAtDistributor: '2026-10-06T10:00:00Z' })) }] } as unknown as State, 'dealer-1', true), []);
  assert.equal(specialWaiting({ ...v, special: 'Pending' }), false);
});

// A battery given as a replacement comes back for one of its own (client, 6 Oct 2026): every screen
// names the old battery it stood in for, and the request it was given on.
test('a battery that was itself a replacement is recognised, with what it replaced', () => {
  const first = { ...rep('RP-1', 'dealer-1a', 'Approved'), date: '2026-10-06', items: [{ ...newItem(), model: 'M1000', oldModel: 'M1000', code: 'M100026105802', oldSerial: 'M100025105802' }] } as Entry;
  const again = { ...rep('RP-2', 'dealer-1a', 'Submitted'), items: [{ ...newItem(), model: 'M1000', oldModel: 'M1000', code: 'M100026115900', oldSerial: 'M100026105802' }] } as Entry;
  const s = { entries: [again, first, { ...first, id: 'RP-0', status: 'Cancelled' } as Entry] } as unknown as State;
  const was = issuedOn(s, again.items[0]!.oldSerial, 'M1000', again.id)!;
  assert.equal(was.entry.id, 'RP-1');
  assert.equal(replacedForLine({ oldSerial: was.oldSerial, date: was.entry.date, ref: was.entry.id }), 'Given on 06 Oct 2026 in place of old battery M100025105802 (RP-1)');
  assert.equal(issuedOn(s, 'M100025105802', 'M1000', again.id), null); // the very first battery was never a replacement
  assert.equal(issuedOn({ entries: [{ ...first, status: 'Cancelled' } as Entry] }, 'M100026105802', 'M1000'), null); // voided requests do not count
});

// The register's "Expiry MMYY" and the request page read the same dates (client, 6 Oct 2026).
test('a battery has one set of warranty dates — stored by the server, else its record, else its label', () => {
  const s = { ...structuredClone(initialState), entries: [], batteries: [] } as unknown as State;
  s.models = [...s.models, { id: 'GPM1000', type: '', capacity: '', months: 12, threshold: 0, active: true }];
  s.graceMonths = 2;
  // not on record: from the label — GPM1000, made May 2025, 12 months + 2
  const label = batteryDates(s, 'GPM100025058899', 'GPM1000')!;
  assert.deepEqual([label.termEnd, label.coverEnd, mmyy(label.termEnd)], ['2026-04-30', '2026-06-30', '04/26']);
  // what the server stored when it judged the request wins
  assert.equal(batteryDates(s, 'GPM100025058899', 'GPM1000', { termEnd: '2026-05-31', coverEnd: '2026-07-31' })!.termEnd, '2026-05-31');
  // on record: the warranty record's dates
  const rec = { ...s, batteries: [{ code: 'GPM100025058899', serial: '8899', model: 'GPM1000', dealerId: '', customer: '', mfg: '2025-05', start: '2025-03-01', expiry: '2026-04-30', termEnd: '2026-02-28', state: 'Sold' }] } as State;
  assert.equal(mmyy(batteryDates(rec, 'GPM100025058899', 'GPM1000')!.termEnd), '02/26');
  assert.equal(mmyy(undefined), '—');
});

// The register row behind both the All entries table and the Excel export (client, 6 Oct 2026):
// the expiry is the OVERALL end of the cover — warranty plus extension — and the "who" columns
// name the distributor for every request and the dealer only when one sent it.
test('a register row: overall expiry, then distributor, city and dealer', () => {
  const s = { ...structuredClone(initialState), batteries: [], graceMonths: 2 } as unknown as State;
  s.models = [...s.models, { id: 'GPM1000', type: '', capacity: '', months: 12, threshold: 0, active: true }];
  s.dealers = [
    { id: 'd-1', name: 'Abc solutions', kind: 'Distributor', city: 'Nashik' } as never,
    { id: 'd-1a', name: 'Rahul', kind: 'Dealer', distributorId: 'd-1', city: 'Sinnar' } as never,
  ];
  const mk = (dealerId: string): Entry => ({ ...newEntry(dealerId), id: 'RP-26-10-0010', date: '2026-10-06', status: 'Rejected', items: [{ ...newItem(), model: 'GPM1000', oldModel: 'GPM1000', code: 'GPM100026058866', oldSerial: 'GPM100025058899' }] });
  const r = registerRow(s, mk('d-1a'));
  assert.deepEqual([r.oldSerial, r.newSerial, r.expiry, mmyy(r.expiry), r.expired], ['GPM100025058899', 'GPM100026058866', '2026-06-30', '06/26', true]);
  assert.deepEqual([r.distributor, r.city, r.dealer], ['Abc solutions', 'Sinnar', 'Rahul']);
  const own = registerRow(s, mk('d-1'));
  assert.deepEqual([own.distributor, own.city, own.dealer], ['Abc solutions', 'Nashik', '']);
  assert.equal(registerRow(s, { ...mk('d-1'), status: 'Cancelled' }).status, 'Voided');
  assert.deepEqual([...REGISTER_COLUMNS], ['Reference', 'Type', 'Model', 'Old Serial', 'New Serial', 'Expiry MMYY', 'Distributor', 'City', 'Dealer', 'Date', 'Status']);
});
