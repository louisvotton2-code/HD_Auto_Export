import { describe, expect, it } from 'vitest';
import { keepPublishIntent, makePublishIntent, publicationAttemptExpired, publicationControlState, publicationFeedback, publicationIssueLabel, publicationReadinessIssueLabel } from './vehicle-actions-model';

describe('publication recovery', () => {
  it('captures the version and payload from the original publication intent', () => {
    const vehicle = { version: 7 };
    const intent = makePublishIntent(vehicle, 'publish-test-key', 1000);
    vehicle.version = 8;
    expect(intent.body).toBe('{"version":7}');
    expect(intent.version).toBe(7);
    expect(intent.key).toBe('publish-test-key');
  });
  it('keeps an uncertain publish after reauthentication or a later conflict', () => {
    expect(keepPublishIntent(0, false)).toBe(true);
    expect(keepPublishIntent(503, false)).toBe(true);
    expect(keepPublishIntent(401, true)).toBe(true);
    expect(keepPublishIntent(409, true)).toBe(true);
    expect(keepPublishIntent(422, true)).toBe(true);
  });
  it('allows a fresh intent after a first explicit business rejection', () => {
    expect(keepPublishIntent(422, false)).toBe(false);
    expect(keepPublishIntent(401, false)).toBe(false);
    expect(keepPublishIntent(409, false)).toBe(false);
  });
  it('requires result reconciliation at the 24 hour retention boundary', () => {
    const intent = makePublishIntent({ version: 1 }, 'publish-test-key', 1000);
    expect(publicationAttemptExpired(intent, 1000 + 24 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(publicationAttemptExpired(intent, 1000 + 24 * 60 * 60 * 1000)).toBe(true);
  });
});

describe('publication validation hints', () => {
  it('identifies the locale and current translation field', () => {
    expect(publicationIssueLabel('draft.content.title.translations.ru')).toBe('俄文标题：请完善当前原文的译文');
    expect(publicationIssueLabel('draft.content.description.translations.en.text')).toBe('英文描述：请完善当前原文的译文');
  });
  it('describes cover and verification requirements without echoing unknown server details', () => {
    expect(publicationIssueLabel('draft.media.0')).toContain('选择一张封面');
    expect(publicationIssueLabel('availability')).toContain('实际核验');
    expect(publicationIssueLabel('private.database.stack')).toBe('车辆资料：请检查未满足的发布条件');
  });
  it('routes localization validation to the dedicated translation workspace', () => {
    expect(publicationIssueLabel('localization.location.city.en')).toBe('公开字段多语：请完善英文译文，并与当前中文保持一致');
    expect(publicationIssueLabel('localization.media.550e8400-e29b-41d4-a716-446655440001.alt.ru')).toContain('俄文');
  });
});


describe('confirmed publication feedback', () => {
  const receipt = { publishedRevisionId: 'original-publication' };
  it('does not announce publish success from a historical receipt after delete, archive, or restore', () => {
    expect(publicationFeedback(receipt, { publicationState: 'published', publishedRevisionId: receipt.publishedRevisionId, deletedAt: '2026-11-08T08:00:00Z' })).toMatchObject({ tone: 'info', text: expect.stringContaining('回收站') });
    expect(publicationFeedback(receipt, { publicationState: 'archived', publishedRevisionId: receipt.publishedRevisionId, deletedAt: null })).toMatchObject({ tone: 'info', text: expect.stringContaining('已下架') });
    expect(publicationFeedback(receipt, { publicationState: 'draft', publishedRevisionId: null, deletedAt: null })).toMatchObject({ tone: 'info', text: expect.stringContaining('未自动发布') });
  });
  it('reports a later public version as current information rather than claiming this request created it', () => {
    expect(publicationFeedback(receipt, { publicationState: 'published', publishedRevisionId: 'later-publication', deletedAt: null })).toMatchObject({ tone: 'info', text: expect.stringContaining('其他发布版本') });
    expect(publicationFeedback(receipt, { publicationState: 'published', publishedRevisionId: receipt.publishedRevisionId, deletedAt: null }).tone).toBe('success');
  });
});


describe('server-confirmed pending publication state', () => {
  const published = { publicationState: 'published' as const, publishedRevisionId: 'current-publication', deletedAt: null, hasUnpublishedChanges: false };
  it('blocks a second publish from a clean saved snapshot, regardless of unrelated record activity', () => {
    const clean = publicationControlState(published);
    expect(clean).toMatchObject({ blocked: true, needsRefresh: false, actionLabel: '已发布，暂无待发布修改' });
    // A new record version or update time is intentionally not used as evidence of a changed public draft.
    expect(publicationControlState({ ...published, version: 99, updatedAt: '2026-11-08T10:00:00Z' } as typeof published)).toEqual(clean);
  });
  it('enables a saved public-content revision and still permits an explicit first/re-publication', () => {
    expect(publicationControlState({ ...published, hasUnpublishedChanges: true })).toMatchObject({ blocked: false, actionLabel: '发布已保存的修改' });
    expect(publicationControlState({ ...published, publicationState: 'draft', publishedRevisionId: null, hasUnpublishedChanges: null }).blocked).toBe(false);
    expect(publicationControlState({ ...published, publicationState: 'archived' }).blocked).toBe(false);
  });
  it('does not turn a legacy null or missing publication pointer into a no-change claim', () => {
    const unknown = publicationControlState({ ...published, hasUnpublishedChanges: null });
    expect(unknown).toMatchObject({ blocked: true, needsRefresh: true, title: '发布差异待核对' });
    expect(publicationControlState({ ...published, publishedRevisionId: null })).toMatchObject({ blocked: true, needsRefresh: true });
  });
  it('never opens a new publication for a deleted record', () => {
    expect(publicationControlState({ ...published, deletedAt: '2026-11-08T08:00:00Z', hasUnpublishedChanges: true })).toMatchObject({ blocked: true, needsRefresh: false });
  });
});


describe('后台发布缺项中文提示', () => {
  it('不把服务端英文诊断或内部值直接显示给操作员', () => {
    expect(publicationReadinessIssueLabel({ stage: 'preview', path: 'publicationPreview', code: 'PREVIEW_CONFIRMATION_REQUIRED', message: 'Confirm the current publication preview before publishing.' })).toBe('发布预览：请检查并确认当前内容');
    expect(publicationReadinessIssueLabel({ stage: 'required_fields', path: 'draft.internal.purchaseCost.amount', code: 'REQUIRED_FOR_PUBLICATION', message: 'PRIVATE_DIAGNOSTIC_VALUE' })).toBe('采购成本：请填写正数金额并核对币种');
    expect(publicationReadinessIssueLabel({ stage: 'localization', path: 'draft.content.title.translations.en', code: 'REQUIRED_FOR_PUBLICATION', message: 'A reviewed translation is required.' })).toBe('英文标题：请完善当前原文的译文');
    expect(publicationReadinessIssueLabel({ stage: 'required_fields', path: 'draft.facts.trim', code: 'REQUIRED_FOR_PUBLICATION', message: 'Trim is required.' })).toBe('配置名称：请填写车型配置名称');
  });
});
