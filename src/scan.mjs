// Repository scanner: reads manifests, lockfiles, CI and folder structure and
// returns plain facts. No network, no code execution, nothing written.
// Every list is sorted so the same repository always gives the same facts.
import { basename, resolve } from 'node:path';
import { commitsSince, exists, listFiles, readJson, readText } from './files.mjs';
import { parseToml } from './toml.mjs';

const LANGS = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift', m: 'Objective-C', cs: 'C#', fs: 'F#', php: 'PHP', c: 'C', h: 'C',
  cpp: 'C++', cc: 'C++', hpp: 'C++', scala: 'Scala', dart: 'Dart', ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang', clj: 'Clojure', hs: 'Haskell', lua: 'Lua', r: 'R', jl: 'Julia', zig: 'Zig',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro', sql: 'SQL', sh: 'Shell', bash: 'Shell',
  css: 'CSS', scss: 'SCSS', html: 'HTML', tf: 'Terraform', sol: 'Solidity', gd: 'GDScript',
};

// Folder name -> short description. Only used when the name is unambiguous.
const DIR_NOTES = {
  src: 'source code', lib: 'library code', app: 'application code', apps: 'deployable apps',
  packages: 'workspace packages', components: 'UI components', pages: 'page routes',
  public: 'static assets served as-is', static: 'static assets', assets: 'images, fonts and other assets',
  styles: 'stylesheets', hooks: 'hooks', utils: 'shared helpers', helpers: 'shared helpers',
  server: 'server code', api: 'API handlers', routes: 'route handlers', models: 'data models',
  services: 'service layer', store: 'state management', types: 'shared type definitions',
  test: 'tests', tests: 'tests', __tests__: 'tests', spec: 'tests', e2e: 'end-to-end tests',
  cypress: 'Cypress tests', playwright: 'Playwright tests', fixtures: 'test fixtures',
  docs: 'documentation', doc: 'documentation', examples: 'usage examples', example: 'usage examples',
  scripts: 'project scripts', cli: 'command-line entry point', tools: 'developer tooling', bin: 'executables', cmd: 'command entry points',
  internal: 'private packages', pkg: 'public packages', config: 'configuration', configs: 'configuration',
  prisma: 'Prisma schema and migrations', migrations: 'database migrations', db: 'database code',
  supabase: 'Supabase config and migrations', infra: 'infrastructure as code', terraform: 'Terraform',
  deploy: 'deployment config', k8s: 'Kubernetes manifests', helm: 'Helm charts', charts: 'Helm charts',
  '.github': 'GitHub workflows and templates', '.husky': 'git hooks', '.storybook': 'Storybook config',
  '.claude': 'Claude Code settings, skills and commands', '.codex': 'Codex settings',
  '.cursor': 'Cursor rules', '.devcontainer': 'dev container config', '.vscode': 'editor settings',
  locales: 'translations', i18n: 'translations', messages: 'translations', content: 'content files',
  data: 'data files', notebooks: 'notebooks', benchmarks: 'benchmarks', benches: 'benchmarks',
  crates: 'workspace crates', proto: 'protobuf definitions', android: 'Android app', ios: 'iOS app',
  native: 'native code', vendor: 'vendored dependencies', templates: 'templates', views: 'views',
  controllers: 'controllers', middleware: 'middleware', jobs: 'background jobs', workers: 'workers',
  skills: 'agent skills', plugins: 'plugins', schemas: 'schemas', specs: 'specifications',
  '.claude-plugin': 'Claude Code plugin manifest', '.codex-plugin': 'Codex plugin manifest',
  frontend: 'frontend app', backend: 'backend service', client: 'client app', web: 'web app',
  mobile: 'mobile app', shared: 'shared code', common: 'shared code', core: 'core logic', features: 'feature modules',
};

