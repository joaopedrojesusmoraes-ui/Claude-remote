(() => {
  const KEY = 'baile_admin_pw';
  const $ = (s) => document.querySelector(s);
  const login = $('#login');
  const dash = $('#dash');
  let password = '';
  let timer = null;
  let codes = [];

  try { password = sessionStorage.getItem(KEY) || ''; } catch {}

  async function api(path, opts = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'error');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function showLogin(msg) {
    clearInterval(timer);
    dash.hidden = true;
    login.hidden = false;
    const e = login.querySelector('.error');
    e.hidden = !msg;
    e.textContent = msg || '';
  }

  function renderRank(el, list) {
    const max = Math.max(1, ...list.map((c) => c.votes));
    el.innerHTML = '';
    for (const c of list) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="nm"></span><span class="ct"></span><span class="bar-track"><span class="bar-fill"></span></span>';
      li.querySelector('.nm').textContent = c.name;
      li.querySelector('.ct').textContent = c.votes;
      li.querySelector('.bar-fill').style.width = `${(c.votes / max) * 100}%`;
      if (c.votes > 0 && c.votes === max) li.classList.add('top');
      el.appendChild(li);
    }
  }

  let settingsDirty = false;

  async function refresh() {
    try {
      const d = await api('/overview');
      $('[data-open]').textContent = d.settings.votingOpen ? 'Aberta' : 'Encerrada';
      $('[data-total]').textContent = d.total;
      $('[data-updated]').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('[data-ip]').textContent = d.yourIp;
      renderRank($('[data-rank="kings"]'), d.kings);
      renderRank($('[data-rank="queens"]'), d.queens);
      if (!settingsDirty) {
        const f = $('#settings');
        f.votingOpen.checked = d.settings.votingOpen;
        f.requireCode.checked = d.settings.requireCode;
        f.maxPerIp.value = d.settings.maxPerIp;
      }
      return true;
    } catch (err) {
      if (err.status === 401) showLogin('Senha incorreta.');
      else if (err.status === 503) showLogin('Painel desativado: defina ADMIN_PASSWORD no servidor.');
      return false;
    }
  }

  async function loadCodes() {
    codes = await api('/codes');
    const used = codes.filter((c) => c.used_at).length;
    $('[data-code-count]').textContent = codes.length
      ? `${codes.length} códigos — ${used} usados, ${codes.length - used} disponíveis`
      : 'Nenhum código gerado ainda.';
    const box = $('[data-codes]');
    box.innerHTML = '';
    for (const c of codes) {
      const s = document.createElement('span');
      s.textContent = c.code;
      if (c.used_at) { s.className = 'used'; s.title = `Usado em ${new Date(c.used_at).toLocaleString('pt-BR')}`; }
      box.appendChild(s);
    }
  }

  async function enter() {
    login.hidden = true;
    dash.hidden = false;
    if (await refresh()) {
      try { sessionStorage.setItem(KEY, password); } catch {}
      loadCodes();
      clearInterval(timer);
      timer = setInterval(refresh, 5000);
    }
  }

  login.addEventListener('submit', (e) => {
    e.preventDefault();
    password = login.password.value;
    enter();
  });

  const settingsForm = $('#settings');
  settingsForm.addEventListener('input', () => { settingsDirty = true; });
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/settings', {
      method: 'POST',
      body: {
        votingOpen: settingsForm.votingOpen.checked,
        requireCode: settingsForm.requireCode.checked,
        maxPerIp: Math.max(0, parseInt(settingsForm.maxPerIp.value, 10) || 0),
      },
    });
    settingsDirty = false;
    const ok = settingsForm.querySelector('.saved');
    ok.hidden = false;
    setTimeout(() => { ok.hidden = true; }, 2000);
    refresh();
  });

  $('#gen').addEventListener('submit', async (e) => {
    e.preventDefault();
    const count = parseInt(e.target.count.value, 10) || 0;
    if (count < 1) return;
    await api('/codes', { method: 'POST', body: { count } });
    loadCodes();
  });

  document.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'print') {
      const sheet = $('.print-sheet');
      sheet.innerHTML = '';
      for (const c of codes.filter((x) => !x.used_at)) {
        const d = document.createElement('div');
        d.innerHTML = '<small>Baile de Primavera · Código de voto</small><b></b><small>Rei &amp; Rainha · uso único</small>';
        d.querySelector('b').textContent = c.code;
        sheet.appendChild(d);
      }
      if (!sheet.children.length) return alert('Não há códigos disponíveis para imprimir.');
      document.body.classList.add('printing');
      window.print();
      document.body.classList.remove('printing');
    }

    if (action === 'csv') {
      const rows = [['codigo', 'criado_em', 'usado_em'], ...codes.map((c) => [c.code, c.created_at, c.used_at || ''])];
      const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'codigos-baile.csv' });
      a.click();
      URL.revokeObjectURL(a.href);
    }

    if (action === 'del-unused') {
      if (!confirm('Apagar todos os códigos que ainda não foram usados?')) return;
      await api('/codes/unused', { method: 'DELETE' });
      loadCodes();
    }

    if (action === 'reset') {
      const typed = prompt('Isso apaga TODOS os votos. Digite ZERAR para confirmar:');
      if (typed !== 'ZERAR') return;
      await api('/reset', { method: 'POST', body: { confirm: 'ZERAR' } });
      refresh();
      loadCodes();
    }

    if (action === 'logout') {
      try { sessionStorage.removeItem(KEY); } catch {}
      password = '';
      login.password.value = '';
      showLogin();
    }
  });

  if (password) enter(); else showLogin();
})();
