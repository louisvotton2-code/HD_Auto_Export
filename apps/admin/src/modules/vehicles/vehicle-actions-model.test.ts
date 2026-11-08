import { describe, expect, it } from 'vitest';
import { keepPublishIntent, makePublishIntent, publicationAttemptExpired, publicationIssueLabel } from './vehicle-actions-model';

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
  it('identifies the specific reviewed locale and content field', () => {
    expect(publicationIssueLabel('draft.content.title.translations.ru')).toBe('俄文标题：请填写并审核当前原文版本');
    expect(publicationIssueLabel('draft.content.description.translations.en.text')).toBe('英文描述：请填写并审核当前原文版本');
  });
  it('describes cover and verification requirements without echoing unknown server details', () => {
    expect(publicationIssueLabel('draft.media.0')).toContain('选择一张封面');
    expect(publicationIssueLabel('availability')).toContain('实际核验');
    expect(publicationIssueLabel('private.database.stack')).toBe('车辆资料：请检查未满足的发布条件');
  });
});
