// tsc does not copy CSS: put the framework and grid styles next to the compiled code.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
const own = readFileSync('src/styles.css', 'utf8').replace(/^@import '.\/grid\/datagrid.css';\n/m, '');
const css = [readFileSync('src/grid/datagrid.css', 'utf8'), own].join('\n');
writeFileSync('dist/styles.css', css);
console.log('dist/styles.css written');
