import { Card, Tag, Typography } from 'antd';
import styles from './external-sources.module.css';

export type SourceComparisonRow = {
  key: string;
  label: string;
  original: string | null;
  translations: ReadonlyArray<{ language: string; text: string | null; status?: string }>;
};

function SourceText({ text, missing }: { text: string | null; missing: string }) {
  return text === null
    ? <Typography.Text type="secondary">{missing}</Typography.Text>
    : <div className={styles.sourceText} dir="auto">{text}</div>;
}

export function SourceComparison({ rows }: { rows: readonly SourceComparisonRow[] }) {
  return <Card title="原文与译文">
    {rows.length === 0 ? <Typography.Text type="secondary">暂无可对照的文本。</Typography.Text> :
      <div className={styles.stack}>{rows.map(row => <section key={row.key}>
        <Typography.Title level={5}>{row.label}</Typography.Title>
        <div className={styles.comparison}>
          <div>
            <Typography.Text strong>来源原文</Typography.Text>
            <SourceText text={row.original} missing="来源未提供原文" />
          </div>
          {row.translations.map(translation => <div key={translation.language}>
            <Typography.Text strong>{translation.language}</Typography.Text>
            {translation.status && <Tag className={styles.translationStatus}>{translation.status}</Tag>}
            <SourceText text={translation.text} missing="暂无译文" />
          </div>)}
        </div>
      </section>)}</div>}
  </Card>;
}
