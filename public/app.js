(() => {
  const app = document.getElementById('app');
  const dialog = document.getElementById('confirm');
  const state = { king: null, queen: null, candidates: null, status: null };
  const COLORS = ['#e85d8f', '#4c9a6a', '#d9a520', '#8f6ad8', '#e07a5f', '#3d9bc1', '#c45ab3', '#5fae9b'];

  const ERRORS = {
    already_voted: 'Este aparelho já votou. Obrigado! 💐',
    ip_limit: 'Já foi registrado o número máximo de votos nesta rede/conexão.',
    invalid_code: 'Código inválido ou já usado. Confira e tente de novo.',
    voting_closed: 'A votação está encerrada.',
    invalid_candidate: 'Escolha um Rei e uma Rainha.',
    too_many_requests: 'Muitas tentativas. Espere um minutinho e tente de novo.',
  };

  // pétalas
  const petals = document.querySelector('.petals');
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDuration = `${9 + Math.random() * 10}s`;
    s.style.animationDelay = `${-Math.random() * 18}s`;
    s.style.setProperty('--drift', `${(Math.random() - .5) * 240}px`);
    s.style.transform = `scale(${.6 + Math.random() * .8})`;
    petals.appendChild(s);
  }

  const initials = (name) => {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };

  function notice(icon, title, text) {
    app.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'notice';
    box.innerHTML = `<div class="big"></div><h2></h2><p></p>`;
    box.querySelector('.big').textContent = icon;
    box.querySelector('h2').textContent = title;
    box.querySelector('p').textContent = text;
    app.appendChild(box);
  }

  function renderVote() {
    app.innerHTML = '';
    app.appendChild(document.getElementById('tpl-vote').content.cloneNode(true));
    const lists = { king: state.candidates.kings, queen: state.candidates.queens };

    for (const cat of ['king', 'queen']) {
      const grid = app.querySelector(`[data-cat="${cat}"] .grid`);
      lists[cat].forEach((c, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cand';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', 'false');
        btn.dataset.id = c.id;
        btn.innerHTML = `<span class="avatar"></span><span class="name"></span><span class="num"></span>`;
        btn.querySelector('.avatar').textContent = initials(c.name);
        btn.querySelector('.avatar').style.setProperty('--av', COLORS[(c.id - 1) % COLORS.length]);
        btn.querySelector('.name').textContent = c.name;
        btn.querySelector('.num').textContent = `nº ${c.id}`;
        btn.addEventListener('click', () => select(cat, c));
        grid.appendChild(btn);
        if (i === 0) btn.tabIndex = 0;
      });
    }

    const codeField = app.querySelector('.code-field');
    codeField.hidden = !state.status.requireCode;
    codeField.querySelector('input').addEventListener('input', updateBar);
    app.querySelector('[data-action="review"]').addEventListener('click', openConfirm);
    updateBar();
  }

  function select(cat, cand) {
    state[cat] = cand;
    app.querySelectorAll(`[data-cat="${cat}"] .cand`).forEach((b) => {
      b.setAttribute('aria-checked', String(Number(b.dataset.id) === cand.id));
    });
    updateBar();
  }

  const codeValue = () => (app.querySelector('.code-field input')?.value || '').trim().toUpperCase();

  function updateBar() {
    app.querySelector('[data-pick="king"]').textContent = state.king?.name || '—';
    app.querySelector('[data-pick="queen"]').textContent = state.queen?.name || '—';
    const ready = state.king && state.queen && (!state.status.requireCode || codeValue().length >= 4);
    app.querySelector('[data-action="review"]').disabled = !ready;
  }

  function openConfirm() {
    dialog.querySelector('[data-confirm="king"]').textContent = state.king.name;
    dialog.querySelector('[data-confirm="queen"]').textContent = state.queen.name;
    dialog.querySelector('.error').hidden = true;
    dialog.querySelector('[data-action="send"]').disabled = false;
    dialog.showModal();
  }

  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());

  dialog.querySelector('[data-action="send"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = dialog.querySelector('.error');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kingId: state.king.id, queenId: state.queen.id, code: codeValue() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        try { localStorage.setItem('baile_votou', '1'); } catch {}
        dialog.close();
        notice('🌸', 'Voto registrado!', `Obrigado por votar. O Rei e a Rainha serão anunciados no baile — fique ligado! 👑`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (data.error === 'already_voted' || data.error === 'ip_limit' || data.error === 'voting_closed') {
        dialog.close();
        const title = data.error === 'voting_closed' ? 'Votação encerrada' : 'Você já votou';
        notice(data.error === 'voting_closed' ? '🌙' : '💐', title, ERRORS[data.error]);
        return;
      }
      err.textContent = ERRORS[data.error] || 'Não foi possível registrar o voto. Tente novamente.';
      err.hidden = false;
      btn.disabled = false;
    } catch {
      err.textContent = 'Sem conexão. Verifique a internet e tente novamente.';
      err.hidden = false;
      btn.disabled = false;
    } finally {
      btn.textContent = 'Confirmar voto';
    }
  });

  async function start() {
    try {
      const [cands, status] = await Promise.all([
        fetch('/api/candidates').then((r) => r.json()),
        fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      state.candidates = cands;
      state.status = status;
      if (!status.votingOpen) return notice('🌙', 'Votação encerrada', 'A votação não está aberta no momento. O resultado será anunciado no baile!');
      if (status.hasVoted) return notice('💐', 'Você já votou', 'Seu voto já foi registrado. Obrigado por participar! 👑');
      renderVote();
    } catch {
      notice('🥀', 'Ops!', 'Não foi possível carregar a votação. Recarregue a página.');
    }
  }

  start();
})();
