/** Names accepted by the release tooling, never arbitrary connection targets. */
export function deploymentDatabaseName(value = 'hd_auto') {
  if (typeof value !== 'string' || !/^(?:hd_auto|hd_release_[a-f0-9]{12,40})$/.test(value)) {
    throw new Error('Expected hd_auto or an explicit hd_release_<12..40 hex> database');
  }
  return value;
}

/** A new release cannot reuse the credential that can read the retained old database. */
export function deploymentDatabaseIdentity(value) {
  const database = deploymentDatabaseName(value);
  return {database, user: database === 'hd_auto' ? 'hd_app' : `${database}_app`};
}
