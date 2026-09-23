import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from '@felix/shared/store';
import { useAuthGate } from '@felix/shared/gate';
import { DealerApp } from './src/DealerApp';

/** The dealer app: phones only. Head office has its own product in ../admin. */
function Root() {
  const { ready, auth, begin, signOut } = useAuthGate('dealer');

  if (!ready || auth.status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#141A23' }}><ActivityIndicator color="#E8A72C" /></View>;
  }
  return <DealerApp signedIn={auth.status === 'signedIn'} onSignedIn={begin} onSignOut={signOut} />;
}

export default function App() { return <SafeAreaProvider><Provider><Root /></Provider></SafeAreaProvider>; }
