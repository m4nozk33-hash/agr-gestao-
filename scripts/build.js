const fs = require('node:fs');

fs.mkdirSync('public', { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');
const boletoCode = fs.existsSync('boleto.js') ? fs.readFileSync('boleto.js', 'utf8') : '';
const radarCode = fs.existsSync('radar.js') ? fs.readFileSync('radar.js', 'utf8') : '';

if (boletoCode) {
  const inlineBoleto = `<script id="agr-boletos-inline">\n${boletoCode}\n</script>`;
  html = html.replace(/<script[^>]+src=["']\/boleto\.js[^>]*><\/script>/g, '');
  if (!html.includes('id="agr-boletos-inline"')) {
    html = html.includes('</body>')
      ? html.replace('</body>', inlineBoleto + '</body>')
      : html + inlineBoleto;
  }
}

if (radarCode) {
  const inlineRadar = `<script id="agr-radar-inline">\n${radarCode}\n</script>`;
  if (!html.includes('id="agr-radar-inline"')) {
    html = html.includes('</body>')
      ? html.replace('</body>', inlineRadar + '</body>')
      : html + inlineRadar;
  }
}

fs.writeFileSync('public/index.html', html);

for (const file of ['manifest.webmanifest', 'app-icon.svg', 'sw.js']) {
  if (fs.existsSync(file)) fs.copyFileSync(file, 'public/' + file);
}
