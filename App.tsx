import React, { useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider, useStore } from './src/store';
import { DealerApp } from './src/dealer/DealerApp';
import { AdminApp } from './src/admin/AdminApp';
/** Dealers get the dealer mobile app; head office roles keep the admin workspace. */
function Root(){
 const {role,setRole,ready}=useStore();const [lastRole,setLastRole]=useState(role),[startHome,setStartHome]=useState(false);
 if(role!==lastRole){setLastRole(role);setStartHome(role==='Dealer');}
 if(!ready)return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><ActivityIndicator color="#E8A72C"/></View>;
 return role==='Dealer'?<DealerApp startHome={startHome} onHeadOffice={()=>setRole('Main Admin')}/>:<AdminApp onDealer={()=>setRole('Dealer')}/>;
}
export default function App(){return <SafeAreaProvider><Provider><Root/></Provider></SafeAreaProvider>;}

