import type { PoolClient } from 'pg';
import type { EnabledPixelVehicles, EnabledPixelVehiclesQuery } from '@hd/contracts/admin';
import { activityChanges } from '../activity/changes.js';
import { recordAudit } from '../activity/service.js';
import type { Database } from '../db/index.js';
import { conflict, notFound } from '../errors.js';
import { externalInquiryCode } from '../external/inquiry-code.js';
import { isPublicText } from '../external/normalize.js';
import type { Actor } from './service.js';

type PixelKind = 'staff' | 'external';
type PixelSetting = { pixelEnabled: boolean; version: number };
type VehiclePixel = PixelSetting & { vehicleId: string };
type Queryable = Pick<Database['pool'] | PoolClient, 'query'>;

const target = {
  staff: { parent: 'vehicles', active: 'AND parent.deleted_at IS NULL', settings: 'vehicle_pixel_settings', key: 'vehicle_id' },
  external: { parent: 'external_listings', active: '', settings: 'external_listing_pixel_settings', key: 'listing_id' },
} as const;

function databaseId(kind: PixelKind, pathId: string) {
  return kind === 'external' ? pathId.slice(4) : pathId;
}

async function readPixel(db: Queryable, kind: PixelKind, id: string): Promise<VehiclePixel> {
  const { parent, active, settings, key } = target[kind];
  const result = await db.query<{ id: string; pixel_enabled: boolean; version: number }>(`
    SELECT parent.id, coalesce(settings.pixel_enabled, false) AS pixel_enabled, coalesce(settings.version, 1) AS version
    FROM ${parent} parent LEFT JOIN ${settings} settings ON settings.${key} = parent.id
    WHERE parent.id = $1 ${active}`, [id]);
  const row = result.rows[0];
  if (!row) throw notFound();
  return { vehicleId: kind === 'external' ? `ext-${row.id}` : row.id, pixelEnabled: row.pixel_enabled, version: row.version };
}

export function getVehiclePixel(db: Database, kind: PixelKind, pathId: string) {
  return readPixel(db.pool, kind, databaseId(kind, pathId));
}

const enabledVehicles = `
  SELECT settings.vehicle_id AS id, false AS external
  FROM vehicle_pixel_settings settings JOIN vehicles v ON v.id=settings.vehicle_id
  WHERE settings.pixel_enabled AND v.deleted_at IS NULL
  UNION ALL
  SELECT settings.listing_id AS id, true AS external
  FROM external_listing_pixel_settings settings
  WHERE $1::boolean AND settings.pixel_enabled`;

export function listEnabledVehiclePixels(db: Database, { page, pageSize }: EnabledPixelVehiclesQuery, externalCatalog: boolean): Promise<EnabledPixelVehicles> {
  return db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await tx.query<{ total: number }>(`SELECT count(*)::int AS total FROM (${enabledVehicles}) enabled`, [externalCatalog]);
    const total = result.rows[0]!.total;
    const offset = (page - 1) * pageSize;
    if (offset >= total) return { page, pageSize, total, items: [] };

    const { rows } = await tx.query<{ id: string; external: boolean; number: string; title: string | null; source_title: string | null }>(`
      WITH picked AS (
        SELECT id,external FROM (${enabledVehicles}) enabled ORDER BY external,id LIMIT $2 OFFSET $3
      )
      SELECT p.id,p.external,coalesce(v.stock_number,l.inquiry_number)::text AS number,
        CASE WHEN p.external THEN c.localized#>>'{zh,title,text}'
          ELSE coalesce(nullif(btrim(d.data#>>'{content,title,translations,zh,text}'),''),d.data#>>'{content,title,sourceText}') END AS title,
        CASE WHEN l.source_data->'disputes'='[]'::jsonb THEN
          coalesce(nullif(btrim(l.source_data#>>'{copy,title,translations,zh,text}'),''),l.source_data#>>'{copy,title,original,text}')
        END AS source_title
      FROM picked p
      LEFT JOIN vehicles v ON NOT p.external AND v.id=p.id
      LEFT JOIN vehicle_drafts d ON d.vehicle_id=v.id
      LEFT JOIN external_listings l ON p.external AND l.id=p.id
      LEFT JOIN external_catalog c ON c.listing_id=l.id
      ORDER BY p.external,p.id`, [externalCatalog, pageSize, offset]);
    const items = rows.map(row => {
      const code = row.external ? externalInquiryCode(row.number) : `HD-${row.number.padStart(6, '0')}`;
      const sourceTitle = row.source_title?.trim();
      const title = row.title?.trim() || (sourceTitle && isPublicText(sourceTitle) ? sourceTitle : code);
      return { vehicleId: row.external ? `ext-${row.id}` : row.id, code, title };
    });
    return { page, pageSize, total, items };
  });
}

export function setVehiclePixel(db: Database, kind: PixelKind, pathId: string, input: PixelSetting, actor: Actor) {
  const id = databaseId(kind, pathId);
  const { parent, active, settings, key } = target[kind];
  return db.transaction(async tx => {
    // The parent row serializes writers even before the first setting exists. Read the setting in a fresh statement after the lock.
    const locked = await tx.query(`SELECT id FROM ${parent} parent WHERE parent.id = $1 ${active} FOR NO KEY UPDATE`, [id]);
    if (!locked.rowCount) throw notFound();
    const current = await readPixel(tx, kind, id);
    if (current.pixelEnabled === input.pixelEnabled) return current;
    if (current.version !== input.version) throw conflict();

    const next = { ...current, pixelEnabled: input.pixelEnabled, version: current.version + 1 };
    await tx.query(`INSERT INTO ${settings} (${key}, pixel_enabled, version) VALUES ($1, $2, $3)
      ON CONFLICT (${key}) DO UPDATE SET pixel_enabled = excluded.pixel_enabled, version = excluded.version`,
    [id, next.pixelEnabled, next.version]);

    const changes = activityChanges(current.pixelEnabled, next.pixelEnabled, 'pixelEnabled');
    if (kind === 'external') {
      changes.push(...activityChanges(undefined, current.vehicleId, 'listingId'));
      await recordAudit(tx, actor, 'external.pixel.update', null, current.version, next.version, changes);
    } else {
      await recordAudit(tx, actor, 'vehicle.pixel.update', id, current.version, next.version, changes);
    }
    await tx.query('SELECT queue_public_catalog_metadata_change()');
    return next;
  });
}
