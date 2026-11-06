(() => {
  const app = document.getElementById('app');
  const picker = document.getElementById('picker');
  const confirmBox = document.getElementById('confirm');
  const state = { king: null, queen: null, status: null, candidates: null, picking: null };
  const LABEL = { king: 'Rei', queen: 'Rainha' };

  const ERRORS = {
    already_voted: 'Este aparelho já registrou um voto.',
    ip_limit: 'Esta conexão já atingiu o limite de votos.',
    invalid_code: 'Código inválido ou já utilizado. Confira e tente novamente.',
    voting_closed: 'A votação está encerrada.',
    invalid_candidate: 'Escolha o Rei e a Rainha.',
    too_many_requests: 'Muitas tentativas seguidas. Aguarde um minuto.',
  };

  function notice(title, text) {
    const box = document.createElement('div');
    box.className = 'notice';
    box.innerHTML = `
      <div class="crowns">
        <img src="img/coroa-rei.webp" width="281" height="176" alt="">
        <img src="img/tiara.webp" width="242" height="131" alt="">
      </div>
      <h2></h2><p></p>
      <img class="wave" src="img/divisor-onda.webp" width="561" height="70" alt="">`;
    box.querySelector('h2').textContent = title;
    box.querySelector('p').textContent = text;
    app.replaceChildren(box);
  }

  // ---------- cédula ----------

  function renderVote() {
    app.replaceChildren(document.getElementById('tpl-vote').content.cloneNode(true));
    app.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => openPicker(btn.dataset.open));
    });
    const code = app.querySelector('.code');
    code.hidden = !state.status.requireCode;
    code.querySelector('input').addEventListener('input', () => setHint());
    app.querySelector('[data-action="review"]').addEventListener('click', review);
    refreshCards();
  }

  function refreshCards() {
    for (const cat of ['king', 'queen']) {
      const card = app.querySelector(`.card[data-cat="${cat}"]`);
      card.classList.toggle('done', !!state[cat]);
      card.querySelector('[data-chosen]').textContent = state[cat]?.name || '';
      const btn = card.querySelector('[data-open]');
      btn.textContent = state[cat] ? 'Trocar' : 'Selecionar';
      btn.setAttribute('aria-label', state[cat] ? `Trocar ${LABEL[cat]}` : `Selecionar ${LABEL[cat]}`);
    }
  }

  function setHint(text) {
    const hint = app.querySelector('.hint');
    if (!hint) return;
    hint.querySelector('[data-hint]').textContent = text || 'Vote apenas uma vez!';
    hint.classList.toggle('warn', !!text);
  }

  const codeValue = () => (app.querySelector('.code input')?.value || '').trim().toUpperCase();

  function review() {
    const missing = ['king', 'queen'].filter((c) => !state[c]);
    if (missing.length) {
      missing.forEach((cat) => {
        const card = app.querySelector(`.card[data-cat="${cat}"]`);
        card.classList.remove('missing');
        void card.offsetWidth; // reinicia a animação
        card.classList.add('missing');
      });
      setHint(missing.length === 2 ? 'Escolha o Rei e a Rainha.' : `Falta escolher ${missing[0] === 'king' ? 'o Rei' : 'a Rainha'}.`);
      return;
    }
    if (state.status.requireCode && codeValue().length < 4) {
      setHint('Digite seu código de votação.');
      app.querySelector('.code input').focus();
      return;
    }
    setHint();
    confirmBox.querySelector('[data-confirm="king"]').textContent = state.king.name;
    confirmBox.querySelector('[data-confirm="queen"]').textContent = state.queen.name;
    confirmBox.querySelector('.error').hidden = true;
    confirmBox.showModal();
  }

  // ---------- lista de candidatos ----------

  function openPicker(cat) {
    state.picking = cat;
    const list = cat === 'king' ? state.candidates.kings : state.candidates.queens;
    picker.querySelector('h3').textContent = `Escolha ${cat === 'king' ? 'o Rei' : 'a Rainha'}`;
    picker.querySelector('.sheet-crown').src = cat === 'king' ? 'img/coroa-rei.webp' : 'img/tiara.webp';
    const ul = picker.querySelector('.options');
    ul.replaceChildren();
    list.forEach((c, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(state[cat]?.id === c.id));
      btn.innerHTML = '<span class="num"></span><span class="name"></span><span class="ring"></span>';
      btn.querySelector('.num').textContent = String(i + 1).padStart(2, '0');
      btn.querySelector('.name').textContent = c.name;
      btn.addEventListener('click', () => choose(cat, c, btn));
      li.appendChild(btn);
      ul.appendChild(li);
    });
    picker.showModal();
    (ul.querySelector('[aria-selected="true"]') || ul.querySelector('button'))?.focus();
  }

  function choose(cat, cand, btn) {
    state[cat] = cand;
    picker.querySelectorAll('.options button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    refreshCards();
    setHint();
    setTimeout(() => picker.close(), 220);
  }

  picker.querySelector('[data-action="close"]').addEventListener('click', () => picker.close());
  for (const d of [picker, confirmBox]) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clique fora fecha
  }

  // ---------- envio ----------

  confirmBox.querySelector('[data-action="cancel"]').addEventListener('click', () => confirmBox.close());

  confirmBox.querySelector('[data-action="send"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = confirmBox.querySelector('.error');
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
        confirmBox.close();
        notice('Voto registrado', 'Obrigado por votar! O Rei e a Rainha serão anunciados durante o baile.');
        return;
      }
      if (['already_voted', 'ip_limit', 'voting_closed'].includes(data.error)) {
        confirmBox.close();
        if (data.error === 'voting_closed') notice('Votação encerrada', 'O resultado será anunciado durante o baile.');
        else notice('Você já votou', ERRORS[data.error]);
        return;
      }
      err.textContent = ERRORS[data.error] || 'Não foi possível registrar o voto. Tente novamente.';
      err.hidden = false;
    } catch {
      err.textContent = 'Sem conexão. Verifique a internet e tente novamente.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });

  async function start() {
    try {
      const [candidates, status] = await Promise.all([
        fetch('/api/candidates').then((r) => r.json()),
        fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      Object.assign(state, { candidates, status });
      if (!status.votingOpen) return notice('Votação encerrada', 'A votação não está aberta no momento. O resultado será anunciado durante o baile.');
      if (status.hasVoted) return notice('Você já votou', 'Seu voto já está computado. Obrigado por participar!');
      renderVote();
    } catch {
      notice('Algo deu errado', 'Não foi possível carregar a votação. Recarregue a página.');
    }
  }

  start();
})();
