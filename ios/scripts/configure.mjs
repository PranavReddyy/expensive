import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
const root = new URL('../../', import.meta.url);
const target = new URL('../Config/Local.xcconfig', import.meta.url);
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('Local.xcconfig already exists; kept existing settings.');
} else {
  const env = {};
  for (const file of ['.env', '.env.local']) {
    const url = new URL(file, root);
    if (existsSync(url)) Object.assign(env, parseEnv(readFileSync(url, 'utf8')));
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !url.startsWith('https://') || /[\r\n]/.test(url + key)) throw new Error('Add the public Supabase URL and key to the web .env first.');
  const firebase = env.NEXT_PUBLIC_FIREBASE_API_KEY || '';
  const appURL = env.NEXT_PUBLIC_APP_URL || 'https://expensive.itsbypranav.com';
  const identityURL = env.NEXT_PUBLIC_IDENTITY_URL || appURL;
  if (![appURL, identityURL].every(value => value.startsWith('https://')) || /[\r\n]/.test(firebase + appURL + identityURL)) throw new Error('Native app URLs must use HTTPS.');
  writeFileSync(target, `// Generated local public-client configuration. Do not put service role keys here.\nSUPABASE_URL = ${url.replace('https://','https:/$()/')}\nSUPABASE_ANON_KEY = ${key}\nFIREBASE_API_KEY = ${firebase}\nAPP_URL = ${appURL.replace('https://','https:/$()/')}\nIDENTITY_URL = ${identityURL.replace('https://','https:/$()/')}\n`);
  console.log('Configured native app using the existing public Supabase settings.');
}
