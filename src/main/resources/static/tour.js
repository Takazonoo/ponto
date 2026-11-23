(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const purchase = {
    type: 'Despesa', description: 'Almoço', category: 'Alimentação', method: 'Crédito',
    amount: '28,00', result: 'Despesa registrada', label: 'Fatura do mês', total: 'R$ 354,40',
  };
  function prepareEntry(content, entry) {
    content.innerHTML = `
      <div class="tour-toolbar"><b>Lançamentos</b><span class="tour-action is-active">+ Novo lançamento</span></div>
      <div class="tour-sheet tour-form" data-stage="closed">
        <h4>Novo lançamento</h4>
        <div class="tour-fields">
          <div data-field="type"><span>Tipo</span><b class="tour-choice">Despesa</b><b class="tour-choice">Receita</b></div>
          <div data-field="description"><span>Descrição</span><b></b></div>
          <div data-field="category"><span>Categoria</span><b></b></div>
          <div data-field="method"><span>Meio de pagamento</span><b></b></div>
          <div data-field="amount"><span>Valor em reais</span><b></b></div>
        </div>
        <div class="tour-outcome">
          <span class="tour-action tour-save">Salvar lançamento</span>
          <div class="tour-total tour-result" hidden><span>${entry.result} · ${entry.label}</span><strong>${entry.total}</strong></div>
        </div>
      </div>`;

    const sheet = content.querySelector('.tour-sheet');
    const action = content.querySelector('.tour-toolbar .tour-action');
    const save = content.querySelector('.tour-save');
    const fields = new Map([...content.querySelectorAll('[data-field]')].map(field => [field.dataset.field, field]));
    function focus(element) {
      content.querySelector('.is-active')?.classList.remove('is-active');
      element?.classList.add('is-active');
    }
    function fill(name, value) {
      const field = fields.get(name);
      focus(field);
      field.querySelector('b').textContent = value;
    }
    const moments = [
      [250, () => { sheet.dataset.stage = 'open'; action.classList.remove('is-active'); }],
      [380, () => {
        const type = fields.get('type');
        focus(type);
        [...type.querySelectorAll('b')].find(option => option.textContent === entry.type).classList.add('selected');
      }],
      [450, () => fill('description', entry.description)],
      [380, () => fill('category', entry.category)],
      [450, () => fill('method', entry.method)],
      ...[...entry.amount].map((_, index) => [140, () => fill('amount', 'R$ ' + entry.amount.slice(0, index + 1))]),
      [510, () => focus(save)],
      [380, () => {
        focus(null);
        save.hidden = true;
        content.querySelector('.tour-result').hidden = false;
      }],
    ];

    return function play(instant) {
      if (instant) {
        moments.forEach(([, change]) => change());
        return;
      }
      let elapsed = 0;
      return moments.map(([delay, change]) => {
        elapsed += delay;
        return setTimeout(change, elapsed);
      });
    };
  }

  document.querySelectorAll('[data-tour-scene="expense"]').forEach(chapter => {
    const screen = chapter.querySelector('.tour-screen');
    const content = chapter.querySelector('.tour-content');
    const replay = chapter.querySelector('.tour-replay');
    let play = prepareEntry(content, purchase);
    let timers = [];
    function start() {
      timers.forEach(clearTimeout);
      timers = play(reducedMotion.matches) ?? [];
    }
    if (!reducedMotion.matches && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([item]) => {
        if (!item.isIntersecting) return;
        observer.disconnect();
        start();
      }, {threshold: 0.55});
      observer.observe(screen);
      replay.hidden = false;
      replay.addEventListener('click', () => {
        observer.disconnect();
        play = prepareEntry(content, purchase);
        start();
      });
      reducedMotion.addEventListener('change', () => {
        if (!reducedMotion.matches) return;
        observer.disconnect();
        play = prepareEntry(content, purchase);
        start();
        replay.hidden = true;
      });
    } else {
      play(true);
    }
  });
})();
