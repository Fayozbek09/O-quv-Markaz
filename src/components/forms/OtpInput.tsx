'use client';

import { useId, useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * Six single-character boxes that behave like one field: paste fills them all,
 * Backspace steps back, and arrow keys move between them.
 */
export function OtpInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const groupId = useId();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  function setAt(index: number, char: string) {
    const next = digits.map((d, i) => (i === index ? char : d)).join('').replace(/ /g, '');
    onChange(next.slice(0, 6));
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const char = event.target.value.replace(/\D/g, '').slice(-1);
    if (!char) return;
    const chars = digits.slice();
    chars[index] = char;
    onChange(chars.join('').replace(/ /g, '').slice(0, 6));
    refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]?.trim()) setAt(index, ' ');
      else refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft') refs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight') refs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  }

  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="text-[13px] font-medium text-ink-soft">{label}</legend>
      <div className="flex gap-2" role="group" aria-labelledby={groupId}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            value={digit.trim()}
            onChange={(e) => handleChange(index, e)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`${label} ${index + 1}`}
            autoFocus={index === 0}
            className="field h-12 w-full px-0 text-center text-lg font-semibold tabular-nums"
          />
        ))}
      </div>
    </fieldset>
  );
}
