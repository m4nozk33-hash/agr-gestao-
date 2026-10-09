(() => {
  const hasRadarAccess = () => ['admin', 'user', 'colaborador'].includes(String(ME?.role || '').toLowerCase());

  const previousNav = nav;
  nav = function navWithCollaboratorRadar() {
    previousNav();
    if (!hasRadarAccess()) return;
    const nv = $('#nv');
    if (!nv || nv.querySelector('[data-radar-link]')) return;
    const link = document.createElement('a');
    link.dataset.radarLink = '1';
    link.textContent = '🔎 Radar de Empresas';
    link.className = V.v === 'radar' ? 'on' : '';
    link.onclick = () => go('radar', 0);
    const sections = [...nv.querySelectorAll('.s')];
    const appSection = sections.find(x => x.textContent.trim() === 'Aplicativo');
    nv.insertBefore(link, appSection || null);
  };

  const previousRender = render;
  render = function renderWithCollaboratorRadar() {
    if (hasRadarAccess() && V.v === 'radar') {
      $('#nv').style.display = '';
      $('#mn').style.padding = '';
      $('#mn').style.maxWidth = '';
      document.body.classList.add('signed-in');
      renderAppbar();
      nav();
      $('#mn').innerHTML = radarView();
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('agr_radar_filters') || 'null'); } catch {}
      if (saved?.municipio || saved?.cnae) setTimeout(() => radarRun(), 0);
      return;
    }
    previousRender();
  };
})();
