import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import * as XLSX from 'xlsx';
import { Dealer, Entry, State } from './domain';
export const columns=['Dealer','City','Place','Model','Code','Serial No','Mfg Mon','Rpl Mon','Rtn Mon','Month','WR Serial No.','Old Serial No.','Entry Reference No.','Entry Type','Status'];
export function exportRows(entries:Entry[],state:State) {return entries.flatMap(e=>e.items.map(i=>{const d=state.dealers.find(d=>d.id===e.dealerId);return [d?.name||'',d?.city||'',e.place,i.model,i.code,i.serial,i.mfg,i.rpl,i.rtn,e.date.slice(0,7),i.wr,i.oldSerial,e.id,e.type,e.status];}));}
export const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function saveFile(name:string,data:string,mime:string,base64=false) {
 if(Platform.OS==='web') {const bytes=base64?Uint8Array.from(atob(data),c=>c.charCodeAt(0)):data;const blob=new Blob([bytes],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 else {const file=new File(Paths.cache,name);file.create({overwrite:true});if(base64)file.write(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));else file.write(data);if(await Sharing.isAvailableAsync())await Sharing.shareAsync(file.uri,{mimeType:mime});}
}
export async function exportReport(entries:Entry[],state:State,format:string,selected:string[]=columns) {
 const indexes=selected.map(c=>columns.indexOf(c));const data=exportRows(entries,state).map(r=>indexes.map(i=>r[i]));const all=[selected,...data];
 if(format==='Excel') {const ws=XLSX.utils.aoa_to_sheet(all);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Battery register');ws['!cols']=selected.map(()=>({wch:22}));const b64=XLSX.write(wb,{type:'base64',bookType:'xlsx'});await saveFile('felix-battery-register.xlsx',b64,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',true);}
 else if(format==='CSV') {const csv=all.map(r=>r.map(v=>`"${(/^[=+@-]/.test(v)?"'":'')+v.replace(/"/g,'""')}"`).join(',')).join('\r\n');await saveFile('felix-battery-register.csv','\uFEFF'+csv,'text/csv');}
 else {await printHtml(`<h1>Felix Batteries · Battery register</h1><p>${data.length} battery items</p><table><thead><tr>${selected.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);}
 return data.length;
}
export async function printHtml(body:string) {const html=`<html><head><meta charset="utf-8"/><style>body{font-family:Arial;color:#19232c;padding:25px;font-size:11px}h1{font-size:23px}table{border-collapse:collapse;width:100%;font-size:9px}td,th{padding:7px;border:1px solid #ddd;text-align:left}th{background:#fff4da}p{line-height:1.7}@page{size:A4 landscape;margin:12mm}</style></head><body>${body}</body></html>`;if(Platform.OS==='web')await Print.printAsync({html});else {const {uri}=await Print.printToFileAsync({html});await Sharing.shareAsync(uri,{mimeType:'application/pdf'});}}
export async function printEntry(e:Entry,d:Dealer) {await printHtml(`<h1>Felix Batteries · Entry acknowledgement</h1><p><b>${escapeHtml(e.id)}</b><br/>${escapeHtml(d.name)} · ${escapeHtml(d.city)}<br/>${escapeHtml(e.date)} · ${escapeHtml(e.type)} · ${escapeHtml(e.status)}<br/>Customer: ${escapeHtml(e.customer)}<br/>Total quantity: ${e.items.length}</p><table><tr><th>Model</th><th>Battery code</th><th>Serial</th><th>Old serial</th><th>Mfg</th><th>Rpl</th><th>Return</th></tr>${e.items.map(i=>`<tr>${[i.model,i.code,i.serial,i.oldSerial,i.mfg,i.rpl,i.rtn].map(v=>`<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</table><p>Recorded: ${escapeHtml(e.createdAt)}. This is a transaction acknowledgement, not a tax invoice.</p>`);}
