import { describe, expect, it } from 'vitest';
import { TranslatableFieldSchema, type TranslatableField } from '@hd/contracts/admin';
import { makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { approveTranslation, editTranslation, prepareTranslationField, translationReviewState, translationSource } from './translation-model';

function field(): TranslatableField { return makeVehicleDraftFixture().content.title; }

describe('三语编辑、来源与审核版本', () => {
  it('未编辑内容与保存版本保持原样，不因其他字段变更提升版本', () => {
    const original = field();
    expect(prepareTranslationField(original, original.sourceText!, original.sourceLanguage)).toEqual(original);
    expect(editTranslation(original, 'en', original.translations.en!.text, original.sourceText!, original.sourceLanguage)).toBe(original);
    expect(approveTranslation(original, 'en', true, original.sourceText!, original.sourceLanguage).translations.en!.humanEditVersion).toBe(original.translations.en!.humanEditVersion);
  });

  it('原文修改保留译文与旧版本，并撤销审核；保存新原文前不能审核', () => {
    const original = field();
    const next = prepareTranslationField(original, '新的原文', 'zh');
    expect(next.sourceVersion).toBe(original.sourceVersion);
    expect(next.sourceText).toBe('新的原文');
    expect(next.translations.ru!.text).toBe(original.translations.ru!.text);
    expect(next.translations.ru!.reviewStatus).toBe('stale');
    expect(next.translations.ru!.sourceVersion).toBe(original.translations.ru!.sourceVersion);
    expect(translationReviewState(original, 'ru', '新的原文', 'zh')).toBe('stale');
    expect(approveTranslation(original, 'ru', true, '新的原文', 'zh')).toBe(original);
  });

  it('已保存新原文可显式审核旧译文，使用当前来源版本但保留人工版本', () => {
    const current = field();
    current.sourceVersion = 2;
    current.translations.ru!.reviewStatus = 'stale';
    const result = approveTranslation(current, 'ru', true, current.sourceText!, 'zh');
    expect(result.translations.ru!.reviewStatus).toBe('approved');
    expect(result.translations.ru!.sourceVersion).toBe(2);
    expect(result.translations.ru!.humanEditVersion).toBe(current.translations.ru!.humanEditVersion);
    expect(TranslatableFieldSchema.safeParse(result).success).toBe(true);
  });

  it('人工改写机器译文不冒充机器来源，修改后必须重新审核', () => {
    const current = field();
    current.translations.ru!.kind = 'machine';
    current.translations.ru!.engineVersion = 'existing-engine';
    const result = editTranslation(current, 'ru', 'Исправленный текст', current.sourceText!, 'zh');
    expect(result.translations.ru).toMatchObject({ kind: 'human', engineVersion: null, reviewStatus: 'pending', sourceVersion: current.sourceVersion, humanEditVersion: current.translations.ru!.humanEditVersion });
    const reviewed = approveTranslation(current, 'ru', true, current.sourceText!, 'zh');
    expect(reviewed.translations.ru!.kind).toBe('machine');
    expect(reviewed.translations.ru!.engineVersion).toBe('existing-engine');
  });

  it('只有基础语言与全文匹配才允许原文身份，复制原文不自动审核', () => {
    const current = field();
    current.sourceLanguage = 'zh-CN';
    current.translations.zh = null;
    const copied = editTranslation(current, 'zh', current.sourceText!, current.sourceText!, 'zh-CN');
    expect(copied.translations.zh!.kind).toBe('original');
    expect(copied.translations.zh!.reviewStatus).toBe('pending');
    const rewritten = editTranslation(copied, 'zh', `${current.sourceText!}（改写）`, current.sourceText!, 'zh-CN');
    expect(rewritten.translations.zh!.kind).toBe('human');
    const otherLocale = editTranslation(current, 'en', current.sourceText!, current.sourceText!, 'zh-CN');
    expect(otherLocale.translations.en!.kind).toBe('human');
  });

  it('空描述保持全null，空白译文不构造已审核的空对象', () => {
    const empty: TranslatableField = { sourceLanguage: 'zh', sourceText: null, sourceVersion: 1, translations: { zh: null, en: null, ru: null } };
    expect(prepareTranslationField(empty, '', 'zh')).toEqual(empty);
    expect(editTranslation(empty, 'ru', '   ', '', 'zh').translations.ru).toBeNull();
    expect(approveTranslation(empty, 'ru', true, '', 'zh')).toBe(empty);
    expect(TranslatableFieldSchema.safeParse(empty).success).toBe(true);
  });

  it('清空后重新输入仍携带已保存人工版本，避免新文本被当成旧写入', () => {
    const current = field();
    current.translations.ru!.humanEditVersion = 7;
    const cleared = editTranslation(current, 'ru', '', current.sourceText!, 'zh');
    expect(cleared.translations.ru).toBeNull();
    const restored = editTranslation(cleared, 'ru', 'Новый текст', current.sourceText!, 'zh', 7);
    expect(restored.translations.ru!.humanEditVersion).toBe(7);
    expect(restored.translations.ru!.reviewStatus).toBe('pending');
  });

  it('未改的原文空白不被清理，新增输入沿用表单的归一化规则', () => {
    const current = field(); current.sourceText = ' 保留原文空白 ';
    expect(translationSource(current, current.sourceText, 'zh').changed).toBe(false);
    expect(prepareTranslationField(current, current.sourceText, 'zh').sourceText).toBe(current.sourceText);
    expect(prepareTranslationField(current, ' 新的原文 ', 'zh').sourceText).toBe('新的原文');
  });
});
