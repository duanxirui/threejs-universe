// One-time migration; source files remain untouched until new files are verified.
import { readFile, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const docs = path.resolve('docs');
const sourcePlanPath = path.join(docs, 'DEVELOPMENT_PLAN.md');
const sourceLogPath = path.join(docs, 'CHANGELOG.md');
const sourceDeployPath = path.join(docs, 'DEPLOYMENT.md');
const schemePath = path.join(docs, 'development-scheme.md');
const todayPath = path.join(docs, 'plans', '2026-10-21.md');
const dates = ['2026-10-15', '2026-10-20', '2026-10-21'];
const exists = async p => access(p).then(() => true, () => false);
const hash = data => createHash('sha256').update(data).digest('hex');

if (await exists(schemePath) || await exists(todayPath)) {
  throw new Error('Migration target exists; inspect instead of overwriting.');
}
const [sourcePlan, sourceLog, sourceDeploy, old15, old20] = await Promise.all([
  readFile(sourcePlanPath, 'utf8'), readFile(sourceLogPath, 'utf8'),
  readFile(sourceDeployPath, 'utf8'),
  readFile(path.join(docs, 'plans', '2026-10-15.md'), 'utf8'),
  readFile(path.join(docs, 'plans', '2026-10-20.md'), 'utf8')
]);
const logSectionStart = sourceLog.indexOf('## 变更记录（最新在前）');
const logSectionEnd = sourceLog.indexOf('\n---\n\n## 新记录模板', logSectionStart);
if (logSectionStart < 0 || logSectionEnd < 0) throw new Error('Unknown legacy log structure');
const logBody = sourceLog.slice(logSectionStart + '## 变更记录（最新在前）'.length, logSectionEnd);
const headings = [...logBody.matchAll(/^### (\d{4}-\d{2}-\d{2}) · .+$/gm)];
if (headings.length !== 41) throw new Error('Expected 41 historical records; found ' + headings.length);
const grouped = new Map(dates.map(date => [date, []]));
function adaptLogLinks(content) {
  return content
    .replace(/\]\(plans\/([^)]+)\)/g, ']($1)')
    .replace(/\]\(baselines\/([^)]+)\)/g, '](../baselines/$1)')
    .replace(/\]\(DEVELOPMENT_PLAN\.md(#[^)]*)?\)/g, (_m, suffix = '') =>
      '](../' + (suffix === '#daily-plan-index' ? 'README.md#按日开发日志索引' : 'development-plan.md') + ')');
}
for (let i = 0; i < headings.length; i++) {
  const date = headings[i][1];
  if (!grouped.has(date)) throw new Error('Unexpected legacy date: ' + date);
  const start = headings[i].index;
  const end = i + 1 < headings.length ? headings[i + 1].index : logBody.length;
  grouped.get(date).push(adaptLogLinks(logBody.slice(start, end).trim()));
}
const counts = dates.map(date => grouped.get(date).length);
if (counts.join('/') !== '25/13/3') throw new Error('Unexpected daily counts: ' + counts.join('/'));

const schemeIntro = [
  '# COSMOS ATLAS · 开发方案与技术设计',
  '',
  '> 2026-10-21 起，此文件维护设计与架构。当前进度唯一来源为 [任务台账](development-plan.md)；后面的旧状态只代表历史，不再作为当前任务结论。',
  '',
  '## 现行设计概览',
  '',
  '- **产品目标：** 从银河全景进入太阳系，再飞近太阳、行星和代表性卫星，科普介绍与轨道/时间数据采用演示缩放。',
  '- **技术基础：** Three.js 负责场景与 GPU 渲染；GSAP 负责镜头过渡；Vite 打包，原生 JavaScript 更新统一的 UI 状态。',
  '- **交互布局：** T15 v3 四角构图，左上品牌、右上全局操作、左下当前场景、右下资料/时间/天体列表；所有场景复用同一资料面板。',
  '- **数据与纹理：** 太阳、八行星、十三颗代表卫星；天文数值与演示尺寸分离。本地 JPG、选择性 KTX2、程序化材质明确区分真实与示意。',
  '- **镜头、航行与时间：** 独立聚焦/复位、自由飞行锁定及安全制动、日期滑杆与自转/公转同步。',
  '- **响应式与性能：** 手机单/多指、抽屉及横竖屏避障，自动画质、后台暂停；实际 GPU 性能以实体设备为准。',
  '- **开发原则：** 复用同一业务源和 DOM 节点，不引入竞争状态；当前任务进度统一由 [开发计划](development-plan.md) 维护。',
  '',
  '## 设计演变与证据',
  '',
  '| 日期 | 决策 | 来源 |',
  '| --- | --- | --- |',
  '| 2026-10-15 | V1/V2 核心功能与纹理/触控/性能扩展 | [历史方案](plans/2026-10-15.md) |',
  '| 2026-10-20 | T08～T15 设计，沉浸界面演进为四角 v3 | [T15 原方案](plans/2026-10-20.md#t15) |',
  '| 2026-10-21 | 统一资料卡、纯净/全屏修复和文档治理 | [实际记录](plans/2026-10-21.md) |',
  '',
  '---',
  '',
  '<a id="legacy-development-plan"></a>',
  '',
  '## 历史 V1/V2 开发方案与旧状态对照',
  '',
  '以下收录旧 DEVELOPMENT_PLAN.md 的方案与评估原文，SHA-256：' + hash(sourcePlan) + '。其中所有“目前”“下一步”和旧维护规则均为 2026-10-20 时的历史记录，现行规则参阅 [文档中心](README.md)。',
  ''
].join('\n');
const historical = sourcePlan
  .replace(/^# [^\r\n]+\r?\n/, '### 旧版开发计划、缺口评估和历史方案正文\n')
  .replace(/\]\(CHANGELOG\.md\)/g, '](plans/2026-10-21.md)')
  .replace(/\]\(DEPLOYMENT\.md\)/g, '](#deployment-guide)');
