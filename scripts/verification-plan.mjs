/** Keep the development gate scoped; unknown changes and release checks stay conservative. */
export function verificationPlan(files, { stage = 'production', full = false } = {}) {
  const fullPlan = { mode: 'full', commands: [['pnpm', 'check'], ['pnpm', 'build'], ['pnpm', 'test:e2e']] };
  if (full || files.length === 0) return fullPlan;
  if (files.every((file) => file.endsWith('.md'))) return { mode: 'docs' };
  if (stage !== 'development') return fullPlan;

  const scopes = new Set();
  for (const file of files) {
    if (file.endsWith('.md')) continue;
    if (file.startsWith('packages/contracts/')) {
      for (const scope of ['contracts', 'api', 'admin', 'web']) scopes.add(scope);
    } else {
      const scope = /^apps\/(api|admin|web)\//.exec(file)?.[1];
      if (!scope) return fullPlan; // Includes lockfiles, infrastructure and workflow policy itself.
      scopes.add(scope);
    }
  }
  const commands = [
    ['pnpm', 'check:workspace'],
    ['pnpm', '--filter', '@hd/contracts', scopes.has('contracts') ? 'check' : 'build'],
  ];
  for (const scope of ['api', 'admin', 'web']) {
    if (!scopes.has(scope)) continue;
    commands.push(['pnpm', '--filter', `@hd/${scope}`, 'check']);
    if (scope === 'api') commands.push(['pnpm', '--filter', '@hd/api', 'test:integration']);
    commands.push(['pnpm', '--filter', `@hd/${scope}`, 'build']);
    if (scope === 'api') commands.push(['pnpm', '--filter', '@hd/api', 'openapi']);
  }
  return { mode: 'development', commands };
}
