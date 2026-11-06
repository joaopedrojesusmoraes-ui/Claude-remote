(() => {
  const app = document.getElementById('app');
  const dialog = document.getElementById('confirm');
  const sprig = document.querySelector('.masthead .sprig');
  const state = { king: null, queen: null, status: null, candidates: null };

  const ERRORS = {
    already_voted: 'Este aparelho já registrou um voto.',
    ip_limit: 'Esta conexão já atingiu o limite de votos.',
    invalid_code: 'Código inválido ou já utilizado. Confira e tente novamente.',
    voting_closed: 'A votação está encerrada.',
    invalid_candidate: 'Escolha um nome em cada lista.',
    too_many_requests: 'Muitas tentativas seguidas. Aguarde um minuto.',
  };

  const pad = (n) => String(n).padStart(2, '0');

  // Mensagem de página inteira. `title` aceita um trecho em itálico entre *asteriscos*.
  function notice(title, text) {
    const box = document.createElement('div');
    box.className = 'notice';
    box.appendChild(sprig.cloneNode(true));
    const h = document.createElement('h2');
    title.split(/\*(.+?)\*/).forEach((part, i) => {
      h.append(i % 2 ? Object.assign(document.createElement('em'), { textContent: part }) : part);
    });
    const p = document.createElement('p');
    p.textContent = text;
    box.append(h, p);
    app.replaceChildren(box);
  }

  function renderVote() {
    app.replaceChildren(document.getElementById('tpl-vote').content.cloneNode(true));
    const lists = { king: state.candidates.kings, queen: state.candidates.queens };

    for (const cat of ['king', 'queen']) {
      const section = app.querySelector(`[data-cat="${cat}"]`);
      section.querySelector('.count').textContent = `${lists[cat].length} candidatos`;
      const ol = section.querySelector('ol');
      lists[cat].forEach((c, i) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'row';
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: cat, value: c.id });
        const no = Object.assign(document.createElement('span'), { className: 'no', textContent: pad(i + 1) });
        const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: c.name });
        const mark = Object.assign(document.createElement('span'), { className: 'mark' });
        input.addEventListener('change', () => { state[cat] = c; update(); });
        label.append(input, no, nm, mark);
        li.appendChild(label);
        ol.appendChild(li);
      });
    }

    const field = app.querySelector('.code-field');
    field.hidden = !state.status.requireCode;
    field.querySelector('input').addEventListener('input', update);
    app.querySelector('[data-action="review"]').addEventListener('click', openConfirm);
    update();
  }

  const codeValue = () => (app.querySelector('.code-field input')?.value || '').trim().toUpperCase();

  function update() {
    for (const cat of ['king', 'queen']) {
      const dd = app.querySelector(`[data-pick="${cat}"]`);
      dd.textContent = state[cat]?.name || 'a escolher';
      dd.classList.toggle('empty', !state[cat]);
    }
    const ready = state.king && state.queen && (!state.status.requireCode || codeValue().length >= 4);
    app.querySelector('[data-action="review"]').disabled = !ready;
  }

  function openConfirm() {
    dialog.querySelector('[data-confirm="king"]').textContent = state.king.name;
    dialog.querySelector('[data-confirm="queen"]').textContent = state.queen.name;
    dialog.querySelector('.error').hidden = true;
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
        dialog.close();
        notice('*Obrigado.*', 'Seu voto foi registrado. O Rei e a Rainha serão anunciados durante o baile.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (['already_voted', 'ip_limit', 'voting_closed'].includes(data.error)) {
        dialog.close();
        if (data.error === 'voting_closed') notice('Votação *encerrada*', 'O resultado será anunciado durante o baile.');
        else notice('Voto já *registrado*', ERRORS[data.error]);
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
      if (!status.votingOpen) return notice('Votação *encerrada*', 'A votação não está aberta no momento. O resultado será anunciado durante o baile.');
      if (status.hasVoted) return notice('Voto já *registrado*', 'Seu voto já está computado. Obrigado por participar.');
      renderVote();
    } catch {
      notice('Algo deu *errado*', 'Não foi possível carregar a votação. Recarregue a página.');
    }
  }

  start();
})();
