'use client';

import { useState, type ComponentPropsWithoutRef } from 'react';
import { flushSync } from 'react-dom';
import { formatDecimalInput } from '@/shared/lib/display-amount';

export function DecimalDisplayInput({
  value,
  precision,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentPropsWithoutRef<'input'>, 'value'> & { value: string; precision?: number }) {
  const [editing, setEditing] = useState(false);
  return <input {...props}
    value={precision === undefined || editing ? value : formatDecimalInput(value, precision)}
    onFocus={event => {
      // Set the editable text before the browser chooses the selection for typing or paste.
      if (precision !== undefined) {
        flushSync(() => setEditing(true));
        event.currentTarget.select();
      }
      onFocus?.(event);
    }}
    onBlur={event => {
      if (precision !== undefined) setEditing(false);
      onBlur?.(event);
    }}
  />;
}
