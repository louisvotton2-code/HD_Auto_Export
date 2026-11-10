// Synthetic text only. HTTP success is not a translation quality approval.
const baseUrl = "http://127.0.0.1:3340";
const samples = [
  {
    id: "toyota-title",
    source: "2021款 丰田 RAV4 荣放 2.0L 两驱都市版",
  },
  {
    id: "toyota-description",
    source:
      "2021年上牌，表显里程32,000公里。未发现重大事故，但尚未提供独立检测报告。报价人民币128,800元，不含运费、税费和目的国清关费用。库存与最终价格待人工确认。",
  },
  {
    id: "byd-title",
    source: "比亚迪 宋 PLUS DM-i 2023款 冠军版",
  },
  {
    id: "byd-description",
    source:
      "1.5L 插电式混合动力，续航110公里。车辆并非零公里新车。车身有轻微划痕，不能承诺无事故或无水泡。不得把“待核验”改写为“已核验”。",
  },
  {
    id: "fact-boundaries",
    source:
      "示例编号TEST-CAR-20261108，仅为测试文本。参考价99,999元人民币，不包含增值税；里程100,001公里；年份2020，排量1,998毫升。没有确认事故记录，不等于没有事故。",
  },
];

async function request(path, body) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return { milliseconds: Math.round(performance.now() - started), result };
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  baseUrl,
  health: await request("/health"),
  languages: await request("/languages"),
  translations: [],
};
for (const sample of samples) {
  for (const target of ["en", "ru"]) {
    report.translations.push({
      ...sample,
      target,
      ...(await request("/translate", {
        q: sample.source,
        source: "zh",
        target,
        format: "text",
      })),
    });
  }
}
console.log(JSON.stringify(report, null, 2));
