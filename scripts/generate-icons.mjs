import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Only source artwork: paths are never redrawn or replaced.
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('public/newnew.svg', root), 'utf8');
if (!source.includes('viewBox="0 0 750 750"') || !source.includes('fill="black"')) {
  throw new Error('Source artwork changed; review its canvas and fill before regenerating.');
}
const white = source.replaceAll('fill="black"', 'fill="white"');
async function png(path, size, dark = false) {
  await sharp(Buffer.from(dark ? white : source), { density: 300 })
    .resize(size, size).flatten({ background: dark ? '#161616' : '#ffffff' })
    .removeAlpha().png().toFile(new URL(path, root).pathname);
}
for (const [name, size] of [
  ['icon-192.png', 192], ['icon-512.png', 512], ['favicon-96x96.png', 96],
  ['apple-touch-icon.png', 180], ['apple-touch-icon-120x120.png', 120],
  ['apple-touch-icon-152x152.png', 152], ['apple-touch-icon-167x167.png', 167],
]) await png(`public/${name}`, size);
const maskableMark = await sharp(Buffer.from(source), { density: 300 }).resize(432, 432).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: '#ffffff' } })
  .composite([{ input: maskableMark, left: 40, top: 40 }]).png()
  .toFile(new URL('public/icon-maskable-512.png', root).pathname);

// CSS affects only appearance; the original vector geometry is kept intact.
const favicon = source.replace('fill="black"', 'class="mark" fill="black"')
  .replace(/(<svg[^>]*>)/, '$1\n<style>.mark{fill:#000}@media(prefers-color-scheme:dark){.mark{fill:#fff}}</style>');
await writeFile(new URL('public/favicon.svg', root), favicon);

// Multi-resolution ICO using PNG entries supported by current browsers.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(source), { density: 300 })
  .resize(size, size).flatten({ background: '#ffffff' }).removeAlpha().png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, index) => {
  const pos = 6 + 16 * index;
  header[pos] = sizes[index]; header[pos + 1] = sizes[index];
  header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(data.length, pos + 8); header.writeUInt32LE(offset, pos + 12);
  offset += data.length;
});
await writeFile(new URL('public/favicon.ico', root), Buffer.concat([header, ...images]));
const app = 'ios/Expensive/Assets.xcassets/AppIcon.appiconset/';
await png(`${app}AppIcon.png`, 1024);
await png(`${app}AppIcon-dark.png`, 1024, true);
// White foreground on black gives the system a neutral grayscale tint mask.
await sharp(Buffer.from(white), { density: 300 }).resize(1024, 1024)
  .flatten({ background: '#000000' }).removeAlpha().png()
  .toFile(new URL(`${app}AppIcon-tinted.png`, root).pathname);
console.log('Generated web and iOS icons from public/newnew.svg.');
