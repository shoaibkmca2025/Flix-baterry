import React, { useRef, useState } from 'react';
import { View, Image, Pressable, PanResponder, Platform, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { T } from './theme';
import { X, Ic, IconName } from './kit';

/** Camera first, photo library as the fallback. Returns a URI that survives a reload on web. */
export async function takePhoto(notify: (m: string) => void, library = false): Promise<string | null> {
  try {
    let useCamera = !library;
    if (useCamera && Platform.OS !== 'web') { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) { notify('Camera access declined. Choose a photo from the gallery instead.'); useCamera = false; } }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.4, base64: Platform.OS === 'web' };
    const r = useCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return null;
    const a = r.assets[0];
    return Platform.OS === 'web' && a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
  } catch { notify('The camera is not available here. Try choosing a photo instead.'); return null; }
}
export async function pickDocument(notify: (m: string) => void): Promise<string | null> {
  try { const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true }); return r.canceled ? null : r.assets[0].name; }
  catch { notify('Could not open your files on this device.'); return null; }
}
export async function locate(): Promise<{ gps?: string; error?: string }> {
  try {
    const p = await Location.requestForegroundPermissionsAsync();
    if (!p.granted) return { error: 'declined' };
    const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    let place = '';
    if (Platform.OS !== 'web') { try { const a = (await Location.reverseGeocodeAsync(l.coords))[0]; place = [a?.street || a?.name, a?.city || a?.subregion].filter(Boolean).join(', '); } catch { /* address lookup is optional */ } }
    return { gps: `${l.coords.latitude.toFixed(5)}, ${l.coords.longitude.toFixed(5)} · ±${Math.round(l.coords.accuracy || 0)}m · ${new Date().toISOString()}${place ? ` · ${place}` : ''}` };
  } catch { return { error: 'unavailable' }; }
}
export function parseGps(gps?: string) {
  if (!gps) return null;
  const [coords, acc, at, place] = gps.split(' · ');
  return { coords, accuracy: (acc || '').replace('±', ''), at, place };
}

/** .photo tile — dashed when empty, dark (or the photo itself) once captured. */
export function Photo({ label, uri, has, onPress, height = 88, icon = 'cam', style }: { label: string; uri?: string; has?: boolean; onPress?: () => void; height?: number; icon?: IconName; style?: any }) {
  const filled = has || !!uri;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[{ flex: 1, height, borderRadius: 9, borderWidth: 1.5, borderStyle: filled ? 'solid' : 'dashed', borderColor: filled ? T.ink3 : T.zinc3, backgroundColor: T.zinc2, alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden' }, style]}>
    {filled && <Svg style={StyleSheet.absoluteFill} width="100%" height="100%"><Defs><LinearGradient id="ph" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#3C4B5E" /><Stop offset="1" stopColor="#212A36" /></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#ph)" /></Svg>}
    {uri && <><Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /><View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,26,35,0.45)' }]} /></>}
    <Ic n={icon} size={19} color={filled ? '#D6DEE8' : T.slate} />
    <X s={11.5} w={6} c={filled ? '#D6DEE8' : T.slate} style={{ textAlign: 'center' }}>{label}</X>
  </Pressable>;
}

export function SignaturePad({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const [paths, setPaths] = useState<string[]>(() => { try { const p = value ? JSON.parse(value) : []; return Array.isArray(p) ? p : []; } catch { return []; } });
  const committed = useRef(paths), current = useRef(''), cb = useRef(onChange); cb.current = onChange;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onStartShouldSetPanResponderCapture: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => { current.current = `M ${e.nativeEvent.locationX.toFixed(1)} ${e.nativeEvent.locationY.toFixed(1)}`; setPaths([...committed.current, current.current]); },
    onPanResponderMove: e => { current.current += ` L ${e.nativeEvent.locationX.toFixed(1)} ${e.nativeEvent.locationY.toFixed(1)}`; setPaths([...committed.current, current.current]); },
    onPanResponderRelease: () => { committed.current = [...committed.current, current.current]; setPaths(committed.current); cb.current(JSON.stringify(committed.current)); },
  })).current;
  return <View>
    <View {...pan.panHandlers} style={{ height: 96, borderWidth: 1.5, borderStyle: 'dashed', borderColor: T.zinc3, borderRadius: 9, backgroundColor: '#FCFCFD', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...(Platform.OS === 'web' ? { touchAction: 'none', cursor: 'crosshair' } as any : null) }}>
      {!paths.length && <X s={12.5} c={T.slate} style={{ position: 'absolute' }} pointerEvents="none">Customer signs here</X>}
      <Svg width="100%" height="96" pointerEvents="none" style={StyleSheet.absoluteFill}>{paths.map((d, i) => <Path key={i} d={d} fill="none" stroke={T.ink3} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />)}</Svg>
    </View>
    {paths.length > 0 && <Pressable accessibilityRole="button" onPress={() => { committed.current = []; setPaths([]); onChange(''); }} style={{ alignSelf: 'flex-end', paddingVertical: 6 }}><X s={12.5} w={6} c={T.steel}>Clear signature</X></Pressable>}
  </View>;
}
