const fs = require('node:fs');

fs.mkdirSync('public', { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');
const boletoTag = '<script src="/boleto.js?v=1"></script>';
if (!html.includes('/boleto.js')) {
  html = html.includes('</body>')
    ? html.replace('</body>', boletoTag + '</body>')
    : html + boletoTag;
}

fs.writeFileSync('public/index.html', html);

for (const file of ['boleto.js', 'manifest.webmanifest', 'app-icon.svg', 'sw.js']) {
  if (fs.existsSync(file)) fs.copyFileSync(file, 'public/' + file);
}
