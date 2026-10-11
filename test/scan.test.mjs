import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, nodeRepo, write } from './helpers.mjs';
import { justRecipes, makeTargets, scan } from '../src/scan.mjs';
import { renderFacts } from '../src/render.mjs';
import { parseToml } from '../src/toml.mjs';

const cmd = (facts, command) => facts.commands.find((c) => c.command === command);

test('node: package manager from lockfile, scripts, frameworks, runtime', () => {
  const f = scan(fixture(nodeRepo()));
  assert.equal(f.packageManager.name, 'pnpm');
  assert.equal(f.packageManager.evidence, 'pnpm-lock.yaml');
  assert.deepEqual(f.runtimes, ['Node.js 20']);
  for (const fw of ['Next.js', 'React', 'Prisma', 'Vitest', 'TypeScript', 'ESLint']) assert.ok(f.frameworks.includes(fw), fw);
  assert.equal(cmd(f, 'pnpm install').task, 'Install dependencies');
  assert.equal(cmd(f, 'pnpm dev').task, 'Dev server');
  assert.equal(cmd(f, 'pnpm test').task, 'Test');
  assert.equal(cmd(f, 'pnpm db:push').task, 'Database: push');
  assert.equal(f.name, 'shop');
  assert.equal(f.license, 'MIT');
});

test('node: npm script syntax, lifecycle scripts skipped, npm ci with a lockfile', () => {
  const root = fixture({
    'package.json': { scripts: { test: 'x', start: 'x', build: 'x', prebuild: 'x', postinstall: 'x', 'test:e2e': 'x' } },
    'package-lock.json': '{}',
  });
  const f = scan(root);
  assert.ok(cmd(f, 'npm ci'));
  assert.ok(cmd(f, 'npm test'));
  assert.ok(cmd(f, 'npm start'));
  assert.ok(cmd(f, 'npm run build'));
  assert.equal(cmd(f, 'npm run test:e2e').task, 'End-to-end tests');
  assert.equal(cmd(f, 'npm run prebuild'), undefined);
  assert.equal(cmd(f, 'npm run postinstall'), undefined);
});

test('node: yarn and bun runners, packageManager field without a lockfile', () => {
  assert.ok(cmd(scan(fixture({ 'package.json': { scripts: { dev: 'x' } }, 'yarn.lock': '' })), 'yarn dev'));
  assert.ok(cmd(scan(fixture({ 'package.json': { scripts: { dev: 'x' } }, 'bun.lock': '' })), 'bun run dev'));
  const f = scan(fixture({ 'package.json': { packageManager: 'pnpm@9.1.0', scripts: { dev: 'x' } } }));
  assert.equal(f.packageManager.name, 'pnpm');
  assert.match(f.packageManager.evidence, /packageManager/);
});

test('node: workspaces resolve to real packages', () => {
  const f = scan(fixture({
    'package.json': { workspaces: ['apps/*', 'packages/*'] },
    'package-lock.json': '{}',
    'turbo.json': '{}',
    'apps/web/package.json': { name: '@shop/web' },
    'packages/ui/package.json': { name: '@shop/ui' },
    'packages/ui/src/index.ts': '',
  }));
  assert.equal(f.workspaces.tool, 'npm workspaces + Turborepo');
  assert.deepEqual(f.workspaces.packages, [
    { path: 'apps/web', name: '@shop/web' },
    { path: 'packages/ui', name: '@shop/ui' },
  ]);
});

test('node: pnpm-workspace.yaml', () => {
  const f = scan(fixture({
    'package.json': {},
    'pnpm-lock.yaml': '',
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"!apps/legacy\"\n",
    'apps/api/package.json': { name: 'api' },
  }));
  assert.equal(f.workspaces.tool, 'pnpm workspaces');
  assert.deepEqual(f.workspaces.packages.map((p) => p.path), ['apps/api']);
});

