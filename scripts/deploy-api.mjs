// Deploy the backend to Neon.
//
// `neon deploy --env <file>` loads that file for evaluating neon.ts, but NOT for authenticating
// the CLI itself — so a NEON_API_KEY sitting in backend/.env is ignored and the CLI falls back to
// whatever account is signed in locally, which is how a deploy ends up refused with "not an
// organization member" (2 Oct 2026). This reads the same file and puts the key in the real
// environment first, then runs the deploy, so there is one command and no account to remember.
//
// backend/.env is gitignored. Nothing here is written anywhere else.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(root, 'backend', '.env');

let text;
try {
  text = readFileSync(envFile, 'utf8');
} catch {
  console.error(`Cannot read ${envFile}. The deploy needs it for DATABASE_URL, JWT_SECRET and NEON_API_KEY.`);
  process.exit(1);
}

for (const line of text.split('\n')) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!m) continue;
  // strip surrounding quotes and any trailing comment on an unquoted value
  const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  process.env[m[1]] ??= value;
}

if (!process.env.NEON_API_KEY) {
  console.error('NEON_API_KEY is not in backend/.env. Create a project-scoped key at console.neon.tech → Settings → API keys.');
  process.exit(1);
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// backend is NOT an npm workspace, so a root `npm install` never reaches it — a dependency added
// there is missing at bundle time until this runs (that is what broke the 2 Oct deploy).
run('npm', ['install', '--prefix', 'backend']);
run('npm', ['run', 'db:migrate', '--prefix', 'backend']);

const projectId = process.env.NEON_PROJECT_ID;
run('npx', [
  'neon', 'deploy',
  '--env', 'backend/.env',
  ...(projectId ? ['--project-id', projectId] : []),
  // non-interactive: answer the "overwrite?" and "protected branch?" prompts, and do not write a
  // local .env.local over the one we just read
  '--update-existing', '--allow-protected', '--no-env-pull',
]);

console.log('\nDeployed. Check it landed with:  npx neon functions get api' + (projectId ? ` --project-id ${projectId}` : ''));
