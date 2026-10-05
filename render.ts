import satori from 'satori';
import { parse } from 'node-html-parser';
import { readFileSync, writeFileSync, existsSync } from 'fs';

interface Config {
  username: string;
  environment: string;
}

interface Repo {
  name: string;
  description: string;
  language: string;
  fork: boolean;
  pushed_at: string;
}

interface LangStat {
  name: string;
  count: number;
  pct: number;
  color: string;
}

interface Theme {
  name: string;
  textPrimary: string;
  textMuted: string;
  borderOuter: string;
  borderInner: string;
  panelBg: string;
  barBg: string;
  accentBullet: string;
  outputFile: string;
}

const themes: Theme[] = [
  {
    name: 'dark',
    textPrimary: '#f0f6fc',
    textMuted: '#8b949e',
    borderOuter: '#30363d',
    borderInner: '#21262d',
    panelBg: '#161b22',
    barBg: '#21262d',
    accentBullet: '#3fb950',
    outputFile: './profile-card-dark.svg',
  },
  {
    name: 'light',
    textPrimary: '#1f2328',
    textMuted: '#656d76',
    borderOuter: '#d0d7de',
    borderInner: '#d8dee4',
    panelBg: '#f6f8fa',
    barBg: '#eaeef2',
    accentBullet: '#1a7f37',
    outputFile: './profile-card-light.svg',
  },
];

const langColors: Record<string, string> = {
  Go: '#00ADD8',
  Rust: '#dea584',
  Dart: '#0175C2',
  TypeScript: '#3178c6',
  Svelte: '#f1413d',
  Python: '#3572A5',
  'C++': '#f34b7d',
  Slint: '#a855f7',
  Shell: '#89e051',
  C: '#555555',
};

function loadConfig(): Config {
  if (existsSync('./config.json')) {
    return JSON.parse(readFileSync('./config.json', 'utf-8'));
  }
  return { username: 'dotsem', environment: 'Linux (CachyOS + Niri)' };
}

function loadWhitelist(path: string): Set<string> {
  const set = new Set<string>();
  if (!existsSync(path)) return set;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed && !trimmed.startsWith('#')) {
      set.add(trimmed);
    }
  }
  return set;
}

