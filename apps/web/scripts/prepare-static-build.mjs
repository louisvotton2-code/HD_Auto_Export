import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only generated output and build-fetch cache: never user settings or tax facts.
// Clearing fetch-cache ensures a rebuild requests a new market snapshot.
for (const relative of ['out/', '.next/cache/fetch-cache/', '.next/standalone/']) {
  await rm(fileURLToPath(new URL(`../${relative}`, import.meta.url)), {
    recursive: true,
    force: true,
  });
}
console.log('Static build prepared; currency snapshot will be fetched during this build.');
