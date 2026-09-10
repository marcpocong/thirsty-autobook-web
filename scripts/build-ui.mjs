import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/ui/renderer', { recursive: true });
for (const file of ['index.html', 'styles.css']) await copyFile(`ui/renderer/${file}`, `dist/ui/renderer/${file}`);
