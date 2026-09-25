import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../seed';
import { approveEntry, chainFor, deriveCode, expiryFrom, filterEntries, fullCode, newEntry, splitLabel, validateEntry, warranty } from '../domain';
const fresh=()=>structuredClone(initialState);
test('manufacturing derivation preserves the short serial leading zeros',()=>{
 assert.deepEqual(deriveCode('21030047'),{serial:'0047',mfg:'2021-03',labelModelId:''});
 // a label names its product, and that product is half the battery's identity (D-13)
 assert.deepEqual(deriveCode('M1000-21030047',['M1000']),{serial:'0047',mfg:'2021-03',labelModelId:'M1000'});
 assert.deepEqual(deriveCode('GP M 1000 2103 0047',['M1000','GPM1000']),{serial:'0047',mfg:'2021-03',labelModelId:'GPM1000'});
 assert.deepEqual(splitLabel('IT 2200 SG 2103 0047',['SG2200']),{modelId:'SG2200',code:'21030047'});
 assert.deepEqual(splitLabel('K 60L 2103 0047',['K60L']),{modelId:'K60L',code:'21030047'});
 assert.equal(fullCode('M1000','21030047'),'M100021030047');
 assert.notEqual(fullCode('M1000','21030047'),fullCode('S1000','21030047')); // same digits, different battery
 assert.equal(deriveCode('21130047').mfg,'');
});
test('warranty ends on the day before a clamped calendar anniversary',()=>{
 assert.equal(expiryFrom('2026-01-10',24),'2028-01-09');
 assert.equal(expiryFrom('2024-02-29',12),'2025-02-27');
 assert.equal(expiryFrom('2026-01-31',1),'2026-02-27');
});
test('multi-item entry blocks duplicate codes, invalid dates, and self replacement',()=>{
 const s=fresh(),e=newEntry('FPP-014');
 e.items[0]={...e.items[0],code:'26080311',serial:'0311',oldSerial:'26080311',mfg:'2026-08'};
 assert.match(validateEntry(e,s)['items.0.oldSerial'],/different/);
 e.items[0].oldSerial='26050195';e.items.push({...e.items[0],id:'SECOND'});
 assert.match(validateEntry(e,s)['items.0.code'],/already/);
 e.date='not a date';assert.ok(validateEntry(e,s).date);
});
test('approval carries original warranty through a second replacement and posts once',()=>{
 let s=fresh(),e=newEntry('FPP-014');e.status='Submitted';e.customer='Suresh Transport';
 e.items[0]={...e.items[0],code:'26080311',serial:'0311',oldSerial:'26050195',mfg:'2026-08'};
 s.entries.push(e);const before=s.movements.length;s=approveEntry(s,e);
 const b=s.batteries.find(b=>b.code==='26080311')!;
 assert.equal(b.start,'2026-01-10');assert.equal(b.expiry,'2028-01-09');assert.equal(b.policy,'POL-01');
 assert.equal(s.movements.length,before+2);assert.equal(s.entries.find(x=>x.id===e.id)!.status,'Approved');
 const again=approveEntry(s,e);assert.equal(again.movements.length,s.movements.length);
 assert.deepEqual(chainFor('26080311',s.batteries).map(b=>b.code),['21030047','26050195','26080311']);
 assert.deepEqual(chainFor('21030047',s.batteries).map(b=>b.code),['21030047','26050195','26080311']);
});
test('unknown old serial stays without invented warranty dates on approval',()=>{
 let s=fresh(),e=newEntry('FPP-014');e.status='Submitted';e.items[0]={...e.items[0],code:'26080311',serial:'0311',oldSerial:'20011111',mfg:'2026-08'};
 s.entries.push(e);s=approveEntry(s,e);assert.equal(s.batteries.find(b=>b.code==='26080311')!.expiry,undefined);
});
test('invalid custody, expired warranty, and already replaced sources are blocked',()=>{
 const s=fresh(),e=newEntry('FPP-014');e.items[0]={...e.items[0],code:'26080311',serial:'0311',oldSerial:'26070400',mfg:'2026-08'};
 assert.match(validateEntry(e,s)['items.0.oldSerial'],/custody/);
 e.items[0].oldSerial='21040097';assert.match(validateEntry(e,s)['items.0.oldSerial'],/expired/);
 e.items[0].oldSerial='21030047';assert.match(validateEntry(e,s)['items.0.oldSerial'],/already been replaced/);
});
test('filters combine status, type, model, query, and date range',()=>{
 const e=filterEntries(fresh().entries,'Patil','Replacement','Submitted','B5','2026-09-01','2026-09-30');
 assert.equal(e.length,1);assert.equal(e[0].id,'ENT-26-09-0412');
 assert.equal(filterEntries(e,'','All','Approved').length,0);
});
test('warranty status is explicit at expiry and without a source date',()=>{
 const b=fresh().batteries[0];assert.equal(warranty(b,'2028-01-09').status,'Expiring soon');assert.equal(warranty(b,'2028-01-10').status,'Expired');
 assert.equal(warranty({...b,expiry:undefined}).status,'Not on record');
});
