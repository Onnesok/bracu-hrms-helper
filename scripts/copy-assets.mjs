import {cpSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const src = join(root, 'assets');
const dist = join(root, 'dist');
mkdirSync(dist, {recursive: true});
cpSync(src, dist, {recursive: true, force: true});
console.log('Build ready:', dist);
