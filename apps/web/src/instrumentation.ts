/** Run for both next start and direct Node standalone startup. Next skips this hook during build. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertServerRuntimeConfiguration, serverRuntimeStartupError } = await import('./shared/config/server-runtime');
    try {
      assertServerRuntimeConfiguration();
    } catch (error) {
      console.error(serverRuntimeStartupError(error));
      // Next's server preparation may log a rejected hook and keep the process alive.
      process.exit(1);
    }
  }
}
