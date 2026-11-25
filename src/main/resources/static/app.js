(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const icons = {
  wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V6l13-3m5 8h-5a2 2 0 0 0 0 4h5"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  repeat:'<path d="M3 7h17m-4-4 4 4-4 4m5 6H4m4-4-4 4 4 4"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/>',
  chart:'<path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  plus:'<path d="M12 5v14m-7-7h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  down:'<path d="M6 7l11 11m0-8v8H9"/>',
  up:'<path d="M6 17 17 6M9 6h8v8"/>',
  edit:'<path d="m4 20 4-1 12-12-4-4L4 15zm10-15 4 4"/>',
  trash:'<path d="M4 6h16M9 6V3h6v3m3 0-1 15H7L6 6m4 4v7m4-7v7"/>'
};
const icon = (name) => `<i data-icon="${name}"></i>`;
function loadIcons() {
  document.querySelectorAll('i[data-icon]:empty').forEach((item) => {
    item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[item.dataset.icon]}</svg>`;
  });
}

const categories = ['Alimentação','Moradia','Transporte','Jogos','Entretenimento','Vestuário','Saúde','Trabalho','Outros'];
const methods = {PIX:'Pix', CREDIT:'Crédito', DEBIT:'Débito', CASH:'Dinheiro', BOLETO:'Boleto'};
const palette = ['#416449','#9aaa65','#af7739','#668d85','#977859','#78964b','#777e60','#898368','#a05747'];
const pages = {
  visao: ['Visão geral','Acompanhe seu dinheiro em um só lugar.'],
  lancamentos: ['Lançamentos','Consulte e organize suas receitas e despesas.'],
  conta: ['Minha conta','Veja o saldo calculado e as movimentações da conta.'],
  fatura: ['Fatura do cartão','Acompanhe as compras no crédito e a situação da fatura.'],
  relatorios: ['Relatórios','Veja como seus gastos se distribuem por dia e categoria.']
};
const brl = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const monthFormat = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
const dateFormat = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'UTC'});
const date = (day) => new Date(`${day}T00:00:00Z`);
const iso=(value)=>value.toISOString().slice(0,10);
function shiftMonth(month, count) {
  const value = date(`${month}-01`);
  value.setUTCMonth(value.getUTCMonth()+count);
  return value.toISOString().slice(0,7);
}
const fmt = (day) => dateFormat.format(date(day));
const money = (amount) => brl.format(amount);
const sum = (entries) => entries.reduce((total, entry) => total + Math.round(Number(entry.amount)*100),0)/100;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let today = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
let month = today.slice(0,7);
let signedIn = false;
let inviteOnly = false;
let csrf = '';
let dashboard;
let demoEntries;
let demoNextId = 1;
let requestId = 0;
let activePage = 'visao';
let weekOffset = 0;
let action;
let dialogBusy = false;
let filters = {search:'',category:'',method:''};

function seedDemo() {
  const demoMonth=today.slice(0,7);
  const dayLimit=Number(today.slice(8));
  const rows = [
    ['INCOME','Pagamento mensal',3500,'Trabalho','PIX',1],
    ['EXPENSE','Aluguel',790,'Moradia','PIX',2],
    ['EXPENSE','Café e almoço',74.50,'Alimentação','DEBIT',4],
    ['EXPENSE','Aplicativo de transporte',68,'Transporte','PIX',6],
    ['EXPENSE','Assinatura de streaming',39.90,'Entretenimento','CREDIT',8],
    ['EXPENSE','Mercado',256.80,'Alimentação','CREDIT',10],
    ['EXPENSE','Jogo digital',129.90,'Jogos','CREDIT',13],
    ['EXPENSE','Cinema',78,'Entretenimento','CREDIT',16],
    ['EXPENSE','Restaurante',86.50,'Alimentação','PIX',18],
    ['EXPENSE','Tênis',249.90,'Vestuário','CREDIT',22],
    ['EXPENSE','Metrô',52,'Transporte','DEBIT',25],
    ['EXPENSE','Pedido de jantar',59.90,'Alimentação','CREDIT',27]
  ];
  return rows.map(([kind,description,amount,category,method,day]) =>
    ({id:demoNextId++,kind,description,amount,category,method,
      day:`${demoMonth}-${String(Math.min(day,dayLimit)).padStart(2,'0')}`}));
}

function localDemo() {
  demoEntries ??= seedDemo();
  const entries=demoEntries.filter(entry=>(entry.reportDay ?? entry.day).startsWith(month))
    .sort((a,b)=>(b.reportDay ?? b.day).localeCompare(a.reportDay ?? a.day) || b.id-a.id);
  const cash=demoEntries.filter(entry=>entry.method!=='CREDIT');
  const initialBalance=789.20;
  const balance=initialBalance+sum(cash.filter(e=>e.kind==='INCOME'))-sum(cash.filter(e=>e.kind==='EXPENSE'));
  const next = date(`${month}-01`);
  next.setUTCMonth(next.getUTCMonth()+1,10);
  return {name:'',today,month,balance,initialBalance,
    invoice:sum(entries.filter(e=>e.method==='CREDIT')),dueDate:next.toISOString().slice(0,10),payment:null,entries};
}

async function api(path, method='GET', body) {
  const headers = method==='GET' ? {} : {'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const response = await fetch(`/api${path}`,{method,headers,body:body===undefined ? undefined : JSON.stringify(body),cache:'no-store'});
  if (!response.ok) {
    const error = await response.json().catch(()=>null);
    const failure = new Error(error?.detail || (response.status===401 ? 'Entre novamente para acessar sua conta.' : 'Não foi possível concluir a operação.'));
    failure.status = response.status;
    throw failure;
  }
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

function notice(message='') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function discardPrivateView() {
  requestId++;
  dashboard=null;
  $('view').replaceChildren();
  $('profile-name').textContent='Conta';
  $('avatar').textContent='P';
  $('page-title').textContent=pages[activePage][0];
  if ($('modal').open) $('modal').close();
  $('fields').replaceChildren();
  $('form-error').textContent='';
  action=null;
  notice();
}

async function refresh() {
  const id = ++requestId;
  if (!signedIn) {
    dashboard = localDemo();
    render();
    return;
  }
  try {
    const data = await api(`/dashboard?month=${encodeURIComponent(month)}`);
    if (id !== requestId) return;
    dashboard = data;
    today = data.today;
    render();
  } catch (error) {
    if (id !== requestId) return;
    if (error.status === 401) {
      discardPrivateView();
      signedIn = false;
      csrf = '';
      dashboard = localDemo();
      render();
    }
    notice(error.message);
  }
}

function metric(label, value, detail, glyph) {
  return `<article class="metric"><div class="metric-label">${icon(glyph)}${label}</div><div class="number">${money(value)}</div><small>${detail}</small></article>`;
}
function dailyChart(expenses, cumulative=false) {
  const start = date(`${month}-01`);
  start.setUTCMonth(start.getUTCMonth()+1,0);
  const days = start.getUTCDate();
  const daily = Array.from({length:days},(_,i)=>sum(expenses.filter(entry=>{
    const day=Number((entry.reportDay ?? entry.day).slice(8));
    return cumulative ? day<=i+1 : day===i+1;
  })));
  const max = Math.max(100,Math.ceil(Math.max(...daily)/100)*100);
  const points = daily.map((value,i)=>[55 + i*473/(days-1),172 - value*149/max]);
  const coordinates = points.map(([x,y])=>`${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const grid = [0,1,2,3,4].map(i=>{
    const y=23+i*37.25;
    return `<path d="M55 ${y}H528" stroke="#cbd6c5" stroke-dasharray="4 4"/><text x="0" y="${y+4}">${money(max*(4-i)/4).replace(/,00$/,'')}</text>`;
  }).join('');
  const ticks = [1,5,10,15,20,25,days].map(d=>`<text x="${points[d-1][0]}" y="195" text-anchor="middle">${String(d).padStart(2,'0')}</text>`).join('');
  return `<svg class="chart-svg" viewBox="0 0 540 200" role="img" aria-label="${cumulative?'Gastos acumulados':'Gastos diários'}. Maior valor ${money(Math.max(...daily))}.">
    <defs><linearGradient id="area" x2="0" y2="1"><stop stop-color="#729661" stop-opacity=".30"/><stop offset="1" stop-color="#729661" stop-opacity=".04"/></linearGradient></defs>
    ${grid}<polygon points="55,172 ${coordinates} 528,172" fill="url(#area)"/>
    <polyline points="${coordinates}" fill="none" stroke="#476849" stroke-width="2.6" stroke-linejoin="round"/>
    ${points.map(([x,y],i)=>daily[i]>0&&(!cumulative||daily[i]!==daily[i-1])?`<circle cx="${x}" cy="${y}" r="3.3" stroke="#476849" stroke-width="2" fill="white"><title>Dia ${i+1} · ${money(daily[i])}</title></circle>`:'').join('')}${ticks}</svg>`;
}

function moveDay(value, count) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate()+count);
  return result;
}

function weekPanel(entries) {
  const anchor=date(month===today.slice(0,7)?today:`${month}-01`);
  const start=moveDay(anchor,weekOffset*7-(anchor.getUTCDay()+6)%7);
  const end=moveDay(start,6);
  const shortDate=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
  const names=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const week=names.map((name,index)=>{
    const day=moveDay(start,index);
    const key=iso(day);
    const matching=entries.filter((entry)=>(entry.reportDay ?? entry.day)===key);
    const total=sum(matching);
    return `<li class="week-day${key===today?' current':''}${key.slice(0,7)!==month?' outside':''}"${key===today?' aria-current="date"':''}>
      <span class="weekday">${name}</span><time datetime="${key}">${day.getUTCDate()}</time>
      <div class="day-entries">${matching.slice(0,2).map(entry=>`<span class="day-entry" title="${escape(entry.description)} · ${money(entry.amount)}"><strong>${money(entry.amount)}</strong><span>${escape(entry.description)}</span></span>`).join('')}${matching.length>2?`<small>+${matching.length-2} gastos</small>`:''}</div>
      <strong class="day-total">${total?money(total):'—'}</strong></li>`;
  }).join('');
  return `<section class="card panel week-panel"><header class="panel-head"><div><h2>Semana em foco</h2><p class="subtitle">${shortDate.format(start)} a ${shortDate.format(end)}</p></div>
    <div class="week-controls"><button class="icon-button" type="button" data-command="previous-week" aria-label="Semana anterior" ${iso(moveDay(start,-1)).slice(0,7)<month?'disabled':''}><span aria-hidden="true">‹</span></button>
    <button class="icon-button" type="button" data-command="next-week" aria-label="Próxima semana" ${iso(moveDay(end,1)).slice(0,7)>month?'disabled':''}><span aria-hidden="true">›</span></button></div></header>
    <ol class="week-grid">${week}</ol></section>`;
}
function breakdown(expenses) {
  const total = sum(expenses);
  const groups = categories.map(name=>[name,sum(expenses.filter(e=>e.category===name))])
    .filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]);
  let start=0;
  const segments=groups.map(([,amount],index)=>{
    const share=index===groups.length-1 ? Math.max(0,100-start) : amount/total*100;
    const offset=start;
    start+=share;
    return `<circle cx="50" cy="50" r="43.75" pathLength="100" stroke="${palette[index]}" stroke-dasharray="${share} 100" stroke-dashoffset="${-offset}"/>`;
  });
  return `<div class="categories"><div class="donut"><svg class="donut-ring" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke-width="12.5" transform="rotate(-90 50 50)"><circle cx="50" cy="50" r="43.75" stroke="#edf1f9"/>${segments.join('')}</g></svg><div class="donut-inner"><span>Total</span><strong>${money(total)}</strong></div></div>
    <ul class="legend">${groups.length ? groups.map(([name,amount],i)=>`<li title="${money(amount)}"><svg viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="${palette[i]}"/></svg><span>${name}</span><strong>${Math.round(amount/total*100)}%</strong></li>`).join('') : '<li class="empty">Sem despesas no mês.</li>'}</ul></div>`;
}
function charts(expenses) {
  return `<div class="charts"><section class="card panel"><header class="panel-head"><div><h2>Gastos ao longo do mês</h2><p class="subtitle">Total de despesas por dia</p></div></header>${dailyChart(expenses)}</section>
    <section class="card panel"><header class="panel-head"><div><h2>Gastos por categoria</h2><p class="subtitle">Participação no total do mês</p></div></header>${breakdown(expenses)}</section></div>`;
}
function table(entries, editable=false) {
  if (!entries.length) return '<p class="empty">Nenhum lançamento encontrado.</p>';
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col">Data</th><th scope="col">Pagamento</th><th scope="col">Valor</th>${editable?'<th scope="col">Ações</th>':''}</tr></thead>
    <tbody>${entries.map(entry=>{
      const income=entry.kind==='INCOME';
      const locked=entry.locked ?? (dashboard.payment && entry.method==='CREDIT');
      const actions=locked?`<span class="tag">${entry.installmentCount?'Compra com fatura paga':'Fatura paga'}</span>`:`<div class="row-actions">
        <button class="icon-button" type="button" data-command="edit" data-id="${entry.id}">${icon('edit')} Editar</button>
        <button class="icon-button" type="button" data-command="delete" data-id="${entry.id}">${icon('trash')} Excluir</button>
      </div>`;
      const installment=entry.installmentCount ? ` · ${entry.installmentNumber}/${entry.installmentCount}` : '';
      return `<tr><td><span class="row-label"><span class="tile ${income?'green':'purple'}">${icon(income?'down':'up')}</span>${escape(entry.description)}</span></td><td><span class="tag">${escape(entry.category)}</span></td><td>${fmt(entry.day)}</td><td>${methods[entry.method]}${installment}</td><td class="${income?'income':''}"><strong>${income?'+':'−'} ${money(entry.amount)}</strong></td>${editable?`<td>${actions}</td>`:''}</tr>`;
    }).join('')}</tbody></table></div>`;
}
const panel = (title,subtitle,content,button='') => `<section class="card panel"><header class="panel-head"><div><h2>${title}</h2><p class="subtitle">${subtitle}</p></div>${button}</header>${content}</section>`;
const details = (pairs) => `<dl>${pairs.map(([key,value])=>`<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
function optionList(options, selected='') {
  return options.map(([key,label])=>`<option value="${escape(key)}"${selected===key?' selected':''}>${escape(label)}</option>`).join('');
}
function filterRows() {
  const input = filters.search.trim().toLocaleLowerCase('pt-BR');
  $('entry-list').innerHTML = table(dashboard.entries.filter(entry=>
    (!input || entry.description.toLocaleLowerCase('pt-BR').includes(input)) &&
    (!filters.category || entry.category===filters.category) &&
    (!filters.method || entry.method===filters.method)),true);
  loadIcons();
}
function render() {
  if (!dashboard) return;
  const {entries,balance,invoice,initialBalance,payment,dueDate,closesOn,name}=dashboard;
  const expenses=entries.filter(e=>e.kind==='EXPENSE');
  const income=entries.filter(e=>e.kind==='INCOME');
  const credit=expenses.filter(e=>e.method==='CREDIT');
  const cycleClose=closesOn ?? iso(moveDay(`${shiftMonth(month,1)}-01`,-1));
  const isClosed=cycleClose<today;
  const invoiceStatus=payment?'Paga':invoice===0?'Sem compras':!isClosed?'Aberta':dueDate<today?'Vencida':'Fechada';
  activePage=Object.hasOwn(pages,location.hash.slice(1))?location.hash.slice(1):'visao';
  const [title,description]=pages[activePage];
  $('page-title').textContent=activePage==='visao'&&signedIn ? `Olá, ${name.split(/\s+/)[0]}` : title;
  $('page-description').textContent=description;
  $('month').value=month;
  $('month-label').textContent=monthFormat.format(date(`${month}-01`));
  $('demo-tag').hidden=signedIn;
  $('profile-name').textContent=signedIn?name:'Entrar';
  $('avatar').textContent=signedIn?name.charAt(0).toUpperCase():'P';
  $('session-action').setAttribute('aria-label',signedIn?'Sair da conta':'Entrar ou criar conta');
  document.querySelectorAll('nav [data-view]').forEach(link=>{
    if(link.dataset.view===activePage) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  const view=$('view');
  switch(activePage) {
    case 'visao':
      view.innerHTML=`<div class="metrics">${metric('Saldo atual',balance,'Conta principal','wallet')}
        ${metric('Receitas do mês',sum(income),'Entradas registradas','down')}
        ${metric('Gastos do mês',sum(expenses),'Despesas registradas','up')}
        ${metric('Fatura do mês',invoice,invoiceStatus,'card')}</div>
        <div class="overview-grid">${panel('Evolução dos gastos','Despesas acumuladas no mês',dailyChart(expenses,true))}${weekPanel(expenses)}</div>
        <div class="overview-grid">${panel('Lançamentos recentes','Movimentações do mês selecionado',table(entries.slice(0,4)),'<a class="button secondary" href="#lancamentos">Ver todos</a>')}
        ${panel('Gastos por categoria','Participação no total do mês',breakdown(expenses))}</div>`;
      break;
    case 'lancamentos':
      view.innerHTML=panel('Histórico de lançamentos','Despesas no crédito aparecem no mês da fatura. A coluna Data mostra a data da compra.',`
        <div class="filters"><input id="search" type="search" aria-label="Buscar descrição" placeholder="Buscar descrição" value="${escape(filters.search)}">
        <select id="category-filter" aria-label="Filtrar categoria">${optionList([['','Todas as categorias'],...categories.map(c=>[c,c])],filters.category)}</select>
        <select id="method-filter" aria-label="Filtrar pagamento">${optionList([['','Todos os pagamentos'],...Object.entries(methods)],filters.method)}</select></div><div id="entry-list"></div>`);
      $('search').oninput=(event)=>{filters.search=event.target.value;filterRows();};
      $('category-filter').onchange=(event)=>{filters.category=event.target.value;filterRows();};
      $('method-filter').onchange=(event)=>{filters.method=event.target.value;filterRows();};
      filterRows();
      break;
    case 'conta':
      view.innerHTML=`<section class="card panel details"><div><h2>Conta principal</h2><p class="subtitle">O saldo atual considera todos os meses registrados.</p></div>
        ${details([['Saldo atual',money(balance)],['Saldo inicial',money(initialBalance)],['Entradas no mês',money(sum(income))],['Despesas à vista no mês',money(sum(expenses.filter(e=>e.method!=='CREDIT')))]])}
        <button class="button secondary" data-command="balance">Ajustar saldo inicial</button></section>
        ${panel('Movimentações da conta','Receitas e despesas à vista do mês. Faturas pagas são exibidas na área do cartão.',table(entries.filter(e=>e.method!=='CREDIT')))}`;
      break;
    case 'fatura':
      view.innerHTML=`<section class="card panel details"><div><h2>Cartão principal</h2><p class="subtitle">Compras a partir de ${fmt(iso(moveDay(cycleClose,1)))} entram na próxima fatura.</p></div>
        ${details([['Total',money(invoice)],['Status',invoiceStatus],['Fechamento',fmt(cycleClose)],['Vencimento',fmt(dueDate)],...(payment?[['Pago em',fmt(payment.paidOn)]]:[])])}
        <button class="button secondary" type="button" data-command="card">Configurar ciclo</button>
        ${isClosed&&invoice>0&&!payment?'<button class="button primary" data-command="pay">Registrar pagamento</button>':''}</section>
        ${panel('Compras no crédito','Lançamentos incluídos nesta fatura',table(credit))}`;
      break;
    case 'relatorios': {
      const rows=categories.map(category=>[category,expenses.filter(e=>e.category===category)]).filter(([,group])=>group.length);
      view.innerHTML=`${charts(expenses)}${panel('Despesas por categoria','Detalhamento do mês selecionado',rows.length?`<div class="table-wrap"><table><thead><tr><th scope="col">Categoria</th><th scope="col">Lançamentos</th><th scope="col">Total</th></tr></thead><tbody>${rows.map(([category,group])=>`<tr><td>${category}</td><td>${group.length}</td><td><strong>${money(sum(group))}</strong></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Sem despesas no mês.</p>')}`;
      view.querySelector('section:last-child .panel-head').insertAdjacentHTML('beforeend',
        '<button type="button" class="button secondary" data-command="print">Imprimir relatório</button>');
      break;
    }
  }
  loadIcons();
}

function showDialog(title, fields, submit, task, alternate) {
  $('modal-title').textContent=title;
  $('fields').innerHTML=fields;
  $('form-error').textContent='';
  $('submit').textContent=submit;
  $('alternate').hidden=!alternate;
  $('alternate').textContent=alternate?.label ?? '';
  $('alternate').onclick=alternate?.run ?? null;
  action=task;
  if (!$('modal').open) $('modal').showModal();
  $('fields').querySelector('input,select')?.focus();
}

function auth(register=false) {
  const label=inviteOnly?'E-mail do convite':'E-mail ou celular com DDD';
  const registrationLabel=inviteOnly?'Usar convite':'Criar conta';
  showDialog(register?'Criar sua conta':'Entrar na sua conta',`
    ${register?'<label>Seu nome<input name="name" autocomplete="name" maxlength="80" required></label>':''}
    <label>${label}<input name="identifier" type="${inviteOnly?'email':'text'}" autocomplete="username" maxlength="254" required></label>
    ${register&&inviteOnly?'<label>Código de convite<input name="inviteCode" type="password" autocomplete="off" minlength="64" maxlength="64" pattern="[0-9a-fA-F]{64}" required></label>':''}
    <label>Senha<input type="password" name="password" autocomplete="${register?'new-password':'current-password'}" minlength="8" maxlength="128" required></label>`,
    register?'Criar conta':'Entrar',async form=>{
      if (!csrf) csrf=(await api('/session')).csrf;
      csrf=(await api(register?'/register':'/login','POST',Object.fromEntries(form))).csrf;
      signedIn=true;
      dashboard=null;
      $('view').innerHTML='';
      await refresh();
    },{label:register?'Já tenho conta':registrationLabel,run:()=>auth(!register)});
}
function numeric(value) {
  const text=String(value).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text) && !/^-?\d+\.\d{1,2}$/.test(text)) {
    throw new Error('Informe um valor como 42,90 ou 150.');
  }
  return Number(text.includes(',') || /^-?\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replaceAll('.','').replace(',','.') : text);
}
function entryDialog(entry) {
  const isDemo=!signedIn;
  const day=entry?.day ?? (month<=today.slice(0,7)?(month===today.slice(0,7)?today:`${month}-01`):today);
  showDialog(entry?'Editar lançamento':'Novo lançamento',`
    <label>Tipo<select name="kind">${optionList([['EXPENSE','Despesa'],['INCOME','Receita']],entry?.kind)}</select></label>
    <label>Descrição<input name="description" maxlength="120" required value="${escape(entry?.description)}"></label>
    <label>Valor total em reais<input name="amount" inputmode="decimal" required placeholder="0,00" value="${entry?String(entry.purchaseAmount ?? entry.amount).replace('.',','):''}"></label>
    <label>Categoria<select name="category">${optionList(categories.map(c=>[c,c]),entry?.category)}</select></label>
    <label>Meio de pagamento<select name="method">${optionList(Object.entries(methods),entry?.method)}</select></label>
    <label id="installment-field" hidden>Parcelamento<select name="installments">${optionList(
      Array.from({length:60},(_,i)=>[String(i+1),i ? `${i+1} parcelas` : 'À vista (1×)']),
      String(entry?.installmentCount ?? 1))}</select></label>
    <p id="installment-summary" class="subtitle" aria-live="polite" hidden></p>
    <p id="invoice-preview" class="subtitle" aria-live="polite" hidden></p>
    <label>Data<input name="day" type="date" required min="2000-01-01" max="${today}" value="${day}"></label>
    ${isDemo?'<p class="subtitle">As alterações da demonstração duram até recarregar a página.</p>':''}`,
    'Salvar',async form=>{
      const data=Object.fromEntries(form);
      const amount=numeric(data.amount);
      const description=data.description.trim();
      if (!description) throw new Error('Informe uma descrição.');
      if (amount<=0 || amount>9999999999.99) throw new Error('Informe um valor positivo de até R$ 9.999.999.999,99.');
      const installments=data.method==='CREDIT' ? Number(data.installments) : 1;
      const cents=Math.round(amount*100);
      if (cents<installments) throw new Error('Cada parcela precisa ter pelo menos um centavo.');
      const draft={...data,id:entry?.id,amount,description,installments};
      let entryMonth=data.day.slice(0,7);
      if (isDemo) {
        demoEntries ??= seedDemo();
        if (entry) removeDemoEntry(entry);
        const group=installments>1 ? demoNextId : null;
        demoEntries.push(...Array.from({length:installments},(_,index)=>({
          ...draft,id:demoNextId++,group,purchaseAmount:amount,
          amount:(Math.floor(cents/installments)+Number(index<cents%installments))/100,
          installmentCount:group ? installments : null,
          installmentNumber:group ? index+1 : null,
          reportDay:index ? `${shiftMonth(entryMonth,index)}-01` : data.day,
        })));
      } else {
        ({month:entryMonth}=await api('/entries','POST',draft));
      }
      if (entryMonth!==month) weekOffset=0;
      month=entryMonth;
      notice('Lançamento salvo.');
      await refresh();
    });
  const {kind,method,installments,amount,day:purchaseDate}=$('modal-form').elements;
  const invoicePreview=$('invoice-preview');
  let previewRequest=0;
  let firstInvoiceMonth;
  function showInvoiceMonths() {
    invoicePreview.hidden=!firstInvoiceMonth;
    if (!firstInvoiceMonth) return;
    const last=shiftMonth(firstInvoiceMonth,Number(installments.value)-1);
    const formatMonth=value=>monthFormat.format(date(`${value}-01`));
    invoicePreview.textContent=last===firstInvoiceMonth
      ? `Fatura prevista: ${formatMonth(firstInvoiceMonth)}.`
      : `Faturas previstas: de ${formatMonth(firstInvoiceMonth)} a ${formatMonth(last)}.`;
  }
  async function updateInvoiceMonths() {
    const request=++previewRequest;
    firstInvoiceMonth=undefined;
    showInvoiceMonths();
    if (method.value!=='CREDIT' || !purchaseDate.value || !purchaseDate.validity.valid) return;
    if (isDemo) {
      firstInvoiceMonth=purchaseDate.value.slice(0,7);
    } else {
      const params=new URLSearchParams({day:purchaseDate.value});
      if (entry) params.set('id',entry.id);
      try {
        const {month}=await api(`/card/preview?${params}`);
        if (request!==previewRequest) return;
        firstInvoiceMonth=month;
      } catch { return; }
    }
    showInvoiceMonths();
  }
  function updateInstallments() {
    const credit=method.value==='CREDIT';
    $('installment-field').hidden=!credit;
    installments.disabled=!credit;
    const summary=$('installment-summary');
    summary.hidden=true;
    if (!credit || Number(installments.value)<2) return;
    let cents;
    try { cents=Math.round(numeric(amount.value)*100); } catch { return; }
    const count=Number(installments.value);
    if (cents<count || cents>999999999999) return;
    const base=Math.floor(cents/count), extra=cents%count;
    summary.textContent=extra
      ? `${extra} × ${money((base+1)/100)} + ${count-extra} × ${money(base/100)}`
      : `${count} × ${money(base/100)}`;
    summary.hidden=false;
  }
  kind.onchange=()=>{
    const income=kind.value==='INCOME';
    for (const value of ['CREDIT','BOLETO']) method.querySelector(`[value=${value}]`).disabled=income;
    if(income && ['CREDIT','BOLETO'].includes(method.value)) method.value='PIX';
    updateInstallments();
    updateInvoiceMonths();
  };
  method.onchange=()=>{updateInstallments();updateInvoiceMonths();};
  installments.onchange=()=>{updateInstallments();showInvoiceMonths();};
  amount.oninput=updateInstallments;
  purchaseDate.onchange=updateInvoiceMonths;
  kind.onchange();
}

