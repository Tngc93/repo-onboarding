import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Create a throwaway repository from a { 'path': 'content' } map. */
export function fixture(files, { git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'repo-onboarding-'));
  write(root, files);
  if (git) {
    const run = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'test@example.invalid');
    run('config', 'user.name', 'test');
    run('add', '-A');
    run('commit', '-q', '-m', 'init');
  }
  return root;
}

export function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

export const nodeRepo = () => ({
  'package.json': {
    name: 'shop',
    description: 'A small storefront.',
    scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', lint: 'eslint .', 'db:push': 'prisma db push' },
    dependencies: { next: '15.0.0', react: '19.0.0', '@prisma/client': '6.0.0' },
    devDependencies: { vitest: '2.0.0', typescript: '5.6.0', eslint: '9.0.0' },
  },
  'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  '.nvmrc': 'v20\n',
  'src/app/page.tsx': 'export default function Page() { return null }\n',
  'src/app/api/orders/route.ts': 'export async function GET() {}\n',
  'src/lib/db.ts': 'export const db = {}\n',
  'src/components/Button.tsx': 'export const Button = () => null\n',
  'prisma/schema.prisma': 'model Order { id Int @id }\n',
  'test/order.test.ts': 'test("x", () => {})\n',
  '.env.example': 'DATABASE_URL=postgres://localhost/shop\nexport STRIPE_SECRET_KEY=\n# comment\nlower_case=1\n',
  '.github/workflows/ci.yml': 'name: CI\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm install --frozen-lockfile\n      - name: checks\n        run: |\n          pnpm lint\n          pnpm test\n      - run: echo ${{ secrets.X }}\n',
  LICENSE: 'MIT License\n\nCopyright (c) 2026\n',
});
