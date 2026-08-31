import crypto from 'crypto';
import { hashPassphrase } from './auth';

/**
 * Generates the two secrets the server needs.
 *
 *   npm run passphrase                 → random passphrase + its hash + AUTH_SECRET
 *   npm run passphrase -- "my words"   → hash for a passphrase you choose
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i ambiguity

function randomPassphrase(groups = 4, len = 5): string {
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    out.push(s);
  }
  return out.join('-');
}

const chosen = process.argv.slice(2).join(' ').trim();
const passphrase = chosen || randomPassphrase();
const hash = hashPassphrase(passphrase);
const secret = crypto.randomBytes(48).toString('base64url');

console.log('');
console.log(chosen ? 'Passphrase (as given):' : 'Passphrase (save this in your password manager — it is not stored anywhere):');
console.log(`  ${passphrase}`);
console.log('');
console.log('Environment variables for the server:');
console.log(`  OWNER_PASSPHRASE_HASH=${hash}`);
console.log(`  AUTH_SECRET=${secret}`);
console.log('');
