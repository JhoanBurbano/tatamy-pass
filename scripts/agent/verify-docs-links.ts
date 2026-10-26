/**
 * Busca enlaces rotos entre documentos Markdown del repo: `docs/**`, `README.md`,
 * `CLAUDE.md`, `AGENTS.md`, `.claude/**` y `.github/**`.
 * - Enlaces relativos a archivos: deben existir (se ignoran http(s), mailto y
 *   anclas puras).
 * - Anclas `archivo.md#seccion`: la sección debe existir (slug tipo GitHub).
 * Uso: `npm run docs:links` · `npx tsx scripts/agent/verify-docs-links.ts [--quiet]`
 * Sale con 1 si hay enlaces rotos.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const quiet = process.argv.includes('--quiet');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.cache' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

function slug(heading: string): string {
  return heading.toLowerCase().trim()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function headings(file: string): Set<string> {
  const set = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (!m) continue;
    const base = slug(m[1]);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${n}`);
  }
  return set;
}

const files = [
  ...walk(join(ROOT, 'docs')),
  ...['README.md', 'CLAUDE.md', 'AGENTS.md'].map((f) => join(ROOT, f)).filter(existsSync),
  ...(existsSync(join(ROOT, '.claude')) ? walk(join(ROOT, '.claude')) : []),
  ...(existsSync(join(ROOT, '.github')) ? walk(join(ROOT, '.github')) : []),
  ...['apps/host', 'apps/scanner', 'apps/registration', 'packages/core'].map((d) => join(ROOT, d, 'CLAUDE.md')).filter(existsSync)
];

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const headingCache = new Map<string, Set<string>>();
let broken = 0, checked = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // quita bloques de código para no validar ejemplos
  const text = src.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(LINK)) {
    const raw = m[1];
    if (/^(https?:|mailto:|tel:)/.test(raw)) continue;
    const [pathPart, anchor] = raw.split('#');
    checked++;
    let target = file;
    if (pathPart) {
      target = resolve(dirname(file), decodeURIComponent(pathPart));
      if (!existsSync(target)) {
        broken++;
        console.log(`✘ ${relative(ROOT, file)} → ${raw} (no existe ${relative(ROOT, target)})`);
        continue;
      }
      if (statSync(target).isDirectory()) continue;
    }
    if (anchor && target.endsWith('.md')) {
      if (!headingCache.has(target)) headingCache.set(target, headings(target));
      const want = decodeURIComponent(anchor).toLowerCase();
      if (!headingCache.get(target)!.has(want)) {
        broken++;
        console.log(`✘ ${relative(ROOT, file)} → ${raw} (no hay sección #${want} en ${relative(ROOT, target)})`);
      }
    }
  }
}

if (!quiet || broken) console.log(`[docs:links] ${files.length} archivos · ${checked} enlaces · ${broken} rotos`);
process.exit(broken ? 1 : 0);
