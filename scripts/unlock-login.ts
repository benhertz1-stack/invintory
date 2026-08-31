/**
 * Clears the global login lockout (meta/auth_lockout) — use if repeated wrong
 * passcodes (yours or someone else's) have locked the sign-in page.
 *   npm run unlock
 */
import 'dotenv/config';
import { getDb } from '../server/db';

(async () => {
  const ref = getDb().collection('meta').doc('auth_lockout');
  const before = (await ref.get()).data();
  console.log('before:', JSON.stringify(before ?? {}));
  await ref.set({ failures: 0, lockedUntil: 0, lastFailureAt: 0 });
  console.log('login lockout cleared');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
