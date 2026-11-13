import { applyFormalCandidate } from '../store.js';
import { adaptSourceDocuments, loadSourceDocuments, persistSourceDocument, persistTrimDocument, refreshSourceSegments, type SourceDocument } from '../sources/index.js';
import { IngestionError, identityKey, type SourceApplier } from './types.js';

/** Raw evidence, source heads, public projection and checkpoint share the worker transaction. */
export const applyIngestionEvent:SourceApplier=async(tx,event,context)=>{
  if(!Array.isArray(event.document))throw new IngestionError('INGESTION_DOCUMENTS_REQUIRED');
  const documents=event.document as SourceDocument[];
  for(const document of documents){
    if(!document.identity || identityKey(document.identity)!==identityKey(event.identity))throw new IngestionError('INGESTION_DOCUMENT_IDENTITY');
    await persistSourceDocument(tx,document,!context.obsolete);
    if(document.kind==='specs'&&document.payload&&typeof document.payload==='object'&&'trimId' in document.payload){
      await persistTrimDocument(tx,String(document.payload.trimId),document.locale,document.payload,document.observedAt);
    }
  }
  if(context.obsolete)return;
  const prior=(await tx.query('SELECT source_revision FROM external_listings WHERE provider=$1 AND platform_id=$2 AND external_id=$3',
    [event.identity.provider,event.identity.source,event.identity.externalId])).rows[0];
  const revision=Number(prior?.source_revision??0)+1;
  if(!Number.isSafeInteger(revision))throw new IngestionError('INGESTION_REVISION_LIMIT');
  const proposed=(await tx.query('SELECT source,external_id FROM external_ingestion_members WHERE job_id=$1 AND canonical_id=$2 ORDER BY source,external_id LIMIT 1',[context.jobId,context.canonicalId])).rows[0];
  if(!proposed)throw new IngestionError('INGESTION_SCOPE_MISSING');
  // The first representative stays pinned across later tasks and provider association changes.
  await tx.query('INSERT INTO external_canonical_bindings(provider,canonical_id,source,external_id) VALUES($1,$2,$3,$4) ON CONFLICT(provider,canonical_id) DO NOTHING',[event.identity.provider,context.canonicalId,proposed.source,proposed.external_id]);
  const primary=(await tx.query('SELECT source,external_id FROM external_canonical_bindings WHERE provider=$1 AND canonical_id=$2',[event.identity.provider,context.canonicalId])).rows[0]!;
  const canonical={id:context.canonicalId,primary:primary.source===event.identity.source&&primary.external_id===event.identity.externalId};
  const identity={platformId:event.identity.source,externalId:event.identity.externalId,revision,fetchedAt:event.observedAt,
    sourceUpdatedAt:documents.find(d=>d.kind==='event')?.sourceUpdatedAt??null};
  if(event.operation==='withdraw'){
    await applyFormalCandidate(tx,{...identity,operation:'withdraw'},context.actor,context.jobId,canonical);return;
  }
  const projection=adaptSourceDocuments(await loadSourceDocuments(tx,event.identity),revision,event.observedAt);
  if(!projection)throw new IngestionError('INGESTION_DETAIL_INCOMPLETE');
  const applied=await applyFormalCandidate(tx,projection.candidate,context.actor,context.jobId,canonical);
  const segments=await refreshSourceSegments(tx,applied.listingId,projection,event.observedAt);
  if(segments.changed)await tx.query('UPDATE external_catalog_state SET revision=revision+1 WHERE id=1');
};