test('python: uv, ruff, pytest, mypy and project scripts', () => {
  const f = scan(fixture({
    'pyproject.toml': `[project]
name = "billing"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",   # web
  "sqlalchemy[asyncio]",
]

[project.scripts]
billing = "billing.cli:main"

[dependency-groups]
dev = ["pytest>=8", "mypy"]

[tool.ruff]
line-length = 100
`,
    'uv.lock': '',
    'src/billing/__init__.py': '',
    'tests/test_invoices.py': '',
  }));
  assert.equal(f.pythonTool.name, 'uv');
  assert.deepEqual(f.runtimes, ['Python >=3.11']);
  for (const fw of ['FastAPI', 'SQLAlchemy', 'pytest', 'mypy', 'Ruff']) assert.ok(f.frameworks.includes(fw), fw);
  assert.ok(cmd(f, 'uv sync'));
  assert.equal(cmd(f, 'uv run pytest').task, 'Test');
  assert.equal(cmd(f, 'uv run ruff check .').task, 'Lint');
  assert.equal(cmd(f, 'uv run mypy .').task, 'Type check');
  assert.ok(cmd(f, 'uv run billing'));
  assert.equal(f.name, 'billing');
});

test('python: requirements.txt and Django', () => {
  const f = scan(fixture({ 'requirements.txt': 'Django==5.0\n# pinned\n-r base.txt\n', 'manage.py': '' }));
  assert.ok(f.frameworks.includes('Django'));
  assert.ok(cmd(f, 'pip install -r requirements.txt'));
  assert.ok(cmd(f, 'python manage.py runserver'));
  assert.equal(cmd(f, 'python manage.py test').task, 'Test');
});

test('python: Poetry', () => {
  const f = scan(fixture({
    'pyproject.toml': '[tool.poetry]\nname = "x"\n[tool.poetry.dependencies]\npython = "^3.12"\nflask = "^3"\n[tool.poetry.group.dev.dependencies]\npytest = "*"\n',
    'poetry.lock': '',
  }));
  assert.equal(f.pythonTool.name, 'Poetry');
  assert.ok(cmd(f, 'poetry install'));
  assert.ok(cmd(f, 'poetry run pytest'));
  assert.ok(f.frameworks.includes('Flask'));
});

