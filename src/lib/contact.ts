/**
 * How to reach the people who run the platform.
 *
 * Kept in one place, and overridable through the environment, so a deployment
 * run by someone else does not have to edit source to put its own details on
 * the footer and the legal pages.
 *
 * Safe to import from a Client Component: these are published contact details,
 * not secrets, so they are read from `process.env` directly rather than through
 * `lib/env.ts`, which is server-only by design.
 */
export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'iskandarovfayozbek099@gmail.com',
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE || '+998995900587',
} as const;

/** `+998995900587` reads as `+998 99 590 05 87`. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 12 || !digits.startsWith('998')) return phone;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
}

export const CONTACT_PHONE_DISPLAY = formatPhone(CONTACT.phone);
export const CONTACT_TEL_HREF = `tel:${CONTACT.phone.replace(/\s/g, '')}`;
export const CONTACT_MAIL_HREF = `mailto:${CONTACT.email}`;