const NODE_FRAMEWORKS = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@remix-run/react', 'Remix'], ['@sveltejs/kit', 'SvelteKit'],
  ['astro', 'Astro'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['solid-js', 'Solid'],
  ['@angular/core', 'Angular'], ['react-native', 'React Native'], ['expo', 'Expo'], ['electron', 'Electron'],
  ['express', 'Express'], ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'], ['hono', 'Hono'], ['koa', 'Koa'],
  ['vite', 'Vite'], ['webpack', 'webpack'], ['tailwindcss', 'Tailwind CSS'], ['@prisma/client', 'Prisma'],
  ['prisma', 'Prisma'], ['drizzle-orm', 'Drizzle'], ['typeorm', 'TypeORM'], ['mongoose', 'Mongoose'],
  ['@trpc/server', 'tRPC'], ['graphql', 'GraphQL'], ['zod', 'Zod'], ['vitest', 'Vitest'], ['jest', 'Jest'],
  ['mocha', 'Mocha'], ['@playwright/test', 'Playwright'], ['cypress', 'Cypress'], ['storybook', 'Storybook'],
  ['typescript', 'TypeScript'], ['eslint', 'ESLint'], ['prettier', 'Prettier'], ['@biomejs/biome', 'Biome'],
  ['turbo', 'Turborepo'], ['nx', 'Nx'],
];

const PY_FRAMEWORKS = [
  ['django', 'Django'], ['flask', 'Flask'], ['fastapi', 'FastAPI'], ['starlette', 'Starlette'],
  ['sqlalchemy', 'SQLAlchemy'], ['pydantic', 'Pydantic'], ['celery', 'Celery'], ['pytest', 'pytest'],
  ['ruff', 'Ruff'], ['black', 'Black'], ['mypy', 'mypy'], ['pandas', 'pandas'], ['numpy', 'NumPy'],
  ['torch', 'PyTorch'], ['tensorflow', 'TensorFlow'], ['scikit-learn', 'scikit-learn'],
  ['streamlit', 'Streamlit'], ['langchain', 'LangChain'], ['anthropic', 'Anthropic SDK'], ['openai', 'OpenAI SDK'],
  ['typer', 'Typer'], ['click', 'Click'],
];

const GO_FRAMEWORKS = [
  ['github.com/gin-gonic/gin', 'Gin'], ['github.com/labstack/echo', 'Echo'], ['github.com/gofiber/fiber', 'Fiber'],
  ['github.com/go-chi/chi', 'chi'], ['github.com/spf13/cobra', 'Cobra'], ['gorm.io/gorm', 'GORM'],
  ['google.golang.org/grpc', 'gRPC'],
];

const RUST_FRAMEWORKS = [
  ['tokio', 'Tokio'], ['axum', 'Axum'], ['actix-web', 'Actix Web'], ['rocket', 'Rocket'], ['serde', 'Serde'],
  ['clap', 'clap'], ['sqlx', 'SQLx'], ['diesel', 'Diesel'], ['tauri', 'Tauri'], ['bevy', 'Bevy'],
];

const AGENT_DOCS = [
  [/(^|\/)AGENTS\.md$/, 'AGENTS.md'],
  [/(^|\/)CLAUDE\.md$/, 'CLAUDE.md'],
  [/(^|\/)CLAUDE\.local\.md$/, 'CLAUDE.local.md'],
  [/^\.claude\/CLAUDE\.md$/, 'CLAUDE.md'],
  [/(^|\/)GEMINI\.md$/, 'GEMINI.md'],
  [/^\.cursorrules$/, 'Cursor rules'],
  [/^\.cursor\/rules\/.+\.mdc?$/, 'Cursor rules'],
  [/^\.github\/copilot-instructions\.md$/, 'Copilot instructions'],
  [/^\.github\/instructions\/.+\.md$/, 'Copilot instructions'],
  [/^\.windsurfrules$/, 'Windsurf rules'],
  [/^\.clinerules/, 'Cline rules'],
];

const ENV_EXAMPLES = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.local.example', '.env.development.example', 'example.env'];

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (arr) => [...new Set(arr)];

