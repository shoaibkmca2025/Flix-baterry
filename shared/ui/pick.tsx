import React from 'react';
import { View, Pressable } from 'react-native';
import { T } from './theme';
import { X, Ic } from './kit';

/** Picker list: used inside the dealer app's bottom sheets and the console's dialogs. */
export function PickList({ options, value, onPick }: { options: { v: string; sub?: string }[]; value: string; onPick: (v: string) => void }) {
  return <View style={{ backgroundColor: T.white, borderWidth: 1, borderColor: T.zinc2, borderRadius: 10, paddingHorizontal: 14 }}>{options.map((o, i) =>
    <Pressable key={o.v} accessibilityRole="button" onPress={() => onPick(o.v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, borderBottomWidth: i < options.length - 1 ? 1 : 0, borderBottomColor: T.zinc2 }}>
      <View style={{ flex: 1 }}><X s={15} w={6}>{o.v}</X>{o.sub && <X s={12.5} c={T.slate}>{o.sub}</X>}</View>
      {o.v === value && <Ic n="check" size={20} color={T.live} />}</Pressable>)}</View>;
}
