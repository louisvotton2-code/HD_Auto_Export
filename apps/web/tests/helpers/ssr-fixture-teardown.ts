import { cleanupSsrFixtureEnvironment } from './ssr-fixture-environment';

export default function globalTeardown() {
  cleanupSsrFixtureEnvironment();
}
