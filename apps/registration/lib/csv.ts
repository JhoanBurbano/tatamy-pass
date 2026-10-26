/** CSV con BOM (para que Excel abra UTF-8 bien) y separador `;` opcional. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][], sep = ','): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(sep)).join('\r\n') + '\r\n';
}
