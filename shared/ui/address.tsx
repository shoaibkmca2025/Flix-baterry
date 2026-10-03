import React from 'react';
import { View } from 'react-native';
import { INDIA, STATES, districtsOf, withState, type Address, type AddressErrors } from '../india';
import { Field, Label, Hint } from './kit';

/** the phone stacks its fields; the console passes its own two-column Row */
const Stack = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;

type PickerProps = {
  label: string; value: string; options: string[]; onPick: (v: string) => void;
  req?: boolean; error?: string; hint?: string; ph: string; disabled?: boolean;
  /** how the app opens a list — a bottom sheet on the phone, a dialog in the console */
  open: (p: { title: string; options: string[]; value: string; onPick: (v: string) => void }) => void;
};
const Picker = ({ label, value, options, onPick, req, error, hint, ph, disabled, open }: PickerProps) =>
  <Field select label={label} req={req} value={value} ph={ph} error={error} hint={hint} hintIcon="pin"
    onPress={disabled ? undefined : () => open({ title: label, options, value, onPick })} />;

/**
 * Where a shop is: State, then District, then the town typed by hand (client, 4 Oct 2026).
 *
 * States and districts are a finite list and are picked from it, with a search box once the list
 * is long — 722 districts means nobody scrolls. A town is typed: India has tens of thousands of
 * them and inventing a list would have people picking places that do not exist.
 *
 * `open` is passed in because the two apps open a list differently — the phone slides a sheet up
 * from the bottom, the console opens a dialog — and neither should be imported into the other.
 */
export function AddressBlock({ value, onChange, errors = {}, open, Row = Stack }: {
  value: Address; onChange: (a: Address) => void; errors?: AddressErrors;
  open: PickerProps['open'];
  /** the console lays two fields side by side; the phone stacks them */
  Row?: (p: { children?: React.ReactNode }) => React.ReactElement;
}) {
  const districts = districtsOf(value.state);
  return <>
    <Row>
      <Picker label="State" req open={open} value={value.state} options={STATES} ph="Choose the state"
        error={errors.state} onPick={s => onChange(withState(value, s))} />
      <Picker label="District" req open={open} value={value.district} options={districts} disabled={!value.state}
        ph={value.state ? `Choose from ${districts.length} districts` : 'Choose the state first'}
        error={errors.district} onPick={district => onChange({ ...value, district })} />
    </Row>
    <Row>
      <Field label="Town or city" req value={value.city} onChange={city => onChange({ ...value, city })}
        ph={value.district ? `In ${value.district}` : 'Town or city'} error={errors.city} />
      <Field label="Place / area" value={value.place} onChange={place => onChange({ ...value, place })} ph="Road or area" />
    </Row>
    <Field label="Full address" req value={value.address} onChange={address => onChange({ ...value, address })}
      ph="Shop number, building, road" error={errors.address} multiline />
  </>;
}

export { INDIA, STATES, districtsOf, addressErrors, emptyAddress, withState, type Address, type AddressErrors } from '../india';
