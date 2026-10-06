const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const frontend = process.env.COWBOY_FRONTEND || path.join(root, 'frontend');
const esbuild = require(path.join(frontend, 'node_modules/esbuild'));
const publicDir = path.join(root, 'frontend/public');
const embed = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(publicDir, file)).toString('base64')}`;
const assets = Object.fromEntries(['BTC', 'ETH', 'HYPE', 'ZEC'].map(coin => [coin, embed(`coins/${coin}.${coin === 'HYPE' ? 'jpg' : 'svg'}`, coin === 'HYPE' ? 'image/jpeg' : 'image/svg+xml')]));
const { outputFiles } = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'app.js')], bundle: true, write: false, format: 'iife', target: ['chrome110', 'safari16.4', 'firefox113'], minify: true, define: {
  'import.meta.env': '{}',
  'import.meta.env.VITE_DERIVE_OPTIONS_URL': '""',
  'import.meta.env.VITE_DERIVE_REFERRAL': '""',
  'import.meta.env.VITE_DERIVE_REFERRAL_PARAM': '""',
  'import.meta.env.VITE_QUESTIONS': '"0"',
  'import.meta.env.VITE_SALOON_TRADE': '""',
  '__PROTOTYPE_ASSETS__': JSON.stringify(assets),
} });
const replacements = {
  '{{LOGO_LIGHT}}': embed('brand/cowboy-wordmark-on-light.svg', 'image/svg+xml'),
  '{{LOGO_DARK}}': embed('brand/cowboy-wordmark-on-dark.svg', 'image/svg+xml'),
  '{{MANROPE}}': embed('fonts/manrope-latin-variable.woff2', 'font/woff2'),
  '{{CHIVO}}': embed('fonts/chivo-mono-latin-variable.woff2', 'font/woff2'),
};
let css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) css = css.replaceAll(placeholder, value);
let html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8').replace('/* PROTOTYPE_CSS */', () => css).replace('/* PROTOTYPE_JS */', () => outputFiles[0].text.replaceAll('</script', '<\\/script'));
for (const [placeholder, value] of Object.entries(replacements)) html = html.replaceAll(placeholder, value);
const notices = ['fonts/OFL-manrope.txt', 'fonts/OFL-chivo-mono.txt', 'coins/WEB3ICONS-LICENSE', 'coins/sources.json'].map(file => `${file}\n\n${fs.readFileSync(path.join(publicDir, file), 'utf8')}`).join('\n\n').replace(/[ \t]+$/gm, '');
html = html.replace('</head>', () => `<!-- Bundled asset notices\n${notices.replaceAll('-->', '-- >')}\n-->\n</head>`);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built offline Saloon preview (${Math.round(Buffer.byteLength(html) / 1024)} KiB).`);
