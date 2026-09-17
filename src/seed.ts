import { State, Entry, Battery } from './domain';
const date='2026-09-14';
const batteries:Battery[]=[
 {code:'21030047',serial:'0047',model:'M5',dealerId:'FPP-014',customer:'Suresh Transport',mfg:'2021-03',start:'2026-01-10',expiry:'2028-01-09',policy:'POL-01',state:'Returned'},
 {code:'26050195',serial:'0195',model:'M5',dealerId:'FPP-014',customer:'Suresh Transport',mfg:'2026-05',start:'2026-01-10',expiry:'2028-01-09',policy:'POL-01',state:'Replacement',oldSerial:'21030047'},
 {code:'21040367',serial:'0367',model:'S5',dealerId:'FPP-014',customer:'Om Sai Motors',mfg:'2021-04',start:'2025-03-12',expiry:'2027-03-11',policy:'POL-01',state:'Sold',oldSerial:'21010188'},
 {code:'21010188',serial:'0188',model:'S5',dealerId:'FPP-014',customer:'Om Sai Motors',mfg:'2021-01',start:'2025-03-12',expiry:'2027-03-11',policy:'POL-01',state:'Returned'},
 {code:'21040385',serial:'0385',model:'B5',dealerId:'FPP-014',customer:'Patil Farm',mfg:'2021-04',start:'2024-10-02',expiry:'2026-10-01',policy:'POL-01',state:'Sold'},
 {code:'21040097',serial:'0097',model:'M7',dealerId:'FPP-014',customer:'Deshmukh Auto',mfg:'2021-04',start:'2024-02-09',expiry:'2026-02-08',policy:'POL-01',state:'Sold'},
 {code:'26080512',serial:'0512',model:'I700',dealerId:'FPP-014',customer:'',mfg:'2026-08',state:'Available'},
 {code:'26080311',serial:'0311',model:'M5',dealerId:'FPP-014',customer:'',mfg:'2026-08',state:'Available'},
 {code:'26080312',serial:'0312',model:'M5',dealerId:'FPP-014',customer:'',mfg:'2026-08',state:'Available'},
 {code:'26080313',serial:'0313',model:'M5',dealerId:'FPP-014',customer:'',mfg:'2026-08',state:'Available'},
 {code:'26080501',serial:'0501',model:'B5',dealerId:'FPP-014',customer:'',mfg:'2026-08',state:'Available'},
 {code:'26080502',serial:'0502',model:'S5',dealerId:'FPP-014',customer:'',mfg:'2026-08',state:'Available'},
 {code:'26070400',serial:'0400',model:'B5',dealerId:'GLB-021',customer:'Golden Auto',mfg:'2026-07',start:'2026-08-01',expiry:'2028-07-31',policy:'POL-01',state:'Sold'},
 // --- old batteries for testing a replacement, one per case (see backend/memory.md §10) ---
 // cover active, plenty left
 {code:'21020140',serial:'0140',model:'M5',dealerId:'FPP-014',customer:'Nashik Roadlines',mfg:'2021-02',start:'2025-06-15',expiry:'2027-06-14',policy:'POL-01',state:'Sold'},
 {code:'21030017',serial:'0017',model:'B5',dealerId:'FPP-014',customer:'Patil Travels',mfg:'2021-03',start:'2026-03-01',expiry:'2028-02-29',policy:'POL-01',state:'Sold'},
 {code:'21040211',serial:'0211',model:'M7',dealerId:'FPP-014',customer:'Shree Transport',mfg:'2021-04',start:'2026-05-20',expiry:'2028-05-19',policy:'POL-01',state:'Sold'},
 // cover ending soon (inside the 30-day warning window)
 {code:'21040104',serial:'0104',model:'B5',dealerId:'FPP-014',customer:'Kisan Agro',mfg:'2021-04',start:'2024-10-10',expiry:'2026-10-09',policy:'POL-01',state:'Sold'},
 // cover ended — blocked until head office approves an override
 {code:'21050512',serial:'0512',model:'I700',dealerId:'FPP-014',customer:'Deshmukh Farms',mfg:'2021-05',start:'2023-08-01',expiry:'2025-07-31',policy:'POL-01',state:'Sold'},
 {code:'20120066',serial:'0066',model:'M5',dealerId:'FPP-014',customer:'Sai Travels',mfg:'2020-12',start:'2024-01-15',expiry:'2026-01-14',policy:'POL-01',state:'Sold'},
 // no cover dates on record — head office reconciles against the old register
 {code:'19070123',serial:'0123',model:'M3',dealerId:'FPP-014',customer:'Sunrise Hotel',mfg:'2019-07',state:'Sold'},
 // chain replaced twice already — the third replacement raises the repeat flag
 {code:'20110044',serial:'0044',model:'M5',dealerId:'FPP-014',customer:'Jain Logistics',mfg:'2020-11',start:'2025-01-05',expiry:'2027-01-04',policy:'POL-01',state:'Returned'},
 {code:'21030029',serial:'0029',model:'M5',dealerId:'FPP-014',customer:'Jain Logistics',mfg:'2021-03',start:'2025-01-05',expiry:'2027-01-04',policy:'POL-01',state:'Returned',oldSerial:'20110044'},
 {code:'26060210',serial:'0210',model:'M5',dealerId:'FPP-014',customer:'Jain Logistics',mfg:'2026-06',start:'2025-01-05',expiry:'2027-01-04',policy:'POL-01',state:'Replacement',oldSerial:'21030029'},
 // held by another dealer — custody conflict
 {code:'26070402',serial:'0402',model:'S5',dealerId:'GLB-021',customer:'Nashik Roadways',mfg:'2026-07',start:'2026-06-05',expiry:'2028-06-04',policy:'POL-01',state:'Sold'},
 // spare stock so several test replacements can be recorded without running out
 {code:'26090601',serial:'0601',model:'M5',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
 {code:'26090602',serial:'0602',model:'M5',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
 {code:'26090603',serial:'0603',model:'B5',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
 {code:'26090604',serial:'0604',model:'S5',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
 {code:'26090605',serial:'0605',model:'M7',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
 {code:'26090606',serial:'0606',model:'I700',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
 {code:'26090607',serial:'0607',model:'M3',dealerId:'FPP-014',customer:'',mfg:'2026-09',state:'Available'},
];
const entries:Entry[]=[
 ['0413','Replacement','Approved','S5','21040367','0367','21010188','Om Sai Motors','2026-09-13'],
 ['0412','Replacement','Submitted','B5','26080501','0501','21040385','Patil Farm','2026-09-13'],
 ['0411','Goods Return','Pending sync','I700','26080512','0512','','Suresh Transport','2026-09-12'],
 ['0409','Replacement','Conflict','M7','26080319','0319','21040097','Deshmukh Auto','2026-09-12'],
 ['0404','Regular Sales','Approved','B5','21040385','0385','','Patil Farm','2026-09-11'],
 ['0398','Given for Demo','Approved','I700','26080512','0512','','Suresh Transport','2026-09-10'],
 ['0394','Replacement','Approved','M5','26050195','0195','21030047','Suresh Transport','2026-09-09'],
].map(([n,type,status,model,code,serial,oldSerial,customer,d])=>({id:`ENT-26-09-${n}`,dealerId:'FPP-014',type,date:d,customer,place:'Sakri Road',order:`REF-${n}`,remarks:'',items:[{id:`ITEM-${n}`,model,code,serial,oldSerial,mfg:`20${code.slice(0,2)}-${code.slice(2,4)}`,rpl:d.slice(0,7),rtn:'',wr:oldSerial,remarks:''}],status:status as Entry['status'],evidence:[],createdAt:d+'T09:30:00',retries:0,...(type==='Replacement'&&status==='Approved'?{returnState:'At dealer'}:{})}));
export const initialState:State={
 entries,batteries,
 dealers:[
 {id:'FPP-014',name:'Felix Power Point',contact:'Rahul Patil',mobile:'9876543210',email:'rahul@example.com',city:'Dhule',place:'Sakri Road',address:'24, Sakri Road, Dhule',pin:'424001',state:'Maharashtra',status:'Active'},
 {id:'GLB-021',name:'Golden Battery',contact:'Amit Shah',mobile:'9876543211',email:'amit@example.com',city:'Nashik',place:'College Road',address:'College Road, Nashik',pin:'422001',state:'Maharashtra',status:'Active'},
 {id:'SAE-033',name:'Shree Auto Electricals',contact:'Raj Joshi',mobile:'9876543212',email:'raj@example.com',city:'Jalgaon',place:'MIDC',address:'MIDC, Jalgaon',pin:'425001',state:'Maharashtra',status:'Active'},
 {id:'NBH-007',name:'Nashik Battery House',contact:'Vijay Kale',mobile:'9876543213',email:'vijay@example.com',city:'Nashik',place:'Old Nashik',address:'Old Nashik',pin:'422001',state:'Maharashtra',status:'Suspended',reason:'Business documents require renewal.'},
 {id:'VPC-045',name:'Vidyut Power Centre',contact:'Prakash More',mobile:'9876543214',email:'prakash@example.com',city:'Malegaon',place:'Station Road',address:'Station Road, Malegaon',pin:'423203',state:'Maharashtra',status:'Pending Approval'}],
 models:[['M3','IT','100 Ah'],['M5','IT','150 Ah'],['M7','IT','180 Ah'],['B5','Automotive','65 Ah'],['S5','Solar','150 Ah'],['I700','Inverter','700 VA']].map(([id,type,capacity])=>({id,type,capacity,months:24,threshold:id==='M5'?5:2,active:true})),
 movements:batteries.map((b,i)=>({id:`MOV-${i}`,code:b.code,model:b.model,dealerId:b.dealerId,from:'Company',to:b.state,reason:'Opening demo register',date:'2026-09-01'})),
 audits:[{id:'AUD-001',actor:'S. Deshpande · Main Admin',action:'Replacement approved',ref:'ENT-26-09-0394',reason:'Warranty verified against original sale.',at:'2026-09-09T09:47:00',before:'Submitted',after:'Approved'}],
 customers:[{id:'CUS-01',dealerId:'FPP-014',name:'Suresh Transport',mobile:'9876500101',address:'Sakri Road, Dhule',equipment:'Tata 407 · MH18 AB 0421',consent:true},{id:'CUS-02',dealerId:'FPP-014',name:'Patil Farm',mobile:'9876500102',address:'Dhule',equipment:'Farm inverter',consent:false},{id:'CUS-03',dealerId:'FPP-014',name:'Om Sai Motors',mobile:'9876500103',address:'Agra Road, Dhule',equipment:'Workshop power backup',consent:true},{id:'CUS-04',dealerId:'FPP-014',name:'Nashik Roadlines',mobile:'9876500104',address:'Sakri Road, Dhule',equipment:'Ashok Leyland · MH15 CD 2290',consent:true},{id:'CUS-05',dealerId:'FPP-014',name:'Jain Logistics',mobile:'9876500105',address:'Nardana, Dhule',equipment:'Tata 709 · MH18 EF 7781',consent:true},{id:'CUS-06',dealerId:'FPP-014',name:'Kisan Agro',mobile:'9876500106',address:'Shirpur Road, Dhule',equipment:'Irrigation pump backup',consent:false},{id:'CUS-07',dealerId:'FPP-014',name:'Deshmukh Farms',mobile:'9876500107',address:'Sakri, Dhule',equipment:'Farm inverter · 700 VA',consent:true},{id:'CUS-08',dealerId:'FPP-014',name:'Patil Travels',mobile:'9876500108',address:'Deopur, Dhule',equipment:'Force Traveller · MH18 GH 1043',consent:false}],
 policies:[{id:'POL-01',months:24,effective:'2020-01-01',anchor:'Original sale',overrides:false,maxDays:0,alertDays:30}],
 notices:[{id:'N1',title:'Replacement ready for handover',body:'ENT-26-09-0394 has been approved. Confirm when the customer receives their battery.',route:'returns',read:false,dealerId:'FPP-014'},{id:'N2',title:'A little attention, a lot of power',body:'M5 stock is below the reorder threshold. Review available batteries.',route:'stock',read:false,dealerId:'FPP-014'},{id:'N3',title:'Warranty ending soon',body:'Battery 21040385 reaches the end of its cover on 1 October.',route:'warranty',read:false,dealerId:'FPP-014'}],
 staff:[{id:'U1',name:'S. Deshpande',email:'admin@example.com',role:'Main Admin',status:'Active',permissions:['All']},{id:'U2',name:'A. Kulkarni',email:'operations@example.com',role:'Co-Admin',status:'Active',permissions:['Entries','Dealers','Inventory','Reports']},{id:'U3',name:'Rahul Patil',email:'rahul@example.com',role:'Dealer Manager',dealerId:'FPP-014',status:'Active',permissions:['Entries','Inventory']}],
 reports:[{id:'R1',name:'Monthly replacement register',type:'Replacement',model:'All',status:'All',schedule:'Monthly · 1st'}],exports:[],overrides:[],cities:['Dhule','Nashik','Jalgaon','Malegaon'],entryTypes:['Replacement','Regular Sales','Goods Return','Repaired & Returned — Non Chargeable','Repaired & Returned — Chargeable','Received from Customer for Repairs','Material Sent for Repair','Standby / Returnable Basis','Given on Approval Basis','Given for Demo','Returned / Unrepaired','For Charging','Other'],lastSync:date+'T09:41:00',offline:false,language:'English',challans:[],smsAlerts:true
};
