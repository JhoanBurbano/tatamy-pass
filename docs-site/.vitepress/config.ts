import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DOCS = resolve(import.meta.dirname ?? process.cwd(), '..', '..', 'docs');

/** ADRs y plantillas se listan automáticamente desde el disco. */
function listDir(sub: string, prefix: string): { text: string; link: string }[] {
  const dir = join(DOCS, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => ({ text: titleOf(join(dir, f), f), link: `/${prefix}/${f.replace(/\.md$/, '')}` }));
}

function titleOf(path: string, fallback: string): string {
  try {
    const first = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith('# '));
    return first ? first.replace(/^#\s*/, '').replace(/^(ADR-)?\d+\s*·\s*/, '') : fallback;
  } catch {
    return fallback;
  }
}


/**
 * Los documentos usan `<token>`, `<nombre>`, `<ip-del-host>`… como marcadores
 * fuera de bloques de código. Vue los tomaría por componentes y rompería el
 * build. Este plugin de markdown-it escapa cualquier etiqueta HTML inline que
 * no esté en la lista blanca, sin tocar el Markdown original.
 */
const HTML_ALLOWED = new Set(['br', 'details', 'summary', 'kbd', 'sub', 'sup', 'img', 'a', 'span', 'div', 'p', 'b', 'i', 'em', 'strong', 'code', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'ul', 'ol', 'li', 'hr', 'small', 'mark', 'del', 'ins', 'badge']);
function escapePlaceholders(md: { core: { ruler: { push: (name: string, fn: (state: { tokens: Token[] }) => void) => void } } }): void {
  type Token = { type: string; content: string; children?: Token[] | null };
  const esc = (t: Token) => {
    const m = t.content.match(/^<\/?([A-Za-z][A-Za-z0-9-]*)/);
    if (!m || HTML_ALLOWED.has(m[1].toLowerCase())) return;
    t.type = 'text';
    t.content = t.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  md.core.ruler.push('tp_escape_placeholders', (state) => {
    for (const tok of state.tokens) {
      if (tok.type === 'html_block') esc(tok);
      if (tok.children) for (const c of tok.children) if (c.type === 'html_inline') esc(c);
    }
  });
}

export default withMermaid(
  defineConfig({
    lang: 'es-CO',
    title: 'Tatami Pass',
    description: 'Acreditación y control de accesos del Campeonato Nacional de Taekwondo ITF 2026. Funciona aunque no haya red.',
    srcDir: '../docs',
    outDir: './dist',
    cacheDir: './.cache',
    cleanUrls: true,
    lastUpdated: false,
    rewrites: { 'README.md': 'index.md', '95-ADR/README.md': '95-ADR/index.md', '_plantillas/README.md': '_plantillas/index.md' },
    // Los enlaces al código (`../apps/...`) y a localhost no son páginas del sitio.
    ignoreDeadLinks: [/\.\.\//, /localhost/, /^https?:\/\/10\./],
    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
      ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
      ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap' }],
      ['meta', { name: 'theme-color', content: '#1C4FD1' }]
    ],
    themeConfig: {
      logo: { src: '/logo.svg', alt: 'Tatami Pass' },
      siteTitle: false,
      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar en la documentación' },
            modal: {
              displayDetails: 'Mostrar detalle', resetButtonTitle: 'Limpiar', backButtonTitle: 'Volver', noResultsText: 'No encontré nada para',
              footer: { selectText: 'abrir', selectKeyAriaLabel: 'enter', navigateText: 'moverse', navigateUpKeyAriaLabel: 'arriba', navigateDownKeyAriaLabel: 'abajo', closeText: 'cerrar', closeKeyAriaLabel: 'esc' }
            }
          }
        }
      },
      nav: [
        { text: 'Organizadores', link: '/10-PRD' },
        { text: 'Operación', link: '/50-OPERACION' },
        { text: 'Técnico', link: '/30-ARQUITECTURA' },
        { text: 'Pruebas', link: '/20-RF-TEST' },
        { text: 'Montaje', link: '/90-MONTAJE-ECOSISTEMA' }
      ],
      sidebar: [
        { text: 'Empezar', items: [{ text: 'Mapa de la documentación', link: '/' }, { text: '00 · Decisiones (contrato)', link: '/00-DECISIONES' }, { text: '99 · Changelog', link: '/99-CHANGELOG' }] },
        {
          text: 'Organizadores',
          collapsed: false,
          items: [
            { text: '10 · PRD', link: '/10-PRD' },
            { text: '60 · Manuales por rol', link: '/60-MANUALES-POR-ROL' },
            { text: '70 · UX writing', link: '/70-UX-WRITING' },
            { text: '40 · Seguridad e ISO 27001', link: '/40-SEGURIDAD-ISO27001' }
          ]
        },
        {
          text: 'Operación',
          collapsed: false,
          items: [
            { text: '90 · Montaje del ecosistema', link: '/90-MONTAJE-ECOSISTEMA' },
            { text: '50 · Runbook de operaciones', link: '/50-OPERACION' },
            { text: '85 · Despliegue de la nube', link: '/85-DESPLIEGUE-NUBE' },
            { text: '86 · App de escritorio del host', link: '/86-APP-ESCRITORIO' },
            { text: '32 · Configuración del evento', link: '/32-CONFIG-EVENTO' },
            { text: 'Plantillas', collapsed: true, items: listDir('_plantillas', '_plantillas') }
          ]
        },
        {
          text: 'Técnico',
          collapsed: false,
          items: [
            { text: '30 · Arquitectura', link: '/30-ARQUITECTURA' },
            { text: '31 · Referencia de la API', link: '/31-API-REFERENCIA' },
            { text: '32 · Configuración del evento', link: '/32-CONFIG-EVENTO' },
            { text: '36 · Trabajar con agentes', link: '/36-AGENTES' },
            { text: '95 · ADRs', collapsed: true, items: listDir('95-ADR', '95-ADR') }
          ]
        },
        {
          text: 'Pruebas',
          collapsed: false,
          items: [
            { text: '20 · Plan de pruebas', link: '/20-RF-TEST' },
            { text: '80 · Cómo probar', link: '/80-COMO-PROBAR' }
          ]
        }
      ],
      outline: { level: [2, 3], label: 'En esta página' },
      docFooter: { prev: 'Anterior', next: 'Siguiente' },
      sidebarMenuLabel: 'Menú',
      returnToTopLabel: 'Volver arriba',
      darkModeSwitchLabel: 'Tema',
      footer: { message: 'Tatami Pass · Campeonato Nacional de Taekwondo ITF 2026', copyright: 'Documentación generada desde docs/ · Mermaid y búsqueda local' }
    },
    markdown: { config: (md) => escapePlaceholders(md as never) },
    mermaid: { theme: 'neutral' },
    mermaidPlugin: { class: 'mermaid tp-diagram' }
  })
);
