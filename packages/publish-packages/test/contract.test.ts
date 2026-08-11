import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageContract {
  dirName: string;
  manifestPath: string;
  manifest: {
    name: string;
    bin?: Record<string, string> | string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    files?: string[];
    exports?: unknown;
    main?: string;
    types?: string;
    scripts?: Record<string, string>;
    [key: string]: unknown;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const PLACEHOLDER_FIELDS: ReadonlyArray<{ field: string; value: string }> = [
  { field: 'version', value: '0.0.0-PLACEHOLDER' },
  { field: 'license', value: 'PLACEHOLDER' },
  { field: 'repository', value: 'PLACEHOLDER' },
];

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadPackages(): Promise<PackageContract[]> {
  const dirNames = (await readdir(PACKAGES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const packages: PackageContract[] = [];
  for (const dirName of dirNames) {
    const manifestPath = join(PACKAGES_DIR, dirName, 'package.json');
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = (await readJson(manifestPath)) as PackageContract['manifest'];
    packages.push({ dirName, manifestPath, manifest });
  }
  return packages;
}

const WORKSPACE_RANGE = /^workspace:/;
const INTERNAL_NAME_PREFIX = '@repo-toolkit/';

function isInternalDepName(name: string): boolean {
  return name.startsWith(INTERNAL_NAME_PREFIX);
}

function collectDependencyNames(manifest: PackageContract['manifest']): Array<[string, string]> {
  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
  const entries: Array<[string, string]> = [];
  for (const field of fields) {
    const map = manifest[field];
    if (!map || typeof map !== 'object') continue;
    for (const [name, range] of Object.entries(map)) {
      entries.push([name, range as string]);
    }
  }
  return entries;
}

describe('repository contract (MPPARC-03)', () => {
  describe('workspace aliases', () => {
    it('every package dir name has a matching tsconfig.base.json path alias', async () => {
      const tsconfig = (await readJson(join(REPO_ROOT, 'tsconfig.base.json'))) as {
        compilerOptions: { paths: Record<string, string[]> };
      };
      const paths = tsconfig.compilerOptions.paths;
      const packages = await loadPackages();

      for (const pkg of packages) {
        const expectedAlias = `@repo-toolkit/${pkg.dirName}`;
        const expectedGlobAlias = `${expectedAlias}/*`;
        const expectedTarget = `packages/${pkg.dirName}/src/index.ts`;
        const expectedGlobTarget = `packages/${pkg.dirName}/src/*`;

        expect(paths[expectedAlias], `missing tsconfig alias for ${expectedAlias}`).toBeDefined();
        expect(paths[expectedGlobAlias], `missing tsconfig glob alias for ${expectedGlobAlias}`).toBeDefined();
        expect(paths[expectedAlias], `tsconfig alias for ${expectedAlias} must point at ${expectedTarget}`).toContain(
          expectedTarget,
        );
        expect(
          paths[expectedGlobAlias],
          `tsconfig glob alias for ${expectedGlobAlias} must point at ${expectedGlobTarget}`,
        ).toContain(expectedGlobTarget);
      }
    });

    it('tsconfig.base.json has no orphan alias pointing at a missing package directory', async () => {
      const tsconfig = (await readJson(join(REPO_ROOT, 'tsconfig.base.json'))) as {
        compilerOptions: { paths: Record<string, string[]> };
      };
      const packages = await loadPackages();
      const dirNames = new Set(packages.map((p) => p.dirName));

      for (const [alias, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
        const target = targets[0];
        const match = target.match(/^packages\/([^/]+)\/src/);
        expect(match, `tsconfig alias ${alias} target ${target} does not match packages/<dir>/src/...`).not.toBeNull();
        const dirName = match![1];
        expect(dirNames.has(dirName), `tsconfig alias ${alias} points at missing package dir ${dirName}`).toBe(true);
      }
    });
  });

  describe('root scripts', () => {
    it('every package bin entry has a matching root package.json script (derived from the bin name without the repo-toolkit- prefix)', async () => {
      const rootPkg = (await readJson(join(REPO_ROOT, 'package.json'))) as { scripts: Record<string, string> };
      const rootScripts = rootPkg.scripts;
      const packages = await loadPackages();

      for (const pkg of packages) {
        const bin = pkg.manifest.bin;
        const binNames: string[] = [];
        if (typeof bin === 'string') {
          binNames.push(bin);
        } else if (bin && typeof bin === 'object') {
          binNames.push(...Object.keys(bin));
        }

        for (const binName of binNames) {
          const scriptName = binName.startsWith('repo-toolkit-') ? binName.slice('repo-toolkit-'.length) : binName;
          expect(
            rootScripts[scriptName],
            `root package.json is missing script "${scriptName}" required by ${pkg.manifest.name} (bin "${binName}")`,
          ).toBeDefined();
          expect(
            rootScripts[scriptName],
            `root script "${scriptName}" must reference packages/${pkg.dirName}/dist/`,
          ).toContain(`packages/${pkg.dirName}/dist/`);
        }
      }
    });

    it('the root package.json is private and never published', async () => {
      const rootPkg = (await readJson(join(REPO_ROOT, 'package.json'))) as { private?: boolean };
      expect(rootPkg.private, 'root package.json must be private: true').toBe(true);
    });
  });

  describe('unique bins', () => {
    it('no two package bins collide across the workspace', async () => {
      const packages = await loadPackages();
      const seen = new Map<string, string>();

      for (const pkg of packages) {
        const bin = pkg.manifest.bin;
        const binNames: string[] = [];
        if (typeof bin === 'string') {
          binNames.push(bin);
        } else if (bin && typeof bin === 'object') {
          binNames.push(...Object.keys(bin));
        }
        for (const binName of binNames) {
          const owner = seen.get(binName);
          expect(owner, `bin "${binName}" is owned by both ${owner} and ${pkg.manifest.name}`).toBeUndefined();
          seen.set(binName, pkg.manifest.name);
        }
      }
    });
  });

  describe('internal ranges', () => {
    it('every workspace: range in a dependency field targets an internal @repo-toolkit/* name', async () => {
      const packages = await loadPackages();

      for (const pkg of packages) {
        const entries = collectDependencyNames(pkg.manifest);
        for (const [name, range] of entries) {
          if (WORKSPACE_RANGE.test(range)) {
            expect(
              isInternalDepName(name),
              `${pkg.manifest.name} uses workspace: range on non-internal dep "${name}" (${range})`,
            ).toBe(true);
          }
        }
      }
    });

    it('every @repo-toolkit/* dependency in a package uses a workspace: range', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        const entries = collectDependencyNames(pkg.manifest);
        for (const [name, range] of entries) {
          if (isInternalDepName(name)) {
            expect(
              WORKSPACE_RANGE.test(range),
              `${pkg.manifest.name} depends on ${name} with non-workspace range "${range}"`,
            ).toBe(true);
          }
        }
      }
    });
  });

  describe('publishable manifest fields', () => {
    it('every package uses the version/license/repository placeholder contract', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        for (const { field, value } of PLACEHOLDER_FIELDS) {
          expect(
            pkg.manifest[field],
            `${pkg.manifest.name} package.json "${field}" must be the publish placeholder "${value}"`,
          ).toBe(value);
        }
      }
    });

    it('every package exposes an ESM entry, type definitions, and a bin via the canonical exports map', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        expect(pkg.manifest.type, `${pkg.manifest.name} must set "type": "module"`).toBe('module');
        expect(pkg.manifest.main, `${pkg.manifest.name} must expose a "main" pointing at dist/`).toBe('dist/index.js');
        expect(pkg.manifest.types, `${pkg.manifest.name} must expose "types" pointing at dist/`).toBe(
          'dist/index.d.ts',
        );
        expect(pkg.manifest.bin, `${pkg.manifest.name} must declare a bin entry`).toBeDefined();
        expect(pkg.manifest.files, `${pkg.manifest.name} must restrict published files to README.md and dist`).toEqual([
          'README.md',
          'dist',
        ]);
      }
    });

    it('every package exposes a default `.` export with types, import, and default conditions pointing at dist/', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        const exports_ = pkg.manifest.exports as { '.'?: Record<string, string> } | undefined;
        expect(exports_, `${pkg.manifest.name} must expose an exports map`).toBeDefined();
        const dot = exports_?.['.'];
        expect(dot, `${pkg.manifest.name} must expose a "." export condition`).toBeDefined();
        expect(dot!.types, `${pkg.manifest.name} ".".types must be ./dist/index.d.ts`).toBe('./dist/index.d.ts');
        expect(dot!.import, `${pkg.manifest.name} ".".import must be ./dist/index.js`).toBe('./dist/index.js');
        expect(dot!.default, `${pkg.manifest.name} ".".default must be ./dist/index.js`).toBe('./dist/index.js');
      }
    });

    it('every package declares a build script using the shared tsup config and a test script that rebuilds deps first', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        const scripts = pkg.manifest.scripts ?? {};
        expect(scripts.build, `${pkg.manifest.name} must declare a "build" script`).toBe(
          'tsup --config tsup.config.ts',
        );
        expect(scripts.test, `${pkg.manifest.name} must declare a "test" script that rebuilds deps first`).toContain(
          `pnpm --filter ${pkg.manifest.name}... build && vitest run --config vitest.config.ts`,
        );
      }
    });
  });

  describe('docs membership', () => {
    it('every package is listed in the root README Packages section', async () => {
      const readme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8');
      const packages = await loadPackages();

      // The "## Packages" section is a markdown bullet list. Pull the line
      // range starting at "## Packages" and ending at the next "## " heading.
      const packagesSectionMatch = readme.match(/^## Packages\s*\n([\s\S]*?)(?=\n## )/m);
      expect(packagesSectionMatch, 'root README.md must contain a "## Packages" section').not.toBeNull();
      const packagesSection = packagesSectionMatch![1];

      for (const pkg of packages) {
        expect(packagesSection, `root README.md "## Packages" section must mention ${pkg.manifest.name}`).toContain(
          pkg.manifest.name,
        );
      }
    });

    it('every package is listed in the root README Workspace Layout section', async () => {
      const readme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8');
      const packages = await loadPackages();

      const layoutSectionMatch = readme.match(/^## Workspace Layout\s*\n([\s\S]*?)(?=\n## )/m);
      expect(layoutSectionMatch, 'root README.md must contain a "## Workspace Layout" section').not.toBeNull();
      const layoutSection = layoutSectionMatch![1];

      for (const pkg of packages) {
        expect(
          layoutSection,
          `root README.md "## Workspace Layout" section must mention packages/${pkg.dirName}`,
        ).toContain(`packages/${pkg.dirName}`);
      }
    });

    it('every package is listed in website/docs/packages/index.md', async () => {
      const docsIndex = await readFile(join(REPO_ROOT, 'website', 'docs', 'packages', 'index.md'), 'utf8');
      const packages = await loadPackages();

      for (const pkg of packages) {
        expect(docsIndex, `website/docs/packages/index.md must link to ${pkg.manifest.name}`).toContain(
          pkg.manifest.name,
        );
      }
    });

    it('every package has a dedicated website/docs/packages/<pkg> entry (either a .md file or an index/ directory)', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        const mdPath = join(REPO_ROOT, 'website', 'docs', 'packages', `${pkg.dirName}.md`);
        const dirIndexPath = join(REPO_ROOT, 'website', 'docs', 'packages', pkg.dirName, 'index.md');
        const hasFile = existsSync(mdPath);
        const hasDir = existsSync(dirIndexPath);
        expect(
          hasFile || hasDir,
          `website/docs/packages/${pkg.dirName}.md or website/docs/packages/${pkg.dirName}/index.md must exist for ${pkg.manifest.name}`,
        ).toBe(true);
      }
    });

    it('every package has a local README.md', async () => {
      const packages = await loadPackages();
      for (const pkg of packages) {
        const readmePath = join(PACKAGES_DIR, pkg.dirName, 'README.md');
        expect(
          existsSync(readmePath),
          `${pkg.manifest.name} must have a local README.md at packages/${pkg.dirName}/README.md`,
        ).toBe(true);
      }
    });
  });

  describe('per-package config consistency', () => {
    it('every package has the shared tsup.config.ts, vitest.config.ts, and tsconfig.json', async () => {
      const packages = await loadPackages();
      const sharedConfigs = ['tsup.config.ts', 'vitest.config.ts', 'tsconfig.json'];
      for (const pkg of packages) {
        for (const configFile of sharedConfigs) {
          const configPath = join(PACKAGES_DIR, pkg.dirName, configFile);
          expect(existsSync(configPath), `packages/${pkg.dirName}/${configFile} must exist`).toBe(true);
        }
      }
    });
  });
});
