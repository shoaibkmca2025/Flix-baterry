import React, { useState } from 'react';
import { View, Pressable, TextInput, Platform } from 'react-native';
import { T } from './theme';
import { X, Ic, Btn } from './kit';

type PState = { pressed: boolean; hovered?: boolean };
const noOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null; // focus shows on the box border instead

/**
 * The list a dropdown opens: in the dealer app's bottom sheets and the console's dialogs.
 * One tap picks and closes. The current choice is tinted and ticked in the selection colour
 * (steel, as in the tab bar and sidebar; green means "approved" in this app). Lists longer than
 * a screenful get a search box that filters as you type and matches the grey detail line too,
 * e.g. "13 plates"; Return picks the only match.
 */
export function PickList({ options, value, onPick, search }: { options: { v: string; sub?: string }[]; value: string; onPick: (v: string) => void; search?: string }) {
  const [q, setQ] = useState(''), [focus, setFocus] = useState(false);
  const showSearch = search !== undefined || options.length > 8;
  const n = q.trim().toLowerCase();
  const shown = n ? options.filter(o => o.v.toLowerCase().includes(n) || (o.sub ?? '').toLowerCase().includes(n)) : options;
  return <View>
    {showSearch && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: T.white, borderWidth: 1.5, borderColor: focus ? T.steel : q ? T.ink3 : T.line, borderRadius: 10, paddingLeft: 12, marginBottom: 10, minHeight: 46 }}>
      <Ic n="search" size={18} color={T.slate} />
      <TextInput value={q} onChangeText={setQ} placeholder={search || 'Search'} placeholderTextColor={T.slate} accessibilityLabel={search || 'Search'}
        autoCorrect={false} autoCapitalize="none" returnKeyType="done" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onSubmitEditing={() => { if (shown.length === 1) onPick(shown[0]!.v); }}
        style={[{ flex: 1, fontSize: 16, color: T.ink, paddingVertical: 10 }, noOutline]} />
      {!!q && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={4}
        style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><Ic n="x" size={18} color={T.slate} /></Pressable>}
    </View>}
    {!shown.length
      ? <View style={{ alignItems: 'center', gap: 10, paddingVertical: 18, paddingHorizontal: 14 }}>
          <X s={14.5} c={T.slate} style={{ textAlign: 'center' }}>Nothing matches “{q.trim()}”. Check the spelling, or clear the search to see all {options.length}.</X>
          <Btn kind="ghost" sm label="Clear search" onPress={() => setQ('')} /></View>
      : <View role="list" style={{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, overflow: 'hidden' }}>{shown.map((o, i) => {
          const on = o.v === value;
          return <Pressable key={o.v} accessibilityRole="button" accessibilityLabel={o.sub ? `${o.v}, ${o.sub}` : o.v} accessibilityState={{ selected: on }} onPress={() => onPick(o.v)}
            style={({ pressed, hovered }: PState) => [{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 14, minHeight: 50, backgroundColor: on ? T.steelSoft : T.white },
              !on && (pressed || hovered) && { backgroundColor: T.zinc }, on && pressed && { opacity: 0.8 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <X s={15.5} w={on ? 7 : 6}>{o.v}</X>
              {!!o.sub && <X s={12.5} c={T.slate} style={{ marginTop: 1 }}>{o.sub}</X>}
            </View>
            {on && <Ic n="check" size={20} color={T.steel} sw={2.4} />}
            {i < shown.length - 1 && <View pointerEvents="none" style={{ position: 'absolute', left: 14, right: 0, bottom: 0, height: 1, backgroundColor: T.zinc2 }} />}
          </Pressable>;
        })}</View>}
  </View>;
}
