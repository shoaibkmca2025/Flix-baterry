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
  // The key remounts the app when the session flips, so a fresh sign-in lands on the dashboard
  // instead of staying on d02 (DealerApp only reads `signedIn` for its initial route).
  const signedIn = auth.status === 'signedIn';
  return <DealerApp key={signedIn ? 'dealer-in' : 'dealer-out'} signedIn={signedIn} onSignedIn={begin} onSignOut={signOut} />;
}

export default function App() { return <SafeAreaProvider><Provider><Root /></Provider></SafeAreaProvider>; }
