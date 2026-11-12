import { ExternalHttpsUrlSchema } from '@hd/contracts/public';

export function SourceReportLink({ url }: { url: string | null | undefined }) {
  const link = ExternalHttpsUrlSchema.safeParse(url);
  if (!link.success) return null;

  return <a href={link.data} target="_blank" rel="noopener noreferrer">打开来源报告</a>;
}
