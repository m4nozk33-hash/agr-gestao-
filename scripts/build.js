const fs = require('node:fs');

fs.mkdirSync('public', { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');

// Nunca incorporar boleto.js/radar.js diretamente dentro de <script>.
// Esses arquivos possuem templates HTML e podem conter sequências que o navegador
// interpreta como fechamento da tag <script>, fazendo o código aparecer na tela.
const scripts = [
  '<script src="/boleto.js?v=6" defer></script>',
  '<script src="/radar.js?v=1" defer></script>'
];

// Remove referências/versões antigas para evitar carregamento duplicado.
html = html
  .replace(/<script[^>]+src=["']\/boleto\.js[^>]*><\/script>/g, '')
  .replace(/<script[^>]+src=["']\/radar\.js[^>]*><\/script>/g, '')
  .replace(/<script id=["']agr-boletos-inline["'][\s\S]*?<\/script>/g, '')
  .replace(/<script id=["']agr-radar-inline["'][\s\S]*?<\/script>/g, '');

const bundleTags = scripts.join('\n');
html = html.includes('</body>')
  ? html.replace('</body>', bundleTags + '\n</body>')
  : html + '\n' + bundleTags;

fs.writeFileSync('public/index.html', html);

for (const file of ['manifest.webmanifest', 'app-icon.svg', 'sw.js', 'boleto.js', 'radar.js']) {
  if (fs.existsSync(file)) fs.copyFileSync(file, 'public/' + file);
}
