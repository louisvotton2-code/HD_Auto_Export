import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationPlan } from './verification-plan.mjs';

const dev = (files) => verificationPlan(files, { stage: 'development' });
const commands = (plan) => plan.commands.map((command) => command.join(' '));

test('documentation-only changes avoid application checks in either phase', () => {
  for (const stage of ['development', 'production']) {
    assert.equal(verificationPlan(['AGENTS.md', '.agents/skills/hd-auto-development/SKILL.md'], { stage }).mode, 'docs');
  }
});
for (const app of ['web', 'admin', 'api']) {
  test(`${app} changes check and build only that application and required dependencies`, () => {
    const checks = commands(dev([`apps/${app}/src/example.ts`, 'docs/README.md']));
    assert.ok(checks.includes('pnpm check:workspace'));
    assert.ok(checks.includes('pnpm --filter @hd/contracts build'));
    assert.ok(checks.includes(`pnpm --filter @hd/${app} check`));
    assert.ok(checks.includes(`pnpm --filter @hd/${app} build`));
    for (const other of ['web', 'admin', 'api'].filter((name) => name !== app)) {
      assert.equal(checks.some((command) => command.includes(`@hd/${other} `)), false);
    }
    assert.equal(checks.some((command) => command.includes('test:e2e')), false);
    if (app === 'api') {
      assert.ok(checks.includes('pnpm --filter @hd/api test:integration'));
      assert.ok(checks.includes('pnpm --filter @hd/api openapi'));
    }
  });
}

test('shared contracts and cross-app changes cover the dependency closure once', () => {
  const checks = commands(dev(['packages/contracts/src/public.ts', 'apps/api/src/catalog.ts']));
  for (const scope of ['contracts', 'api', 'admin', 'web']) assert.ok(checks.includes(`pnpm --filter @hd/${scope} check`));
  assert.equal(new Set(checks).size, checks.length);
  assert.equal(checks.includes('pnpm --filter @hd/contracts build'), false); // contracts check already builds.
});

test('unknown paths, global configuration, infrastructure and empty changes stay full', () => {
  for (const file of ['pnpm-lock.yaml', 'package.json', 'deploy/nginx.conf', '.github/verification-policy.json', 'scripts/git-workflow.mjs', 'packages/new/index.ts', '.github/workflows/quality.yml']) {
    assert.equal(dev([file, 'apps/web/src/page.tsx']).mode, 'full', file);
  }
  assert.equal(dev([]).mode, 'full');
});

test('production, unknown phase and explicit full release runs retain full verification', () => {
  for (const stage of ['production', 'typo', undefined]) {
    assert.equal(verificationPlan(['apps/web/src/page.tsx'], { stage }).mode, 'full');
  }
  assert.deepEqual(commands(verificationPlan(['README.md'], { stage: 'development', full: true })), ['pnpm check', 'pnpm build', 'pnpm test:e2e']);
});