// ------------------------------------------------------------------ languages
function languages(files) {
  const counts = {};
  for (const f of files) {
    const ext = f.includes('.') ? f.slice(f.lastIndexOf('.') + 1).toLowerCase() : '';
    const lang = LANGS[ext];
    if (!lang) continue;
    if (/(^|\/)(vendor|third_party|generated|__generated__)\//.test(f) || /\.min\.js$|\.d\.ts$/.test(f)) continue;
    counts[lang] = (counts[lang] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const ranked = Object.entries(counts)
    .filter(([, n]) => n >= 3 || n / total >= 0.1)
    .sort((a, b) => b[1] - a[1] || byName(a[0], b[0]));
  if (!ranked.length) return [];
  // The primary language leads; the rest are alphabetical so small shifts in
  // file counts do not reorder the list and mark the docs as stale.
  const [first, ...rest] = ranked.slice(0, 6).map(([n]) => n);
  return [first, ...rest.sort(byName)];
}

// ------------------------------------------------------------------ node
function nodeFacts(root, files, facts) {
  const pkg = readJson(root, 'package.json');
  if (!pkg) return;
  facts.manifests.push('package.json');
  let pm = 'npm';
  let evidence = 'package.json';
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  if (exists(root, 'pnpm-lock.yaml')) [pm, evidence] = ['pnpm', 'pnpm-lock.yaml'];
  else if (exists(root, 'yarn.lock')) [pm, evidence] = ['yarn', 'yarn.lock'];
  else if (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) [pm, evidence] = ['bun', exists(root, 'bun.lock') ? 'bun.lock' : 'bun.lockb'];
  else if (exists(root, 'package-lock.json')) [pm, evidence] = ['npm', 'package-lock.json'];
  else if (declared && ['pnpm', 'yarn', 'bun', 'npm'].includes(declared)) [pm, evidence] = [declared, '"packageManager" in package.json'];
  facts.packageManager = { name: pm, evidence };

  const nodeVersion = readText(root, '.nvmrc')?.trim() || readText(root, '.node-version')?.trim() || pkg.engines?.node;
  if (nodeVersion) facts.runtimes.push(`Node.js ${nodeVersion.replace(/^v/, '')}`);

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) };
  for (const [dep, label] of NODE_FRAMEWORKS) if (deps[dep]) facts.frameworks.push(label);

  // workspaces
  let ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
  let wsTool = ws ? `${pm} workspaces` : null;
  const pnpmWs = readText(root, 'pnpm-workspace.yaml');
  if (pnpmWs) {
    ws = [...pnpmWs.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1]).filter((g) => !g.startsWith('!'));
    wsTool = 'pnpm workspaces';
  }
  if (ws?.length) {
    const tools = [wsTool];
    if (exists(root, 'turbo.json')) tools.push('Turborepo');
    if (exists(root, 'nx.json')) tools.push('Nx');
    if (exists(root, 'lerna.json')) tools.push('Lerna');
    facts.workspaces = { tool: tools.join(' + '), globs: ws.slice().sort(byName), packages: resolveWorkspaces(root, files, ws) };
  }

  const run = (name) => {
    if (pm === 'npm') return name === 'test' || name === 'start' ? `npm ${name}` : `npm run ${name}`;
    if (pm === 'bun') return `bun run ${name}`;
    return `${pm} ${name}`;
  };
  facts.commands.push({ task: 'Install dependencies', command: pm === 'npm' && evidence === 'package-lock.json' ? 'npm ci' : `${pm} install`, source: evidence });
  const scripts = pkg.scripts || {};
  for (const name of Object.keys(scripts)) {
    if (/^(pre|post)/.test(name) && scripts[name.replace(/^(pre|post)/, '')]) continue; // lifecycle hooks
    if (['prepare', 'postinstall', 'preinstall', 'install', 'prepublishOnly'].includes(name)) continue;
    facts.commands.push({ task: taskLabel(name), command: run(name), source: 'package.json', script: name });
  }
  for (const f of ['main', 'module', 'types']) if (typeof pkg[f] === 'string') facts.entryPoints.push(pkg[f].replace(/^\.\//, ''));
  if (typeof pkg.bin === 'string') facts.entryPoints.push(pkg.bin.replace(/^\.\//, ''));
  else if (pkg.bin) facts.entryPoints.push(...Object.values(pkg.bin).map((b) => String(b).replace(/^\.\//, '')));
  if (!facts.license && typeof pkg.license === 'string') facts.license = pkg.license;
  if (!facts.name && pkg.name) facts.name = pkg.name;
  if (!facts.description && pkg.description) facts.description = pkg.description;
}

function resolveWorkspaces(root, files, globs) {
  const dirs = new Set();
  for (const g of globs) {
    const clean = g.replace(/\/\*\*?$/, '').replace(/\/$/, '');
    const isGlob = /\*$/.test(g);
    for (const f of files) {
      if (!f.endsWith('/package.json')) continue;
      const dir = f.slice(0, -'/package.json'.length);
      if (isGlob ? dir.startsWith(clean + '/') && !dir.slice(clean.length + 1).includes('/') : dir === clean) dirs.add(dir);
    }
  }
  return [...dirs].sort(byName).slice(0, 30).map((dir) => {
    const p = readJson(root, `${dir}/package.json`);
    return { path: dir, name: p?.name || basename(dir) };
  });
}

function taskLabel(name) {
  const n = name.toLowerCase();
  if (n === 'dev' || n === 'develop') return 'Dev server';
  if (n === 'start') return 'Start';
  if (n === 'build') return 'Build';
  if (n === 'test' || n === 'test:unit' || n === 'unit') return 'Test';
  if (/^(test:)?e2e/.test(n) || n === 'test:e2e') return 'End-to-end tests';
  if (n === 'lint') return 'Lint';
  if (n === 'lint:fix') return 'Lint and fix';
  if (/^(typecheck|type-check|check-types|types|tsc)$/.test(n)) return 'Type check';
  if (/^(format|fmt|prettier)$/.test(n)) return 'Format';
  if (n === 'preview') return 'Preview build';
  if (n === 'storybook') return 'Storybook';
  if (/^db:/.test(n)) return `Database: ${n.slice(3)}`;
  return `\`${name}\``;
}

// ------------------------------------------------------------------ python
function pythonFacts(root, files, facts) {
  const pyproject = readText(root, 'pyproject.toml');
  const reqs = readText(root, 'requirements.txt');
  const hasSetup = exists(root, 'setup.py') || exists(root, 'setup.cfg');
  if (!pyproject && !reqs && !hasSetup && !exists(root, 'Pipfile')) return;
  const toml = pyproject ? parseToml(pyproject) : {};
  if (pyproject) facts.manifests.push('pyproject.toml');
  if (reqs) facts.manifests.push('requirements.txt');

  let tool = 'pip';
  let evidence = reqs ? 'requirements.txt' : pyproject ? 'pyproject.toml' : 'setup.py';
  if (exists(root, 'uv.lock') || toml.tool?.uv) [tool, evidence] = ['uv', exists(root, 'uv.lock') ? 'uv.lock' : '[tool.uv] in pyproject.toml'];
  else if (exists(root, 'poetry.lock') || toml.tool?.poetry) [tool, evidence] = ['Poetry', exists(root, 'poetry.lock') ? 'poetry.lock' : '[tool.poetry] in pyproject.toml'];
  else if (exists(root, 'pdm.lock') || toml.tool?.pdm) [tool, evidence] = ['PDM', 'pdm.lock'];
  else if (exists(root, 'Pipfile')) [tool, evidence] = ['Pipenv', 'Pipfile'];
  else if (toml.tool?.hatch) [tool, evidence] = ['Hatch', '[tool.hatch] in pyproject.toml'];
  facts.pythonTool = { name: tool, evidence };

  const ver = readText(root, '.python-version')?.trim() || toml.project?.['requires-python'] || toml.tool?.poetry?.dependencies?.python;
  if (ver) facts.runtimes.push(`Python ${ver}`);

  const depNames = [];
  const addDep = (spec) => {
    const m = /^\s*([A-Za-z0-9_.\-]+)/.exec(String(spec));
    if (m) depNames.push(m[1].toLowerCase().replace(/_/g, '-'));
  };
  (toml.project?.dependencies || []).forEach(addDep);
  Object.values(toml.project?.['optional-dependencies'] || {}).flat().forEach(addDep);
  (toml['dependency-groups'] ? Object.values(toml['dependency-groups']).flat() : []).forEach((d) => typeof d === 'string' && addDep(d));
  Object.keys(toml.tool?.poetry?.dependencies || {}).forEach(addDep);
  Object.values(toml.tool?.poetry?.group || {}).forEach((g) => Object.keys(g.dependencies || {}).forEach(addDep));
  (reqs || '').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('-')).forEach(addDep);
  for (const f of ['requirements-dev.txt', 'requirements/dev.txt', 'dev-requirements.txt']) {
    (readText(root, f) || '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*[#-]/.test(l)).forEach(addDep);
  }
  const has = (d) => depNames.includes(d);
  for (const [dep, label] of PY_FRAMEWORKS) if (has(dep)) facts.frameworks.push(label);

  const prefix = { uv: 'uv run ', Poetry: 'poetry run ', PDM: 'pdm run ', Pipenv: 'pipenv run ', Hatch: 'hatch run ' }[tool] || '';
  const install = { uv: 'uv sync', Poetry: 'poetry install', PDM: 'pdm install', Pipenv: 'pipenv install --dev', Hatch: 'hatch env create' }[tool]
    || (reqs ? 'pip install -r requirements.txt' : 'pip install -e .');
  facts.commands.push({ task: 'Install dependencies', command: install, source: evidence });

  const hasPytest = has('pytest') || toml.tool?.pytest || exists(root, 'pytest.ini') || exists(root, 'conftest.py')
    || files.some((f) => /(^|\/)test_[^/]+\.py$/.test(f) && /^tests?\//.test(f));
  const manage = exists(root, 'manage.py');
  if (manage) facts.commands.push({ task: 'Dev server', command: `${prefix}python manage.py runserver`, source: 'manage.py' });
  if (hasPytest) facts.commands.push({ task: 'Test', command: `${prefix}pytest`, source: has('pytest') ? 'dependencies' : 'pytest config' });
  else if (manage) facts.commands.push({ task: 'Test', command: `${prefix}python manage.py test`, source: 'manage.py' });
  if (has('ruff') || toml.tool?.ruff || exists(root, 'ruff.toml') || exists(root, '.ruff.toml')) {
    facts.commands.push({ task: 'Lint', command: `${prefix}ruff check .`, source: 'Ruff config' });
    facts.commands.push({ task: 'Format', command: `${prefix}ruff format .`, source: 'Ruff config' });
    if (!facts.frameworks.includes('Ruff')) facts.frameworks.push('Ruff');
  } else if (has('black') || toml.tool?.black) facts.commands.push({ task: 'Format', command: `${prefix}black .`, source: 'Black config' });
  if (has('mypy') || toml.tool?.mypy || exists(root, 'mypy.ini')) facts.commands.push({ task: 'Type check', command: `${prefix}mypy .`, source: 'mypy config' });
  for (const name of Object.keys(toml.project?.scripts || {}).sort(byName).slice(0, 5)) {
    facts.commands.push({ task: `\`${name}\` entry point`, command: `${prefix}${name}`, source: '[project.scripts]' });
  }
  if (!facts.name && toml.project?.name) facts.name = toml.project.name;
  if (!facts.description && toml.project?.description) facts.description = toml.project.description;
  for (const f of ['manage.py', 'main.py', 'app.py', 'src/main.py', 'app/main.py']) if (exists(root, f)) facts.entryPoints.push(f);
}

// ------------------------------------------------------------------ go / rust / jvm / dotnet / ruby / php / deno
function goFacts(root, files, facts) {
  const mod = readText(root, 'go.mod');
  if (!mod) return;
  facts.manifests.push('go.mod');
  const ver = /^go\s+(\S+)/m.exec(mod);
  if (ver) facts.runtimes.push(`Go ${ver[1]}`);
  for (const [dep, label] of GO_FRAMEWORKS) if (mod.includes(dep)) facts.frameworks.push(label);
  facts.commands.push(
    { task: 'Build', command: 'go build ./...', source: 'go.mod' },
    { task: 'Test', command: 'go test ./...', source: 'go.mod' },
    { task: 'Vet', command: 'go vet ./...', source: 'go.mod' },
  );
  if (exists(root, '.golangci.yml') || exists(root, '.golangci.yaml') || exists(root, '.golangci.toml')) {
    facts.commands.push({ task: 'Lint', command: 'golangci-lint run', source: '.golangci config' });
  }
  if (exists(root, 'go.work')) facts.workspaces = { tool: 'Go workspace', globs: [], packages: [] };
  facts.entryPoints.push(...files.filter((f) => /^(main\.go|cmd\/[^/]+\/main\.go)$/.test(f)));
  const m = /^module\s+(\S+)/m.exec(mod);
  if (!facts.name && m) facts.name = m[1];
}

function rustFacts(root, files, facts) {
  const text = readText(root, 'Cargo.toml');
  if (!text) return;
  const cargo = parseToml(text);
  facts.manifests.push('Cargo.toml');
  const deps = { ...(cargo.dependencies || {}), ...(cargo['dev-dependencies'] || {}), ...(cargo.workspace?.dependencies || {}) };
  for (const [dep, label] of RUST_FRAMEWORKS) if (deps[dep]) facts.frameworks.push(label);
  const tc = readText(root, 'rust-toolchain.toml');
  const ch = tc ? /channel\s*=\s*"([^"]+)"/.exec(tc)?.[1] : readText(root, 'rust-toolchain')?.trim();
  if (ch) facts.runtimes.push(`Rust ${ch}`);
  else if (cargo.package?.['rust-version']) facts.runtimes.push(`Rust ${cargo.package['rust-version']}+`);
  facts.commands.push(
    { task: 'Build', command: 'cargo build', source: 'Cargo.toml' },
    { task: 'Test', command: 'cargo test', source: 'Cargo.toml' },
    { task: 'Lint', command: 'cargo clippy --all-targets', source: 'Cargo.toml' },
    { task: 'Format', command: 'cargo fmt', source: 'Cargo.toml' },
  );
  if (cargo.workspace?.members) {
    facts.workspaces = { tool: 'Cargo workspace', globs: [...cargo.workspace.members].sort(byName), packages: [] };
  }
  for (const f of ['src/main.rs', 'src/lib.rs']) if (exists(root, f)) facts.entryPoints.push(f);
  if (!facts.name && cargo.package?.name) facts.name = cargo.package.name;
  if (!facts.description && cargo.package?.description) facts.description = cargo.package.description;
}

function jvmFacts(root, files, facts) {
  if (exists(root, 'pom.xml')) {
    facts.manifests.push('pom.xml');
    const mvn = exists(root, 'mvnw') ? './mvnw' : 'mvn';
    facts.commands.push(
      { task: 'Build', command: `${mvn} package`, source: 'pom.xml' },
      { task: 'Test', command: `${mvn} test`, source: 'pom.xml' },
    );
    const pom = readText(root, 'pom.xml') || '';
    if (pom.includes('spring-boot')) facts.frameworks.push('Spring Boot');
  }
  const gradle = ['build.gradle', 'build.gradle.kts'].find((f) => exists(root, f));
  if (gradle) {
    facts.manifests.push(gradle);
    const g = exists(root, 'gradlew') ? './gradlew' : 'gradle';
    facts.commands.push(
      { task: 'Build', command: `${g} build`, source: gradle },
      { task: 'Test', command: `${g} test`, source: gradle },
    );
    const txt = readText(root, gradle) || '';
    if (txt.includes('org.springframework.boot')) facts.frameworks.push('Spring Boot');
    if (txt.includes('com.android')) facts.frameworks.push('Android');
  }
}

function dotnetFacts(root, files, facts) {
  const sln = files.find((f) => /^[^/]+\.slnx?$/.test(f));
  const proj = files.find((f) => /\.(cs|fs)proj$/.test(f));
  if (!sln && !proj) return;
  facts.manifests.push(sln || proj);
  facts.commands.push(
    { task: 'Build', command: 'dotnet build', source: sln || proj },
    { task: 'Test', command: 'dotnet test', source: sln || proj },
  );
  const gj = readJson(root, 'global.json');
  if (gj?.sdk?.version) facts.runtimes.push(`.NET SDK ${gj.sdk.version}`);
}

function rubyFacts(root, files, facts) {
  const gem = readText(root, 'Gemfile');
  if (!gem) return;
  facts.manifests.push('Gemfile');
  facts.commands.push({ task: 'Install dependencies', command: 'bundle install', source: 'Gemfile' });
  const rails = /gem\s+['"]rails['"]/.test(gem);
  if (rails) {
    facts.frameworks.push('Rails');
    facts.commands.push({ task: 'Dev server', command: exists(root, 'bin/dev') ? 'bin/dev' : 'bin/rails server', source: 'Gemfile' });
  }
  if (/gem\s+['"]rspec/.test(gem) || exists(root, '.rspec')) facts.commands.push({ task: 'Test', command: 'bundle exec rspec', source: 'Gemfile' });
  else if (rails) facts.commands.push({ task: 'Test', command: 'bin/rails test', source: 'Gemfile' });
  if (/gem\s+['"]rubocop/.test(gem)) facts.commands.push({ task: 'Lint', command: 'bundle exec rubocop', source: 'Gemfile' });
  const rv = readText(root, '.ruby-version')?.trim();
  if (rv) facts.runtimes.push(`Ruby ${rv}`);
}

function phpFacts(root, files, facts) {
  const c = readJson(root, 'composer.json');
  if (!c) return;
  facts.manifests.push('composer.json');
  facts.commands.push({ task: 'Install dependencies', command: 'composer install', source: 'composer.json' });
  const req = { ...(c.require || {}), ...(c['require-dev'] || {}) };
  if (req['laravel/framework']) facts.frameworks.push('Laravel');
  if (req['symfony/framework-bundle']) facts.frameworks.push('Symfony');
  for (const name of Object.keys(c.scripts || {}).filter((n) => !/^(pre|post)-/.test(n))) {
    facts.commands.push({ task: taskLabel(name), command: `composer run ${name}`, source: 'composer.json', script: name });
  }
  if (req['phpunit/phpunit'] && !c.scripts?.test) facts.commands.push({ task: 'Test', command: 'vendor/bin/phpunit', source: 'composer.json' });
}

function denoFacts(root, files, facts) {
  const f = ['deno.json', 'deno.jsonc'].find((x) => exists(root, x));
  if (!f) return;
  facts.manifests.push(f);
  const d = readJson(root, f) || {};
  for (const name of Object.keys(d.tasks || {})) facts.commands.push({ task: taskLabel(name), command: `deno task ${name}`, source: f, script: name });
  facts.commands.push({ task: 'Test', command: 'deno test', source: f });
}

// ------------------------------------------------------------------ make / just / docker
export function makeTargets(text) {
  const out = [];
  for (const m of (text || '').matchAll(/^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:(?!=)/gm)) {
    const t = m[1];
    if (t.startsWith('.') || /[%$]/.test(t) || t.includes('/') || /\.(o|c|h|go|js|ts|py)$/.test(t)) continue;
    out.push(t);
  }
  return uniq(out);
}

export function justRecipes(text) {
  const out = [];
  for (const m of (text || '').matchAll(/^@?([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+[^:=\n]*)?:(?!=)/gm)) {
    if (!['set', 'export', 'alias', 'import', 'mod'].includes(m[1])) out.push(m[1]);
  }
  return uniq(out);
}

function taskRunnerFacts(root, files, facts) {
  const mk = ['Makefile', 'makefile', 'GNUmakefile'].find((f) => exists(root, f));
  if (mk) {
    const targets = makeTargets(readText(root, mk));
    facts.makeTargets = targets;
    for (const t of targets.slice(0, 15)) facts.commands.push({ task: taskLabel(t), command: `make ${t}`, source: mk, target: t });
  }
  const jf = ['justfile', 'Justfile', '.justfile'].find((f) => exists(root, f));
  if (jf) {
    const recipes = justRecipes(readText(root, jf));
    facts.justRecipes = recipes;
    for (const r of recipes.slice(0, 15)) facts.commands.push({ task: taskLabel(r), command: `just ${r}`, source: jf, target: r });
  }
  const compose = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find((f) => exists(root, f));
  if (compose) facts.commands.push({ task: 'Start services', command: 'docker compose up', source: compose });
  if (exists(root, 'Dockerfile')) facts.manifests.push('Dockerfile');
}

// ------------------------------------------------------------------ layout, env, ci, docs
const SUB_MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts'];

/** A folder with its own manifest is a sub-project; say so and name its main frameworks. */
function subProject(root, dir, files) {
  const manifest = SUB_MANIFESTS.find((m) => files.includes(`${dir}/${m}`));
  if (!manifest) return '';
  let tools = [];
  if (manifest === 'package.json') {
    const p = readJson(root, `${dir}/package.json`) || {};
    const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
    tools = NODE_FRAMEWORKS.filter(([d]) => deps[d]).map(([, l]) => l);
  } else if (manifest === 'pyproject.toml') {
    const txt = (readText(root, `${dir}/pyproject.toml`) || '').toLowerCase();
    tools = PY_FRAMEWORKS.filter(([d]) => new RegExp(`["'\\s]${d}[\\s"'<>=~!\\[]`).test(txt)).map(([, l]) => l);
  }
  tools = uniq(tools).slice(0, 6);
  return `own ${manifest}${tools.length ? `: ${tools.join(', ')}` : ''}`;
}

function layout(root, files) {
  const top = new Map();
  for (const f of files) {
    const i = f.indexOf('/');
    if (i === -1) continue;
    const d = f.slice(0, i);
    if (!top.has(d)) top.set(d, new Set());
    const rest = f.slice(i + 1);
    const j = rest.indexOf('/');
    if (j !== -1) top.get(d).add(rest.slice(0, j));
  }
  const EXPAND = new Set(['src', 'app', 'apps', 'packages', 'lib', 'internal', 'cmd', 'crates', 'services']);
  const out = [];
  for (const d of [...top.keys()].sort(byName)) {
    const sub = subProject(root, d, files);
    const entry = { path: `${d}/`, note: [DIR_NOTES[d], sub].filter(Boolean).join(', ') };
    if (EXPAND.has(d)) {
      entry.children = [...top.get(d)].sort(byName).slice(0, 12).map((c) => {
        const csub = subProject(root, `${d}/${c}`, files);
        return { path: `${d}/${c}/`, note: [DIR_NOTES[c], csub].filter(Boolean).join(', ') };
      });
    }
    out.push(entry);
  }
  return out.slice(0, 40);
}

function envVars(root) {
  for (const f of ENV_EXAMPLES) {
    const text = readText(root, f);
    if (text == null) continue;
    const vars = uniq([...text.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]));
    return { file: f, vars: vars.slice(0, 40) };
  }
  return null;
}

const CI_CMD = /^(npm|npx|pnpm|yarn|bun|node|deno|make|just|pytest|python|python3|uv|poetry|pdm|tox|nox|ruff|mypy|go|cargo|dotnet|mvn|\.\/mvnw|gradle|\.\/gradlew|bundle|bin\/rails|composer|vendor\/bin\/\S+|docker|turbo|nx|tsc|eslint|vitest|jest|playwright)\b/;

function ciFacts(root, files) {
  const out = [];
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x)).sort(byName)) {
    const text = readText(root, f) || '';
    const name = /^name:\s*['"]?([^'"\n]+)['"]?/m.exec(text)?.[1]?.trim() || basename(f);
    const runs = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length;
      if (/^[|>]/.test(m[2].trim())) {
        for (let k = i + 1; k < lines.length; k++) {
          const l = lines[k];
          if (l.trim() && l.search(/\S/) <= indent) break;
          runs.push(l.trim());
        }
      } else runs.push(m[2].trim());
    }
    const unquote = (r) => (/^(['"]).*\1$/.test(r) ? r.slice(1, -1) : r);
    const cmds = uniq(runs.map(unquote).filter((r) => CI_CMD.test(r) && !/\$\{\{|\$\?/.test(r)));
    out.push({ file: f, name, runs: cmds.slice(0, 8) });
  }
  return out;
}

function agentDocs(files) {
  const out = [];
  for (const f of files) {
    for (const [re, kind] of AGENT_DOCS) {
      if (re.test(f)) {
        out.push({ path: f, kind });
        break;
      }
    }
  }
  return out.sort((a, b) => byName(a.path, b.path));
}

// ------------------------------------------------------------------ main
export function scan(dir = '.') {
  const root = resolve(dir);
  const files = listFiles(root);
  const facts = {
    root,
    name: null,
    description: null,
    languages: languages(files),
    manifests: [],
    runtimes: [],
    packageManager: null,
    pythonTool: null,
    frameworks: [],
    workspaces: null,
    commands: [],
    makeTargets: [],
    justRecipes: [],
    entryPoints: [],
    layout: layout(root, files),
    env: envVars(root),
    ci: ciFacts(root, files),
    agentDocs: agentDocs(files),
    license: null,
    fileCount: files.length,
  };
  nodeFacts(root, files, facts);
  pythonFacts(root, files, facts);
  goFacts(root, files, facts);
  rustFacts(root, files, facts);
  jvmFacts(root, files, facts);
  dotnetFacts(root, files, facts);
  rubyFacts(root, files, facts);
  phpFacts(root, files, facts);
  denoFacts(root, files, facts);
  taskRunnerFacts(root, files, facts);

  const lic = files.find((f) => /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(f));
  if (lic && !facts.license) {
    const first = (readText(root, lic) || '').split(/\r?\n/).find((l) => l.trim()) || '';
    facts.license = /MIT/.test(first) ? 'MIT' : /Apache/.test(first) ? 'Apache-2.0' : /GNU GENERAL PUBLIC/.test(first) ? 'GPL' : /BSD/.test(first) ? 'BSD' : lic;
  }
  facts.frameworks = uniq(facts.frameworks);
  facts.entryPoints = uniq(facts.entryPoints).filter((p) => exists(root, p)).sort(byName);
  facts.manifests = uniq(facts.manifests);
  if (!facts.name) facts.name = basename(root);
  Object.defineProperty(facts, '_files', { value: files, enumerable: false });
  return facts;
}

/** How many commits changed build-relevant files since the agent docs were last edited. */
export function docsAge(root, docPath) {
  return commitsSince(root, docPath, ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Makefile', '.github/workflows']);
}
