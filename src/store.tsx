import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from './seed';
import { Role, State, uid } from './domain';
type Store = {state:State;setState:React.Dispatch<React.SetStateAction<State>>;role:Role;setRole:(r:Role)=>void;dealerId:string;setDealerId:(id:string)=>void;ready:boolean;storageError:string;notify:(message:string)=>void;toast:string;audit:(s:State,action:string,ref:string,reason:string,before?:string,after?:string)=>State;canEdit:boolean;isAdmin:boolean};
const Context=createContext<Store>(null!);
export function Provider({children}:{children:React.ReactNode}) {
 const [state,setState]=useState<State>(initialState),[role,setRole]=useState<Role>('Dealer'),[dealerId,setDealerId]=useState('FPP-014'),[ready,setReady]=useState(false),[storageError,setStorageError]=useState(''),[toast,setToast]=useState('');
 const writes=useRef(Promise.resolve());
 useEffect(()=>{AsyncStorage.getItem('felix-workspace-v1').then(s=>{if(s){const data=JSON.parse(s);if(data?.entries&&data?.batteries)setState({...initialState,...data});}}).catch(()=>setStorageError('Saved data could not be loaded. Changes remain in memory.')).finally(()=>setReady(true));},[]);
 useEffect(()=>{if(ready){writes.current=writes.current.then(()=>AsyncStorage.setItem('felix-workspace-v1',JSON.stringify(state))).then(()=>setStorageError('')).catch(()=>setStorageError('Device storage is full or unavailable. Keep this session open to retain your changes.'));}},[state,ready]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(t);}},[toast]);
 const isAdmin=role!=='Dealer'; const canEdit=role!=='Read-only'&&(isAdmin||state.dealers.find(d=>d.id===dealerId)?.status==='Active');
 function audit(s:State,action:string,ref:string,reason:string,before?:string,after?:string):State{return {...s,audits:[{id:uid('AUD'),actor:role==='Dealer'?`Rahul Patil · ${dealerId}`:`S. Deshpande · ${role}`,action,ref,reason,at:new Date().toISOString(),before,after},...s.audits]};}
 return <Context.Provider value={{state,setState,role,setRole,dealerId,setDealerId,ready,storageError,notify:setToast,toast,audit,canEdit,isAdmin}}>{children}</Context.Provider>;
}
export const useStore=()=>useContext(Context);
