import { Platform } from 'react-native';
import { useFonts } from 'expo-font';

/* Colour tokens — copied from the approved dealer prototype (Felix-Dealer-App-Only.html :root). */
export const T = {
  ink: '#141A23', ink2: '#1F2833', ink3: '#2B3746',
  zinc: '#EDF0F4', zinc2: '#DDE3EA', zinc3: '#C4CDD8',
  slate: '#5B6878',
  steel: '#2E5AAC', steelSoft: '#E8EFFB',
  volt: '#E8A72C', voltSoft: '#FDF3DE',
  live: '#1B7A4F', liveSoft: '#E1F3EA',
  terminal: '#C43A22', terminalSoft: '#FBE9E5',
  violet: '#6B4FA8', violetSoft: '#EFEAF8',
  white: '#FFFFFF',
  // Control boundary (unfilled fields, checkboxes, choice chips): 3.2:1 on white, the WCAG minimum
  // for an interactive element's outline. zinc3 (1.6:1) stays for dividers and read-only fields.
  line: '#8591A1',
};

const FACES = {
  Barlow_400Regular: require('@expo-google-fonts/barlow/400Regular/Barlow_400Regular.ttf'),
  Barlow_500Medium: require('@expo-google-fonts/barlow/500Medium/Barlow_500Medium.ttf'),
  Barlow_600SemiBold: require('@expo-google-fonts/barlow/600SemiBold/Barlow_600SemiBold.ttf'),
  Barlow_700Bold: require('@expo-google-fonts/barlow/700Bold/Barlow_700Bold.ttf'),
  BarlowSemiCondensed_500Medium: require('@expo-google-fonts/barlow-semi-condensed/500Medium/BarlowSemiCondensed_500Medium.ttf'),
  BarlowSemiCondensed_600SemiBold: require('@expo-google-fonts/barlow-semi-condensed/600SemiBold/BarlowSemiCondensed_600SemiBold.ttf'),
  BarlowSemiCondensed_700Bold: require('@expo-google-fonts/barlow-semi-condensed/700Bold/BarlowSemiCondensed_700Bold.ttf'),
  IBMPlexMono_500Medium: require('@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf'),
  IBMPlexMono_600SemiBold: require('@expo-google-fonts/ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf'),
};
export const useDealerFonts = () => useFonts(FACES);

export type Face = 'b' | 'c' | 'm'; // Barlow · Barlow Semi Condensed · IBM Plex Mono
export type Weight = 4 | 5 | 6 | 7;
const WEB_FALLBACK = { b: '"Segoe UI", system-ui, sans-serif', c: '"Barlow", system-ui, sans-serif', m: 'ui-monospace, Menlo, monospace' };
export function family(f: Face = 'b', w: Weight = 4) {
  const name = f === 'm' ? (w >= 6 ? 'IBMPlexMono_600SemiBold' : 'IBMPlexMono_500Medium')
    : f === 'c' ? (w >= 7 ? 'BarlowSemiCondensed_700Bold' : w === 6 ? 'BarlowSemiCondensed_600SemiBold' : 'BarlowSemiCondensed_500Medium')
    : w >= 7 ? 'Barlow_700Bold' : w === 6 ? 'Barlow_600SemiBold' : w === 5 ? 'Barlow_500Medium' : 'Barlow_400Regular';
  return Platform.OS === 'web' ? `${name}, ${WEB_FALLBACK[f]}` : name;
}