const deployment = sourceDeploy
  .replace(/^# [^\r\n]+\r?\n/, '### GitHub Pages 旧部署说明正文\n')
  .replace(/^> 本文件保存在本地.*\r?\n/m,
    '> 迁移说明：旧版本曾忽略 docs/，现已解除 Git 忽略；本节配置步骤并非线上验收结论。');
const scheme = schemeIntro + historical.trim() + '\n\n---\n\n' +
  '<a id="deployment-guide"></a>\n\n## GitHub Pages 部署与排障\n\n' +
  '旧 DEPLOYMENT.md 已并入本节；源文件 SHA-256：' + hash(sourceDeploy) + '。\n\n' +
  deployment.trim() + '\n';

function oldDaily(date, source) {
  const heading = [
    '# COSMOS ATLAS · ' + date + ' 实际开发日志与历史方案',
    '',
    '> 以下原有状态只代表 ' + date + ' 当时记录；最新状态以 [开发计划](../development-plan.md) 为准。保留旧方案正文与固定 TXX 锚点供追溯。',
    '',
    '## 当日实际开发记录（从旧变更日志迁入）',
    '',
    grouped.get(date).join('\n\n'),
    '',
    '---',
    '',
    '## 当日原有方案和实施记录（历史原文）',
    ''
  ].join('\n');
  const original = source.replace(/^# [^\r\n]+\r?\n/, '')
    .replace(/\]\(\.\.\/DEVELOPMENT_PLAN\.md#daily-plan-index\)/g,
      '](../README.md#按日开发日志索引)')
    .replace(/\]\(\.\.\/DEVELOPMENT_PLAN\.md\)/g, '](../development-plan.md)');
  return heading + original;
}
const migrated15 = oldDaily('2026-10-15', old15);
const migrated20 = oldDaily('2026-10-20', old20);
const today = [
  '# COSMOS ATLAS · 2026-10-21 实际开发日志',
  '',
  '> 任务当前进度以 [T15/T16 台账](../development-plan.md) 为准，下列记录为当天实际发生的工作。',
  '',
  '## 当日实际开发记录',
  '',
  '### 2026-10-21 · [文档] T16：启用统一规则与 Git 文档管理',
  '',
  '- **需求/原因：** 统一开发方案、当前计划、按日记录和历史追溯；解除 docs/ Git 忽略。',
  '- **实际完成：** 建立根目录 AGENTS.md、docs/README.md、development-scheme.md、development-plan.md；将旧日志 41 条按日期迁入三份日报，保留 V1/V2 评估、历史方案、部署说明和固定 T01～T15 锚点；增加自动文档校验。',
  '- **影响文件：** .gitignore、AGENTS.md、README.md、package.json、docs/、scripts/check-docs.mjs、scripts/migrate-docs-2026-10-21.mjs。',
  '- **验证：** 历史记录数和 SHA-256 在迁移时核对；文档链接、任务编号、索引和 Git SHA 待执行 node scripts/check-docs.mjs 后回填真实结果。',
  '- **限制/后续：** 旧历史状态只供追溯；实体设备相关待验收仍在开发计划中。Git 由用户决定何时暂存、提交和推送。',
  '- **Git：** 未提交。',
  '',
  '### 历史迁移来源与计数',
  '',
  '- 原开发计划 SHA-256：' + hash(sourcePlan),
  '- 原变更日志 SHA-256：' + hash(sourceLog),
  '- 原部署文档 SHA-256：' + hash(sourceDeploy),
  '- 实际归档旧变更记录 41 条：10-15 为 25 条，10-20 为 13 条，10-21 为 3 条。',
  '',
  grouped.get('2026-10-21').join('\n\n'),
  ''
].join('\n');
const outputs = [
  [schemePath, scheme],
  [path.join(docs, 'plans', '2026-10-15.md'), migrated15],
  [path.join(docs, 'plans', '2026-10-20.md'), migrated20],
  [todayPath, today]
];
for (const [filename, data] of outputs) await writeFile(filename, data, 'utf8');
for (const [filename] of outputs) {
  if ((await readFile(filename, 'utf8')).length < 500) {
    throw new Error('Migrated output unexpectedly short: ' + filename);
  }
}
for (const date of dates) {
  const migrated = await readFile(path.join(docs, 'plans', date + '.md'), 'utf8');
  for (const entry of grouped.get(date)) {
    if (!migrated.includes(entry)) throw new Error('Lost a historical entry: ' + date);
  }
}
if (!(await readFile(schemePath, 'utf8')).includes('## 12. 沉浸式升级方案（历史存档）')) {
  throw new Error('Historical V1/V2 content did not survive');
}
const gitignorePath = path.resolve('.gitignore');
const before = await readFile(gitignorePath, 'utf8');
if (!/^docs\/\s*$/m.test(before)) throw new Error('Expected ignored docs/ entry is missing');
await writeFile(gitignorePath, before.replace(/^docs\/\s*\r?\n?/m, ''), 'utf8');
for (const old of [sourcePlanPath, sourceLogPath, sourceDeployPath]) await unlink(old);
console.log(JSON.stringify({
  migratedEntriesPerDay: counts,
  sourceHashes: [hash(sourcePlan), hash(sourceLog), hash(sourceDeploy)],
  schemeBytes: Buffer.byteLength(scheme),
  docsGitIgnoreRemoved: true
}, null, 2));
