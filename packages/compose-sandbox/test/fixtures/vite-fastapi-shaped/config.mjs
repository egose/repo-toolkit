export default {
  cwd: '.',
  compose: {
    files: ['docker-compose.yml', 'docker-compose-apps.yml'],
    projectName: 'vfpt',
  },
  readiness: [
    { type: 'http', url: 'http://127.0.0.1:8080/realms/master', expectedStatus: 200 },
    { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info' },
    { type: 'http', url: 'http://127.0.0.1:3000', expectedStatus: [200, 299] },
  ],
  test: { executable: 'pnpm', args: ['playwright:test'] },
  evidence: { directory: '.ci-logs', capture: 'always', maxLogBytes: 1048576, stripAnsi: true },
  cleanup: { volumes: true, removeOrphans: true },
  timeouts: { startupMs: 120000, readinessMs: 120000, testMs: 300000, cleanupMs: 30000 },
};
