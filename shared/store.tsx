import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState as demo } from './seed';
import { Role, State, uid } from './domain';
// No demo records: every dealer, battery, entry, model and city comes from the server after
// sign-in (api/sync.ts). Only settings the code needs before the first sync are kept.
const initialState:State={entries:[],batteries:[],dealers:[],models:[],movements:[],audits:[],customers:[],policies:demo.policies,notices:[],staff:[],reports:[],exports:[],overrides:[],cities:[],entryTypes:demo.entryTypes,lastSync:'',offline:false,language:'English',challans:[],smsAlerts:true};
// v1 held the demo seed merged with server data — dropped so no dummy record survives on a phone.
const STORE_KEY='felix-workspace-v2';
AsyncStorage.removeItem('felix-workspace-v1').catch(()=>{});
type Store = {state:State;setState:React.Dispatch<React.SetStateAction<State>>;role:Role;setRole:(r:Role)=>void;dealerId:string;setDealerId:(id:string)=>void;ready:boolean;storageError:string;notify:(message:string)=>void;toast:string;audit:(s:State,action:string,ref:string,reason:string,before?:string,after?:string)=>State;canEdit:boolean;isAdmin:boolean};
const Context=createContext<Store>(null!);
export function Provider({children}:{children:React.ReactNode}) {
 const [state,setState]=useState<State>(initialState),[role,setRole]=useState<Role>('Dealer'),[dealerId,setDealerId]=useState(''),[ready,setReady]=useState(false),[storageError,setStorageError]=useState(''),[toast,setToast]=useState('');
 const writes=useRef(Promise.resolve());
 useEffect(()=>{AsyncStorage.getItem(STORE_KEY).then(s=>{if(s){const data=JSON.parse(s);if(data?.entries&&data?.batteries)setState({...initialState,...data,offline:false});}}).catch(()=>setStorageError('Saved data could not be loaded. Changes remain in memory.')).finally(()=>setReady(true));},[]);
 useEffect(()=>{if(ready){writes.current=writes.current.then(()=>AsyncStorage.setItem(STORE_KEY,JSON.stringify(state))).then(()=>setStorageError('')).catch(()=>setStorageError('Device storage is full or unavailable. Keep this session open to retain your changes.'));}},[state,ready]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(t);}},[toast]);
 const isAdmin=role!=='Dealer'; const canEdit=role!=='Read-only'&&(isAdmin||state.dealers.find(d=>d.id===dealerId)?.status==='Active');
 function audit(s:State,action:string,ref:string,reason:string,before?:string,after?:string):State{return {...s,audits:[{id:uid('AUD'),actor:role==='Dealer'?`Rahul Patil · ${dealerId}`:`S. Deshpande · ${role}`,action,ref,reason,at:new Date().toISOString(),before,after},...s.audits]};}
 return <Context.Provider value={{state,setState,role,setRole,dealerId,setDealerId,ready,storageError,notify:setToast,toast,audit,canEdit,isAdmin}}>{children}</Context.Provider>;
}
export const useStore=()=>useContext(Context);
