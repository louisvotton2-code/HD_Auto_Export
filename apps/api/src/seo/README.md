# SEO vehicle eligibility (v2 first wave)

`PUBLIC_SEO_ENABLED` defaults to false. When disabled, detail responses retain their old shape (no `seo`) and the manifest returns `enabled:false`, no items and no cursor. Missing metadata is never index permission. The API does not change the website indexing switch or publish XML.

The detail-only `seo` field and `GET /api/v1/seo/vehicles` use `eligibleSeoLocales` over the same current published database records. Lists, cards, homepage and employee previews do not gain an SEO field. External mode disabled also removes imported vehicles from the manifest.

First-wave quality means: published/visible identity; make/model IDs, integer year and mileage (zero mileage is valid), known powertrain, positive source quotation and at least one current ready/active image. Each listed language needs an actual-language non-generic title (at least 4 trimmed characters), description (at least 20), and ready actual-language make/model display labels. Current pending machine translations remain labeled as such; stale staff text and wrong-language fallbacks do not qualify. Manual vehicles must be available. Demo and staff-copied external publications do not create additional indexable identities.

Imported identities additionally require membership of `seo_external_selection`. Its unique slot constraint bounds the entire selection to 1,000 identities across all languages. Source withdrawal, hidden status, non-primary status, inadequate content, missing prices or expired images invalidate qualification on each read, independently of the refresh cadence. An explicit refresh picks the first 1,000 qualified identities in stable UUID order; it is not a ranking by price or popularity. Staff snapshots and drafts are never rewritten.

## Operator selection refresh

After migration `0040_seo_selection.sql`, an authorized operator may run from `apps/api`:

```sh
SEO_SELECTION_DATABASE=<exact_database_name> node --env-file=<private_runtime_env> --import tsx src/seo/cli.ts --refresh-selection
```

`DATABASE_URL` (or the existing local-secret source) must resolve to exactly `SEO_SELECTION_DATABASE`. The command queries only that database, takes a dedicated advisory lock and atomically replaces the bounded identity selection. It never calls a supplier or translation service and never enables public indexing. No-op selection leaves the public revision unchanged. Failures roll back the entire replacement. This is an operator action, not a public endpoint or implicit process-start side effect.

The selection is derived third-party data. OPS must exclude **table data** for `seo_external_selection` from first-party-only backups/restores alongside omitted external vehicle data. Keep its schema/migration; regenerate the selection only after the matching external catalog is restored. Do not restore orphan selection IDs into an empty external source catalog.

## Static sitemap consumer

Fetch `/api/v1/seo/vehicles?limit=500`, then follow each opaque `nextCursor` until null. Each item supplies only public `id`, eligible `locales` and `lastModified`; construct `/{locale}/cars/{id}/` using the configured canonical origin. Static homepage/catalog/guide/about/country-calculator routes are the website generator's responsibility.

The manifest is `no-store`. All pages in a build must share `revision`; it fingerprints the actual qualified manual/selected scope and catalog epoch, so unrelated unselected supplier writes do not force a restart. A change in that scope or natural expiry between pages returns 409. `validUntil` is the earliest time any included vehicle loses its last valid image, or null when no included image has a deadline. Check it against the wall clock before installing the complete generation, leave time for installation, and schedule regeneration before that deadline; expiry is not permission to keep an old sitemap live. A dependency failure returns 503, never a successful empty catalog. On either result discard the incomplete generation and retry; never atomically install a truncated generation. Reject duplicate vehicle/language URLs, and apply the PM's 10,000-URL / 50-MiB uncompressed shard limits in the XML producer. Publish only a complete generation and regenerate on catalog/selection changes and image expiry. API permission is live; a previously generated static XML file does not update itself.

OPS must explicitly deny this manifest route on **both** public and admin gateway vhosts and let the authorized generator reach the private API directly. Generic admin `/api/` forwarding must not expose it. The API independently permits only one in-flight manifest request per process with no waiting queue, a dedicated one-connection pool (one-second acquisition), a three-second statement timeout and five-second transaction timeout. Each page reads at most 10,001 scope records, projects only qualification fields, and returns 503 if the first-wave scope exceeds 10,000 identities; it never truncates the manifest. Multiple replicas each have their own bounded lane. These bounds do not replace the gateway denial.

The API supplies no proof of XML publication, crawler submission, production enablement, 48-hour observations or 500k capacity acceptance. Those remain separate OPS/FE/PM evidence.
