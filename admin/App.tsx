import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from '@felix/shared/store';
import { useAuthGate } from '@felix/shared/gate';
import { AdminApp } from './src/AdminApp';

/** The head office console: desktop/web. Dealers have their own product in ../dealer. */
function Root() {
  const { ready, auth, begin, signOut } = useAuthGate('admin');

  if (!ready || auth.status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#141A23' }}><ActivityIndicator color="#E8A72C" /></View>;
  }
  return <AdminApp key={auth.status === 'signedIn' ? 'admin-in' : 'admin-out'} session={auth.status === 'signedIn' ? auth.session : null} onSignedIn={begin} onSignOut={signOut} />;
}

export default function App() { return <SafeAreaProvider><Provider><Root /></Provider></SafeAreaProvider>; }
