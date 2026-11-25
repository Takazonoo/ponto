'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');

const origin = 'http://127.0.0.1:58084';

function browser() {
  let cookie = '';
  let csrf = '';
  return async (route, {method='GET', body, status=200, token=csrf}={}) => {
    const response = await fetch(origin + route, {
      method,
      headers: {Cookie:cookie, 'X-CSRF-Token':token, 'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    assert.equal(response.status, status, route + ' ' + raw);
    if (route.startsWith('/api/')) assert.equal(response.headers.get('cache-control'), 'no-store');
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      assert.match(setCookie, /;\s*Secure\b/i);
      assert.match(setCookie, /;\s*HttpOnly\b/i);
      assert.match(setCookie, /;\s*SameSite=Lax\b/i);
      cookie = setCookie.split(';')[0];
    }
    const data = raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw;
    csrf = data?.csrf || csrf;
    return {data, response, cookie, csrf};
  };
}

async function checkRendering({html, script, session, dashboard}) {
  const events = new Map();
  let sessionExpired = false;
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id]) => [id, {
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
    replaceChildren() { this.innerHTML = ''; },
    querySelector() { return null; }
  }]));
  const document = {
    getElementById: id => elements.get(id),
    querySelectorAll: () => [],
    addEventListener() {}
  };
  vm.runInNewContext(script, {
    document,
    location: {hash:''},
    URLSearchParams,
    window: {location:{search:''}, addEventListener(type, handler) { events.set(type, handler); }},
    fetch: async route => sessionExpired ? {ok:false,status:401,json:async () => ({})} : ({
      ok:true,
      text:async () => JSON.stringify(route === '/api/session' ? {...session,signedIn:true} : dashboard)
    })
  });
  await new Promise(resolve => setImmediate(resolve));
  const overview = elements.get('view').innerHTML;
  assert.match(overview, /Almoço &lt;exemplo&gt; &amp; café/);
  assert.doesNotMatch(overview, /<exemplo>|style="/);
  events.get('pagehide')();
  assert.equal(elements.get('view').innerHTML, '');
  assert.equal(elements.get('profile-name').textContent, 'Conta');
  sessionExpired = true;
  events.get('pageshow')({persisted:true});
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(elements.get('view').innerHTML, /Almoço &lt;exemplo&gt;/);
}

