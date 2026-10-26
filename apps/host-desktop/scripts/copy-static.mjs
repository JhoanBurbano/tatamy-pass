// Copia index.html y styles.css del renderer a dist/ (tsc solo emite .js).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist', 'renderer'), { recursive: true });
for (const f of ['index.html', 'styles.css']) copyFileSync(join(root, 'src', 'renderer', f), join(root, 'dist', 'renderer', f));
