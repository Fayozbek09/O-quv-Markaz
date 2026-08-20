import { redirect } from 'next/navigation';

/**
 * Verification always happens inside the flow that needed it (registration or
 * password reset), so a bare /verify has no state to act on.
 */
export default function VerifyPage() {
  redirect('/register');
}