async function test() {
  const a = browser(), b = browser(), stranger = browser();
  const home = await a('/');
  const csp = home.response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(home.response.headers.get('strict-transport-security'), /max-age=\d+/);
  assert.equal(home.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(home.response.headers.get('access-control-allow-origin'), null);
  const script = (await a('/app.js')).data;
  assert.doesNotMatch(script, /localStorage|sessionStorage|style="/);
  const {data:session, cookie:oldCookie, csrf:oldToken} = await a('/api/session');
  const {today, inviteOnly} = session;
  await b('/api/session');
  await stranger('/api/session');
  assert.equal(inviteOnly,true);
  const month='/api/dashboard?month='+today.slice(0,7);
  await stranger(month,{status:401});
  await stranger('/api/balance',{method:'POST',body:{amount:1000},status:401});
  await stranger('/api/invoice/pay?month='+today.slice(0,7),{method:'POST',status:401});
  await stranger('/api/entries',{method:'POST',body:{},status:401});

  const password = 'senha-ficticia-do-teste';
  const profileA = {name:'Pessoa A',identifier:'ponto-a@example.com',password,inviteCode:'a'.repeat(64)};
  const profileB = {name:'Pessoa B',identifier:'ponto-b@example.com',password,inviteCode:'b'.repeat(64)};
  await a('/api/register',{method:'POST',body:{...profileA,inviteCode:null},status:403});
  await a('/api/register',{method:'POST',body:{...profileA,inviteCode:profileB.inviteCode},status:403});
  await a('/api/register',{method:'POST',body:{...profileA,identifier:'terceiro@example.com'},status:403});
  const activeA = await a('/api/register',{method:'POST',body:profileA,status:200});
  assert.notEqual(activeA.cookie,oldCookie);
  assert.notEqual(activeA.csrf,oldToken);
  await b('/api/register',{method:'POST',body:profileB,status:200});
  await stranger('/api/register',{method:'POST',body:profileA,status:409});
  await a('/api/balance',{method:'POST',body:{amount:1000},token:'outro-token',status:403});
  await a('/api/balance',{method:'POST',body:{amount:1000}});
  const entry={kind:'EXPENSE', description:'Almoço <exemplo> & café', amount:42.9, category:'Alimentação',
    method:'CREDIT', day:today};
  await a('/api/entries',{method:'POST',body:entry});
  const {data:dashboardA}=await a(month);
  const {data:dashboardB}=await b(month);
  assert.equal(dashboardA.invoice,42.9);
  assert.equal(dashboardA.balance,1000);
  assert.equal(dashboardA.entries[0].description,entry.description);
  await checkRendering({html:(await stranger('/painel.html')).data, script, session, dashboard:dashboardA});
  assert.equal(dashboardB.invoice,0);
  assert.equal(dashboardB.balance,0);
  assert.deepEqual(dashboardB.entries,[]);
  const prior = new Date(today.slice(0,7)+'-01T00:00:00Z');
  prior.setUTCDate(0);
  const priorDay = prior.toISOString().slice(0,10);
  const previousInvoice = '?month='+priorDay.slice(0,7);
  await a('/api/entries',{method:'POST',body:{...entry,day:priorDay}});
  await b('/api/invoice/pay'+previousInvoice,{method:'POST',status:400});
  const beforePayment = (await a('/api/dashboard'+previousInvoice)).data;
  assert.equal(beforePayment.invoice,42.9);
  assert.equal(beforePayment.payment,null);
  const id=dashboardA.entries[0].id;
  await b('/api/entries/'+id,{method:'DELETE',status:404});
  await b('/api/entries',{method:'POST',body:{...entry,id},status:404});

  await b('/api/card',{method:'POST',body:{closeDay:20,dueDay:31},token:'inválido',status:403});
  await b('/api/card',{method:'POST',body:{closeDay:20,dueDay:31}});
  const purchase={...entry,day:'2024-12-21',amount:700,installments:3};
  await stranger('/api/card/preview?day='+purchase.day,{status:401});
  assert.equal((await b('/api/card/preview?day='+purchase.day)).data.month,'2025-01');
  assert.equal((await b('/api/entries',{method:'POST',body:purchase})).data.month,'2025-01');
  const january=(await b('/api/dashboard?month=2025-01')).data;
  const february=(await b('/api/dashboard?month=2025-02')).data;
  const march=(await b('/api/dashboard?month=2025-03')).data;
  assert.deepEqual([january.invoice,february.invoice,march.invoice],[233.34,233.33,233.33]);
  assert.equal(february.dueDate,'2025-02-28');
  assert.equal(february.entries[0].installmentNumber,2);
  assert.equal(february.entries[0].purchaseAmount,700);
  await b('/api/entries',{method:'POST',body:{...purchase,method:'BOLETO',installments:1,amount:75}});
  assert.equal((await b('/api/dashboard?month=2024-12')).data.balance,-75);
  assert.equal((await b('/api/dashboard?month=2024-12')).data.invoice,0);
  await b('/api/invoice/pay?month=2025-01',{method:'POST'});
  await b('/api/entries/'+february.entries[0].id,{method:'DELETE',status:400});
  assert.equal((await b('/api/dashboard?month=2025-02')).data.entries[0].locked,true);
  assert.equal((await a('/api/dashboard?month=2025-02')).data.card.closeDay,31);
  await a('/api/logout',{method:'POST'});
  assert.equal((await fetch(origin+month,{headers:{Cookie:activeA.cookie}})).status,401);

  await a('/api/session');
  for (let i=0;i<10;i++) {
    await a('/api/login',{method:'POST',body:{...profileA,password:'senha-de-teste-errada'},status:401});
  }
  await a('/api/login',{method:'POST',body:profileA,status:429});
  await b('/api/logout',{method:'POST'});
  await b('/api/session');
  await b('/api/login',{method:'POST',body:profileB});
  assert.equal((await b(month)).data.name,'Pessoa B');

  console.log('OK: cookies seguros, cadastro por convite, CSRF, isolamento, revogação e limite independente por conta.');
}

test().catch(error => { console.error(error); process.exitCode=1; });
