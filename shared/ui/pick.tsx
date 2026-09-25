import React, { useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { T } from './theme';
import { X, Ic } from './kit';

/** Picker list: used inside the dealer app's bottom sheets and the console's dialogs. Lists longer
 * than a screenful get a search box (matches the name or the grey line under it, e.g. "13 plates"). */
export function PickList({ options, value, onPick, search }: { options: { v: string; sub?: string }[]; value: string; onPick: (v: string) => void; search?: string }) {
  const [q, setQ] = useState('');
  const showSearch = search !== undefined || options.length > 8;
  const n = q.trim().toLowerCase();
  const shown = n ? options.filter(o => o.v.toLowerCase().includes(n) || (o.sub ?? '').toLowerCase().includes(n)) : options;
  return <View>
    {showSearch && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: T.white, borderWidth: 1.5, borderColor: q ? T.ink3 : T.zinc3, borderRadius: 9, paddingHorizontal: 12, marginBottom: 10, minHeight: 46 }}>
      <Ic n="search" size={18} color={T.slate} />
      <TextInput value={q} onChangeText={setQ} placeholder={search || 'Search'} placeholderTextColor="#93A0AF" autoCorrect={false} autoCapitalize="characters" accessibilityLabel={search || 'Search'}
        style={{ flex: 1, fontSize: 16, color: T.ink, paddingVertical: 10 }} />
      {!!q && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')}><Ic n="x" size={18} color={T.slate} /></Pressable>}
    </View>}
    {!shown.length ? <X s={14} c={T.slate} style={{ padding: 14, textAlign: 'center' }}>Nothing matches “{q}”.</X> :
    <View style={{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, paddingHorizontal: 14 }}>{shown.map((o, i, options) =>
    <Pressable key={o.v} accessibilityRole="button" onPress={() => onPick(o.v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, borderBottomWidth: i < options.length - 1 ? 1 : 0, borderBottomColor: T.zinc2 }}>
      <View style={{ flex: 1 }}><X s={15} w={6}>{o.v}</X>{o.sub && <X s={12.5} c={T.slate}>{o.sub}</X>}</View>
      {o.v === value && <Ic n="check" size={20} color={T.live} />}</Pressable>)}</View>}
  </View>;
}
