import { getSsrServiceSecret, SsrServiceSecretError } from './ssr-service-secret';

/** Server-only release identity. Never derive this namespace from request data. */
export type ServerDeploymentEnvironment = 'production' | 'local' | 'test';

export type ServerReleaseIdentity = Readonly<{
  deploymentEnv: ServerDeploymentEnvironment;
  releaseId: string;
}>;

export class ServerRuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(`[HD Auto server configuration] ${message}`);
    this.name = 'ServerRuntimeConfigurationError';
  }
}

const releaseLabel = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const immutableProductionRelease = /^(?:[a-f0-9]{40,64}|sha256:[a-f0-9]{64})$/;

/** A pure parser keeps build-time imports and tests independent of process state. */
export function parseServerReleaseIdentity(
  env: Readonly<Record<string, string | undefined>>,
): ServerReleaseIdentity {
  const deploymentEnv = env.HD_DEPLOYMENT_ENV;
  if (deploymentEnv !== 'production' && deploymentEnv !== 'local' && deploymentEnv !== 'test') {
    throw new ServerRuntimeConfigurationError('HD_DEPLOYMENT_ENV must be explicitly set to production, local or test.');
  }
  const releaseId = env.HD_RELEASE_ID;
  if (!releaseId || releaseId.trim() !== releaseId || !releaseLabel.test(releaseId)) {
    throw new ServerRuntimeConfigurationError('HD_RELEASE_ID must be an explicit fixed ASCII identifier of at most 256 characters without whitespace.');
  }
  if (releaseId === 'unreleased') {
    throw new ServerRuntimeConfigurationError('HD_RELEASE_ID cannot use the unreleased placeholder for runtime startup.');
  }
  if (deploymentEnv === 'production' && !immutableProductionRelease.test(releaseId)) {
    throw new ServerRuntimeConfigurationError('HD_RELEASE_ID in production must be a 40–64 character lowercase commit identifier or sha256 image digest.');
  }
  return Object.freeze({ deploymentEnv, releaseId });
}

/** Only trusted process configuration enters the SSR cache namespace. */
export function getServerReleaseIdentity(): ServerReleaseIdentity {
  return parseServerReleaseIdentity(process.env);
}

export function assertServerRuntimeConfiguration(): void {
  getServerReleaseIdentity();
  getSsrServiceSecret();
}

/** Only known, already-sanitized configuration errors may be shown during startup. */
export function serverRuntimeStartupError(error: unknown): string {
  if (error instanceof ServerRuntimeConfigurationError || error instanceof SsrServiceSecretError) return error.message;
  return '[HD Auto server configuration] Runtime configuration validation failed.';
}
