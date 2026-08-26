#!/usr/bin/env node
// `tsc --noEmit` on a fresh checkout — CI, or anyone who hasn't run `expo start`
// yet — fails with TS2882 on `import '../global.css'`, because the `*.css`
// module declaration comes from `expo/types`, referenced only from
// `expo-env.d.ts`, which Expo writes on `expo start` and gitignores by
// convention. Recreate that one-line file when it's missing, then typecheck.
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_DTS = join(ROOT, 'expo-env.d.ts');

if (!existsSync(ENV_DTS)) {
  writeFileSync(
    ENV_DTS,
    '/// <reference types="expo/types" />\n\n// NOTE: This file should not be edited and should be in your git ignore',
  );
  console.log('typecheck: wrote expo-env.d.ts (fresh checkout)');
}

const result = spawnSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