function removeDemoEntry(entry) {
  demoEntries=demoEntries.filter(item=>entry.group ? item.group!==entry.group : item.id!==entry.id);
}

$('modal-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(dialogBusy) return;
  const form=new FormData(event.currentTarget);
  dialogBusy=true;
  for(const id of ['submit','alternate','close']) $(id).disabled=true;
  $('form-error').textContent='';
  try {if (await action(form) !== false) $('modal').close();}
  catch(error){$('form-error').textContent=error.message;}
  finally {
    dialogBusy=false;
    for(const id of ['submit','alternate','close']) $(id).disabled=false;
  }
});
$('modal').addEventListener('cancel',event=>{if(dialogBusy) event.preventDefault();});
$('close').onclick=()=>$('modal').close();
$('add').onclick=()=>entryDialog();
$('month').min='2000-01';
$('month').max='2100-12';
$('month').onchange=event=>{
  if(!event.target.value || !event.target.validity.valid){event.target.value=month;return;}
  month=event.target.value;
  weekOffset=0;
  $('month-label').textContent=monthFormat.format(date(`${month}-01`));
  dashboard=null;
  $('view').innerHTML='<p class="empty">Carregando lançamentos…</p>';
  notice();
  refresh();
};
$('session-action').onclick=()=>{
  if (!signedIn) {auth();return;}
  showDialog('Sair da conta','<p>Encerre esta sessão no navegador.</p>','Sair',async()=>{
    await api('/logout','POST');
    csrf='';
    signedIn=false;
    filters={search:'',category:'',method:''};
    notice();
    await refresh();
  });
};
$('view').onclick=event=>{
  const button=event.target.closest('[data-command]');
  if(!button) return;
  if(['previous-week','next-week'].includes(button.dataset.command)){
    weekOffset+=button.dataset.command==='next-week'?1:-1;
    render();
    const controls=$('view').querySelector('.week-controls');
    (controls.querySelector(`[data-command="${button.dataset.command}"]:enabled`) || controls.querySelector('button:enabled'))?.focus();
    return;
  }
  if(button.dataset.command==='print'){window.print();return;}
  if(!dashboard) return;
  const entry=dashboard.entries.find(item=>String(item.id)===button.dataset.id);
  switch(button.dataset.command) {
    case 'edit':
      if(entry) entryDialog(entry);
      break;
    case 'delete':
      if(!entry) return;
      showDialog('Excluir lançamento',`<p>Excluir ${escape(entry.description)} de ${money(entry.purchaseAmount ?? entry.amount)}?${entry.installmentCount ? ' Todas as parcelas serão excluídas.' : ''}</p>`,'Excluir',async()=>{
        if (signedIn) await api(`/entries/${entry.id}`,'DELETE');
        else removeDemoEntry(entry);
        notice('Lançamento excluído.');
        await refresh();
      });
      break;
    case 'balance':
      if(!signedIn){auth();return;}
      showDialog('Ajustar saldo inicial',`<label>Saldo antes do primeiro lançamento<input name="amount" inputmode="decimal" required value="${String(dashboard.initialBalance).replace('.',',')}"></label>`,'Salvar',async form=>{
        await api('/balance','POST',{amount:numeric(form.get('amount'))});notice('Saldo inicial atualizado.');await refresh();
      });
      break;
    case 'card':
      if(!signedIn){auth();return;}
      showDialog('Configurar ciclo do cartão',`
        <p>Use os dias informados pelo emissor. Compras após o fechamento entram na próxima fatura. Os ciclos já definidos preservam suas datas.</p>
        <label>Dia de fechamento<input type="number" name="closeDay" min="1" max="31" required value="${dashboard.card.closeDay}"></label>
        <label>Dia de vencimento<input type="number" name="dueDay" min="1" max="31" required value="${dashboard.card.dueDay}"></label>`,
        'Salvar',async form=>{
          await api('/card','POST',{closeDay:Number(form.get('closeDay')),dueDay:Number(form.get('dueDay'))});
          notice('Configuração salva para os próximos ciclos.');await refresh();
        });
      break;
    case 'pay':
      if(!signedIn){auth();return;}
      showDialog('Registrar pagamento',`<p>Registre o pagamento de ${money(dashboard.invoice)} com a data de hoje.</p>`,'Registrar',async()=>{
        await api(`/invoice/pay?month=${encodeURIComponent(month)}`,'POST');notice('Pagamento registrado.');await refresh();
      });
      break;
  }
};
window.addEventListener('hashchange',()=>{notice();render();});
window.addEventListener('pagehide',()=>{
  if (signedIn) discardPrivateView();
});
window.addEventListener('pageshow',event=>{
  if (event.persisted && signedIn) refresh();
});
document.addEventListener('visibilitychange',()=>{
  if (!document.hidden && signedIn && !$('modal').open) refresh();
});
(async()=>{
  loadIcons();
  try {
    const session=await api('/session');
    csrf=session.csrf;
    signedIn=session.signedIn;
    inviteOnly=session.inviteOnly===true;
    today=session.today;
    month=today.slice(0,7);
  } catch {
    notice('Dados de demonstração. O servidor é necessário para criar conta e salvar dados.');
  }
  await refresh();
  const access = new URLSearchParams(window.location.search).get('acesso');
  if (!signedIn && (access === 'entrar' || access === 'convite')) auth(access === 'convite');
})();
})();