async function fetchRepos(username: string): Promise<Repo[]> {
  const headers: Record<string, string> = { 'User-Agent': 'dotsem-readme-render' };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com/users/${username}/repos?sort=pushed&per_page=100`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API request failed with status: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`GitHub API returned 0 repositories or invalid response for ${username}`);
  }
  return data as Repo[];
}

function calculateLangStats(repos: Repo[], limit = 6): LangStat[] {
  const counts: Record<string, number> = {};
  let total = 0;

  for (const r of repos) {
    if (!r.language || r.language === 'HTML' || r.language === 'CSS') continue;
    counts[r.language] = (counts[r.language] || 0) + 1;
    total++;
  }

  if (total === 0) return [];

  const stats = Object.entries(counts).map(([name, count]) => ({
    name,
    count,
    pct: Math.round((count / total) * 100),
    color: langColors[name] || '#8b949e',
  }));

  stats.sort((a, b) => b.count - a.count);
  return stats.slice(0, limit);
}

function toVNode(node: any): any {
  if (node.nodeType === 3) {
    const text = node.rawText;
    if (!text || text.trim() === '') return null;
    return text;
  }
  if (node.nodeType !== 1) return null;

  const rawStyle = node.getAttribute('style') || '';
  const style: Record<string, any> = {};
  if (rawStyle) {
    for (const decl of rawStyle.split(';')) {
      const idx = decl.indexOf(':');
      if (idx !== -1) {
        const k = decl.slice(0, idx).trim();
        const v = decl.slice(idx + 1).trim();
        style[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
      }
    }
  }

  const children = node.childNodes.map(toVNode).filter((c: any) => c !== null);
  return {
    type: node.tagName.toLowerCase(),
    props: {
      style,
      children: children.length === 1 ? children[0] : (children.length > 0 ? children : undefined),
    },
  };
}

function buildHtml(templateStr: string, theme: Theme, env: string, projects: Repo[], langs: LangStat[]): string {
  const projectsHtml = projects.map((p, idx) => {
    let desc = p.description || '';
    if (desc.length > 55) desc = desc.slice(0, 52).trim() + '...';
    const mb = idx < projects.length - 1 ? '6px' : '0px';
    const langColor = langColors[p.language] || theme.borderInner;
    return `
      <div style="display: flex; flex-direction: column; background-color: ${theme.panelBg}; border-width: 1px; border-style: solid; border-color: ${theme.borderInner}; border-right-width: 3px; border-right-color: ${langColor}; padding: 7px 10px; margin-bottom: ${mb};">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px;">
          <span style="color: ${theme.textPrimary}; font-size: 13px; font-weight: 500;">${p.name}</span>
          <span style="color: ${theme.textMuted}; font-size: 11px;">${p.language || ''}</span>
        </div>
        <span style="color: ${theme.textMuted}; font-size: 11px;">${desc}</span>
      </div>
    `;
  }).join('');

  const langBarHtml = langs.map(l => {
    const widthPx = Math.max(4, Math.round((l.pct / 100) * 288));
    return `<div style="display: flex; width: ${widthPx}px; height: 8px; background-color: ${l.color};"></div>`;
  }).join('');

  const langRows: string[] = [];
  for (let i = 0; i < langs.length; i += 2) {
    const l1 = langs[i];
    const l2 = langs[i + 1];
    langRows.push(`
      <div style="display: flex; flex-direction: row; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; width: 144px;">
          <div style="display: flex; width: 8px; height: 8px; background-color: ${l1.color}; margin-right: 6px;"></div>
          <span>${l1.name} <span style="color: ${theme.textMuted}; margin-left: 4px;">${l1.pct}%</span></span>
        </div>
        ${l2 ? `
        <div style="display: flex; align-items: center; width: 144px;">
          <div style="display: flex; width: 8px; height: 8px; background-color: ${l2.color}; margin-right: 6px;"></div>
          <span>${l2.name} <span style="color: ${theme.textMuted}; margin-left: 4px;">${l2.pct}%</span></span>
        </div>
        ` : ''}
      </div>
    `);
  }

  return templateStr
    .replaceAll('{{TEXT_PRIMARY}}', theme.textPrimary)
    .replaceAll('{{TEXT_MUTED}}', theme.textMuted)
    .replaceAll('{{BORDER_OUTER}}', theme.borderOuter)
    .replaceAll('{{BORDER_INNER}}', theme.borderInner)
    .replaceAll('{{BAR_BG}}', theme.barBg)
    .replaceAll('{{ACCENT_BULLET}}', theme.accentBullet)
    .replaceAll('{{ENVIRONMENT}}', env)
    .replace('{{PROJECTS}}', projectsHtml)
    .replace('{{LANG_BAR}}', langBarHtml)
    .replace('{{LANG_LIST}}', langRows.join(''));
}

async function main() {
  const config = loadConfig();
  const whitelist = loadWhitelist('./whitelist.txt');

  const allRepos = await fetchRepos(config.username);
  const repos = allRepos.filter(r => whitelist.size === 0 || whitelist.has(r.name.toLowerCase()));
  repos.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());

  if (repos.length < 4) {
    throw new Error(`Data incomplete: found only ${repos.length} whitelisted repositories, minimum 4 required.`);
  }

  const topProjects = repos.slice(0, 4);
  const topLangs = calculateLangStats(repos, 6);
  if (topLangs.length < 6) {
    throw new Error(`Data incomplete: found only ${topLangs.length} languages across whitelisted repositories, expected 6.`);
  }

  const rawTemplate = readFileSync('./card.template.html', 'utf-8');
  const font400 = readFileSync('./fonts/jetbrains-mono-400.ttf');
  const font600 = readFileSync('./fonts/jetbrains-mono-600.ttf');

  for (const theme of themes) {
    const renderedHtml = buildHtml(rawTemplate, theme, config.environment, topProjects, topLangs);
    const parsed = parse(renderedHtml.trim());
    const vnode = toVNode(parsed.childNodes.find((n: any) => n.nodeType === 1));

    let svg = await satori(vnode, {
      width: 800,
      height: 330,
      fonts: [
        { name: 'JetBrains Mono', data: font400, weight: 400, style: 'normal' },
        { name: 'JetBrains Mono', data: font600, weight: 600, style: 'normal' },
      ],
    });

    svg = svg.replace('<svg width="800" height="330"', '<svg width="100%" height="100%"');
    writeFileSync(theme.outputFile, svg);

    const written = readFileSync(theme.outputFile, 'utf-8');
    if (written.length < 1000 || !written.startsWith('<svg') || !written.endsWith('</svg>')) {
      throw new Error(`Integrity check failed: ${theme.outputFile} is corrupt or improperly generated.`);
    }

    console.log(`Rendered & verified ${theme.outputFile} (${theme.name})`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
