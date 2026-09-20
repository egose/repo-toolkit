#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_TOKEN = 'fake-connect-token-for-examples-only';
const VAULT_ID = 'vault-1';
const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

export function startFakeConnectServer() {
  const items = new Map();
  let counter = 0;
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${FAKE_TOKEN}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const listPattern = /^\/v1\/vaults\/([^/]+)\/items\/?$/;
    const itemPattern = /^\/v1\/vaults\/([^/]+)\/items\/([^/]+)\/?$/;
    if (req.method === 'GET' && listPattern.test(url.pathname)) {
      const summaries = [...items.values()].map((detail) => ({
        id: detail.id,
        title: detail.title,
        tags: detail.tags,
        category: detail.category,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(summaries));
      return;
    }
    const itemMatch = url.pathname.match(itemPattern);
    if (req.method === 'GET' && itemMatch) {
      const detail = items.get(itemMatch[2]);
      if (!detail) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(detail));
      return;
    }
    if (req.method === 'POST' && listPattern.test(url.pathname)) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid json' }));
          return;
        }
        counter += 1;
        const detail = {
          id: `fake-${counter}`,
          title: String(parsed.title ?? ''),
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          category: String(parsed.category ?? 'SECURE_NOTE'),
          fields: Array.isArray(parsed.fields) ? parsed.fields : [],
        };
        items.set(detail.id, detail);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify(detail));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  return { server, items, token: FAKE_TOKEN };
}

async function writeConfig(dir) {
  const config = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    root: '.',
    remote: { type: 'onepassword-connect', vaultId: VAULT_ID },
    branch: 'main',
    files: ['.env'],
    ignore: ['**/.env.example'],
    limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
  };
  await writeFile(join(dir, 'secret-sync.config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

async function main() {
  const { server, token } = startFakeConnectServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  const env = { OP_CONNECT_HOST: endpoint, OP_CONNECT_TOKEN: token };
  const work = await mkdtemp(join(tmpdir(), 'secsync-fake-a-'));
  const clone = await mkdtemp(join(tmpdir(), 'secsync-fake-b-'));
  try {
    const lib = await import('../dist/index.js');
    await writeConfig(work);
    await writeFile(join(work, '.env'), 'DEMO=1\n');
    const init = await lib.runSecretSync({ cwd: work, config: join(work, 'secret-sync.config.json'), command: 'init', vault: VAULT_ID, env });
    const push = await lib.runSecretSync({ cwd: work, config: join(work, 'secret-sync.config.json'), command: 'push', message: 'demo', env });
    const status = await lib.runSecretSync({ cwd: work, config: join(work, 'secret-sync.config.json'), command: 'status', env });
    await writeConfig(clone);
    const pull = await lib.runSecretSync({ cwd: clone, config: join(clone, 'secret-sync.config.json'), command: 'pull', env });
    const pulled = await readFile(join(clone, '.env'), 'utf8');
    if (pulled !== 'DEMO=1\n') {
      throw new Error('fake-server round trip mismatch');
    }
    console.log(JSON.stringify({ fakeServer: endpoint, init: init.result.branch, push: push.result.published, status: status.result.clean, pull: pull.result.downloaded }));
    console.log('fake-server round trip ok: init, push, status, and pull agree on exact bytes without a real vault');
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(clone, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('fake-server.mjs');
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
