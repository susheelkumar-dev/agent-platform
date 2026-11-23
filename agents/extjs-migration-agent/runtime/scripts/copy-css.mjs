// tsc does not copy CSS: the component theme is published as @extreact/runtime/theme.css.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
copyFileSync('src/theme/triton.css', 'dist/theme.css');
console.log('dist/theme.css written');