test('go, rust, jvm, dotnet, ruby', () => {
  const go = scan(fixture({ 'go.mod': 'module example.com/api\n\ngo 1.22\n\nrequire github.com/go-chi/chi/v5 v5.0.0\n', 'cmd/api/main.go': '', '.golangci.yml': '' }));
  assert.deepEqual(go.runtimes, ['Go 1.22']);
  assert.ok(go.frameworks.includes('chi'));
  assert.ok(cmd(go, 'go test ./...'));
  assert.ok(cmd(go, 'golangci-lint run'));
  assert.deepEqual(go.entryPoints, ['cmd/api/main.go']);

  const rust = scan(fixture({ 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n[workspace.dependencies]\ntokio = { version = "1", features = ["full"] }\n', 'rust-toolchain.toml': '[toolchain]\nchannel = "1.80"\n' }));
  assert.equal(rust.workspaces.tool, 'Cargo workspace');
  assert.ok(rust.frameworks.includes('Tokio'));
  assert.deepEqual(rust.runtimes, ['Rust 1.80']);
  assert.ok(cmd(rust, 'cargo clippy --all-targets'));

  const jvm = scan(fixture({ 'build.gradle.kts': 'plugins { id("org.springframework.boot") }', gradlew: '' }));
  assert.ok(cmd(jvm, './gradlew test'));
  assert.ok(jvm.frameworks.includes('Spring Boot'));

  const net = scan(fixture({ 'Shop.sln': '', 'src/Shop/Shop.csproj': '' }));
  assert.ok(cmd(net, 'dotnet test'));

  const rb = scan(fixture({ Gemfile: "gem 'rails'\ngem 'rspec-rails'\n", 'bin/dev': '' }));
  assert.ok(rb.frameworks.includes('Rails'));
  assert.ok(cmd(rb, 'bin/dev'));
  assert.ok(cmd(rb, 'bundle exec rspec'));
});

test('Makefile and justfile targets', () => {
  const mk = 'VAR := 1\n.PHONY: test\nall: build\nbuild:\n\tgo build\ntest: build\n\tgo test\n%.o: %.c\n\tcc\ndist/app: x\n';
  assert.deepEqual(makeTargets(mk), ['all', 'build', 'test']);
  assert.deepEqual(justRecipes('set dotenv-load\n\ntest *args:\n  cargo test {{args}}\n\n@fmt:\n  cargo fmt\nalias t := test\n'), ['test', 'fmt']);
  const f = scan(fixture({ Makefile: mk }));
  assert.equal(cmd(f, 'make test').task, 'Test');
});

test('environment variable names only, never values', () => {
  const f = scan(fixture(nodeRepo()));
  assert.deepEqual(f.env, { file: '.env.example', vars: ['DATABASE_URL', 'STRIPE_SECRET_KEY'] });
  assert.doesNotMatch(renderFacts(f), /postgres:\/\//);
});

test('CI: run commands from single and block steps; expressions dropped', () => {
  const f = scan(fixture(nodeRepo()));
  assert.deepEqual(f.ci, [{ file: '.github/workflows/ci.yml', name: 'CI', runs: ['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm test'] }]);
});

test('existing agent docs are found', () => {
  const f = scan(fixture({ 'CLAUDE.md': '', '.cursorrules': '', 'packages/a/AGENTS.md': '', '.github/copilot-instructions.md': '' }));
  assert.deepEqual(f.agentDocs.map((d) => d.kind).sort(), ['AGENTS.md', 'CLAUDE.md', 'Copilot instructions', 'Cursor rules']);
});

test('layout: notes, expanded source folders, sub-projects', () => {
  const f = scan(fixture({
    ...nodeRepo(),
    'server/package.json': { dependencies: { express: '4' } },
    'server/index.js': '',
  }));
  const paths = f.layout.map((d) => d.path);
  assert.deepEqual(paths, ['.github/', 'prisma/', 'server/', 'src/', 'test/']);
  assert.equal(f.layout.find((d) => d.path === 'server/').note, 'server code, own package.json: Express');
  assert.deepEqual(f.layout.find((d) => d.path === 'src/').children.map((c) => c.path), ['src/app/', 'src/components/', 'src/lib/']);
});

test('git listing respects .gitignore and skips node_modules', () => {
  const root = fixture({
    ...nodeRepo(),
    '.gitignore': 'generated/\n',
    'generated/big.ts': '',
    'node_modules/x/index.js': '',
  }, { git: true });
  write(root, { 'scratch/new.ts': '' }); // untracked but not ignored: included
  const paths = scan(root).layout.map((d) => d.path);
  assert.ok(paths.includes('scratch/'));
  assert.ok(!paths.includes('generated/'));
  assert.ok(!paths.includes('node_modules/'));
});

test('language order is stable: primary first, rest alphabetical', () => {
  const files = {};
  for (let i = 0; i < 10; i++) files[`src/a${i}.ts`] = '';
  for (let i = 0; i < 4; i++) files[`scripts/s${i}.sh`] = '';
  for (let i = 0; i < 5; i++) files[`py/p${i}.py`] = '';
  assert.deepEqual(scan(fixture(files)).languages, ['TypeScript', 'Python', 'Shell']);
  for (let i = 5; i < 9; i++) files[`scripts/s${i}.sh`] = '';
  assert.deepEqual(scan(fixture(files)).languages, ['TypeScript', 'Python', 'Shell']);
});

test('same repository, same rendered facts', () => {
  const root = fixture(nodeRepo());
  assert.equal(renderFacts(scan(root)), renderFacts(scan(root)));
});

test('toml: tables, arrays of tables, inline tables, strings and comments', () => {
  const t = parseToml(`
title = "a # not a comment" # comment
[server]
ports = [ 80,
  443, # https
]
opts = { tls = true, name = 'x' }
"quoted.key" = 1
[[bin]]
name = "one"
[[bin]]
name = "two"
[a.b]
c = """multi
line"""
`);
  assert.equal(t.title, 'a # not a comment');
  assert.deepEqual(t.server.ports, [80, 443]);
  assert.deepEqual(t.server.opts, { tls: true, name: 'x' });
  assert.equal(t.server['quoted.key'], 1);
  assert.deepEqual(t.bin.map((b) => b.name), ['one', 'two']);
  assert.equal(t.a.b.c, 'multi\nline');
});

test('an empty folder still gives a valid, non-empty block', () => {
  const out = renderFacts(scan(fixture({ 'notes.txt': 'hi' })));
  assert.match(out, /^## Stack/);
  assert.match(out, /No build manifest found/);
});
