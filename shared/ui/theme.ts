import { Platform } from 'react-native';
import { useFonts } from 'expo-font';

/* Colour tokens — Felix brand theme, green and white, sampled from the client's battery (Sep 2026):
 * the lid/handle green #008800 and the logo red #E00000. Layout and type still follow the approved
 * prototype; only the palette changed. Every text pair is checked against WCAG 4.5:1. */
export const T = {
  ink: '#141A23', ink2: '#1F2833', ink3: '#2B3746',   // text
  zinc: '#F3F7F3', zinc2: '#DCE7DE', zinc3: '#C2D1C5', // page background, dividers — near-white with a green cast
  slate: '#5B6878',                                    // secondary text (5.25:1 on the page)
  steel: '#0B6E26', steelSoft: '#E6F4E8',              // action green: links, selection, secondary buttons (white 6.4:1)
  volt: '#008800', voltSoft: '#FDF3DE',                // BRAND green (primary buttons, white 4.6:1); voltSoft stays the amber warning tint
  amber: '#E8A72C',                                    // waiting / pending (was the old accent)
  deep: '#0E3B1C', deepText: '#A9CDB2', deepNav: '#C9DECE', // deep green surfaces (header, plates, sidebar) and their text
  info: '#22468A', infoSoft: '#E8EFFB',                // information chips and banners stay blue
  brandRed: '#E00000',                                 // the Felix logo red — for the logo mark only
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
