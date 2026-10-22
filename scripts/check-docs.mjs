// COSMOS ATLAS documentation integrity check. Node built-ins only.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const docs = path.join(root, 'docs');
const errors = [];
const report = message => errors.push(message);
const read = name => readFileSync(name, 'utf8');
const required = [
  'AGENTS.md', 'docs/README.md', 'docs/development-scheme.md',
  'docs/development-plan.md', 'scripts/check-docs.mjs'
];
for (const file of required) if (!existsSync(path.join(root, file))) report('Missing required file: ' + file);
for (const retired of ['docs/AGENTS.md', 'docs/CHANGELOG.md',
  'docs/DEVELOPMENT_PLAN.md', 'docs/DEPLOYMENT.md']) {
  if (existsSync(path.join(root, retired))) report('Legacy/duplicate document remains: ' + retired);
}
try {
  execFileSync('git', ['check-ignore', '-q', 'docs/README.md'],
    { cwd: root, stdio: 'ignore' });
  report('docs/ is still ignored by Git');
} catch (error) {
  // Exit code 1 from git check-ignore means not ignored.
  if (error.status !== 1) report('Could not query git check-ignore: ' + error.message);
}

function walk(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap(item => {
    const full = path.join(folder, item.name);
    return item.isDirectory() ? walk(full) : (item.isFile() && item.name.endsWith('.md') ? [full] : []);
  });
}
const markdownFiles = [
  ...['README.md', 'AGENTS.md'].map(file => path.join(root, file)),
  ...walk(docs)
].filter(existsSync);
const textCache = new Map(markdownFiles.map(name => [path.normalize(name), read(name)]));
function stripFenceLines(content) {
  let inFence = false;
  return content.split(/\r?\n/).map(line => {
    if (/^\s*(?:\x60{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  }).join('\n');
}
const plainCache = new Map([...textCache].map(([filename, content]) =>
  [filename, stripFenceLines(content)]));
const anchorCache = new Map();
function anchorsFor(filename) {
  if (anchorCache.has(filename)) return anchorCache.get(filename);
  const input = plainCache.get(filename) || stripFenceLines(read(filename));
  const anchors = new Set();
  const slugs = new Map();
  for (const line of input.split('\n')) {
    for (const match of line.matchAll(/<a\s+(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
      anchors.add(match[1].toLowerCase());
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const basic = heading[1].replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    const slug = basic.toLowerCase().replace(/[^-\p{L}\p{N}\s_]/gu, '')
      .trim().replace(/\s+/g, '-');
    if (!slug) continue;
    const suffix = slugs.get(slug) || 0;
    slugs.set(slug, suffix + 1);
    anchors.add(slug + (suffix ? '-' + suffix : ''));
  }
  anchorCache.set(filename, anchors);
  return anchors;
}
let checkedLinks = 0;
for (const [filename, input] of plainCache) {
  const rel = path.relative(root, filename).replaceAll('\\', '/');
  const lines = input.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const links = line.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g);
    for (const link of links) {
      let href = link[1].trim();
      if (href.startsWith('<')) href = href.slice(1, href.indexOf('>'));
      href = href.split(/\s+["']/)[0];
      if (/^(?:https?:|mailto:|data:|app:|javascript:)/i.test(href)) continue;
      checkedLinks++;
      const hashAt = href.indexOf('#');
      const rawTarget = hashAt === -1 ? href : href.slice(0, hashAt);
      const rawAnchor = hashAt === -1 ? '' : href.slice(hashAt + 1);
      let target, anchor;
      try {
        const relative = decodeURIComponent(rawTarget);
        anchor = decodeURIComponent(rawAnchor).toLowerCase();
        target = relative ? path.resolve(path.dirname(filename), relative) : filename;
      } catch {
        report(rel + ':' + (i + 1) + ' malformed URL: ' + href);
        continue;
      }
      if (!existsSync(target)) {
        report(rel + ':' + (i + 1) + ' broken local link: ' + href);
        continue;
      }
      if (anchor && target.toLowerCase().endsWith('.md') &&
          !anchorsFor(path.normalize(target)).has(anchor)) {
        report(rel + ':' + (i + 1) + ' missing Markdown anchor: ' + href);
      }
    }
  }
}

const planFile = path.join(docs, 'development-plan.md');
const plan = existsSync(planFile) ? read(planFile) : '';
const taskMatches = [...plan.matchAll(/^\|\s*(T\d{2})\s*\|/gm)].map(match => match[1]);
const taskSet = new Set(taskMatches);
if (taskMatches.length !== taskSet.size) report('Duplicate task ID in current ledger');
for (let n = 1; n <= taskMatches.length; n++) {
  const id = 'T' + String(n).padStart(2, '0');
  if (!taskSet.has(id)) report('Non-contiguous task numbering, missing ' + id);
}
for (const [filename, input] of plainCache) {
  if (!filename.startsWith(docs)) continue;
  const rel = path.relative(root, filename).replaceAll('\\', '/');
  const matched = new Set(input.match(/\bT\d{2}\b/g) || []);
  for (const id of matched) if (!taskSet.has(id)) report(rel + ': unregistered task number ' + id);
}

const dailyFolder = path.join(docs, 'plans');
const dailyFiles = existsSync(dailyFolder) ? readdirSync(dailyFolder)
  .filter(name => name.endsWith('.md')) : [];
const validDaily = dailyFiles.filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
if (validDaily.length !== dailyFiles.length) report('Daily folder contains non-date Markdown document');
const index = existsSync(path.join(docs, 'README.md')) ? read(path.join(docs, 'README.md')) : '';
for (const name of validDaily) {
  const date = name.slice(0, 10);
  const day = read(path.join(dailyFolder, name));
  if (!index.includes('](plans/' + name + ')')) report('Date missing from docs/README.md index: ' + date);
  if (!day.includes('### ' + date + ' ·')) report('Date has no actual-change heading: ' + name);
}

const verifiedCommits = new Set();
for (const name of validDaily) {
  const content = read(path.join(dailyFolder, name));
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/(?:关联提交|提交 SHA|Git[：:])/.test(line) || /未提交/.test(line)) continue;
    for (const match of line.matchAll(/(?<![a-fA-F0-9])[a-fA-F0-9]{7,40}(?![a-fA-F0-9])/g)) {
      const sha = match[0];
      if (verifiedCommits.has(sha)) continue;
      try {
        const type = execFileSync('git', ['cat-file', '-t', sha],
          { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (type !== 'commit') report(name + ':' + (i + 1) + ' hash is not a commit: ' + sha);
        else verifiedCommits.add(sha);
      } catch {
        report(name + ':' + (i + 1) + ' missing/invalid Git commit: ' + sha);
      }
    }
  }
}

if (errors.length) {
  console.error('Documentation check FAILED (' + errors.length + ' problems):');
  errors.forEach(message => console.error('  - ' + message));
  process.exitCode = 1;
} else {
  console.log('Documentation check OK: ' + markdownFiles.length + ' Markdown files; ' +
    checkedLinks + ' local links; ' + taskMatches.length + ' task IDs; ' +
    validDaily.length + ' daily logs; ' + verifiedCommits.size + ' verified Git commits; docs/ unignored.');
}
