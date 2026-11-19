'use strict';

const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const {existsSync} = require('node:fs');
const {homedir} = require('node:os');
const path = require('node:path');
const {createInterface} = require('node:readline/promises');
const {setTimeout: delay} = require('node:timers/promises');

const origin = 'http://127.0.0.1:58083';
const configuredEmail = /^[A-Z0-9.!#$%&'+\/=?^_{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i;

async function verifyOrigin() {
  const session = await fetch(origin + '/api/session', {signal: AbortSignal.timeout(4000)});
  if (!session.ok) throw new Error('A instância privada do Ponto não respondeu.');
  const cookie = session.headers.get('set-cookie') ?? '';
  if (!/;\s*Secure\b/i.test(cookie) || !/;\s*HttpOnly\b/i.test(cookie) || !/;\s*SameSite=Lax\b/i.test(cookie)) {
    throw new Error('O cookie da instância local não passou na verificação. Túnel cancelado.');
  }
  const data = await session.json();
  if (data.signedIn !== false || typeof data.csrf !== 'string') {
    throw new Error('A instância na porta 58083 não parece ser o Ponto. Túnel cancelado.');
  }
}

function signedBinary() {
  const binary = path.join(homedir(), 'Downloads', 'cloudflared-windows-amd64.exe');
  if (!existsSync(binary)) throw new Error('O cloudflared oficial não foi encontrado na pasta Downloads.');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "$sig=Get-AuthenticodeSignature -LiteralPath $env:PONTO_TUNNEL_BINARY; if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notlike '*Cloudflare, Inc.*') {exit 1}"
  ], {env: {...process.env, PONTO_TUNNEL_BINARY: binary}, windowsHide: true});
  if (result.status !== 0) throw new Error('A assinatura do executável do Cloudflare não foi confirmada.');
  return binary;
}

async function askEmails() {
  const input = createInterface({input: process.stdin, output: process.stdout});
  try {
    const emails = [];
    for (const prompt of ['Seu e-mail: ', 'E-mail da sua namorada: ']) {
      const email = (await input.question(prompt)).trim().toLowerCase();
      if (email.length > 254 || !configuredEmail.test(email)) {
        throw new Error('Informe um endereço de e-mail completo, sem curingas ou listas.');
      }
      if (emails.includes(email)) throw new Error('Informe dois e-mails diferentes.');
      emails.push(email);
    }
    return emails;
  } finally {
    input.close();
  }
}

async function checkAnonymous(url, route) {
  const response = await fetch(new URL(route, url), {redirect: 'manual', signal: AbortSignal.timeout(5000)});
  if ([401, 403].includes(response.status)) return true;
  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location) {
    const destination = new URL(location, url);
    return destination.protocol === 'https:' && (
      destination.hostname.endsWith('.cloudflareaccess.com') ||
      (destination.origin === new URL(url).origin && destination.pathname.startsWith('/cdn-cgi/access/'))
    );
  }
  if (response.ok) {
    const body = await response.text();
    if (/<title>Ponto|\"signedIn\"\s*:/i.test(body)) {
      throw new Error('O Ponto respondeu sem a autenticação externa. Túnel cancelado.');
    }
    return /cloudflareaccess\.com|cloudflare access|\/cdn-cgi\/access\//i.test(body);
  }
  return false;
}

async function verifyTunnel(url) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let checks;
    try {
      checks = await Promise.all(['/', '/api/session'].map(route => checkAnonymous(url, route)));
    } catch (error) {
      if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error;
    }
    if (checks?.every(Boolean)) return;
    await delay(2000);
  }
  throw new Error('Não foi possível confirmar a barreira de acesso na URL HTTPS. Túnel cancelado.');
}

async function main() {
  await verifyOrigin();
  const binary = signedBinary();
  if (process.argv.includes('--verificar-local')) {
    console.log('Instância privada e assinatura do Cloudflare verificadas.');
    return;
  }
  console.log('Autorize os dois endereços abaixo. Cada pessoa receberá um código no próprio e-mail ao entrar.');
  const emails = await askEmails();

  const tunnel = spawn(binary, ['tunnel', '--url', origin, '--allowed-mail=' + emails[0], '--allowed-mail=' + emails[1]],
    {stdio: ['ignore', 'pipe', 'pipe']});
  let url;
  let verification;
  const stop = () => tunnel.kill();
  process.once('SIGINT', stop);
  for (const stream of [tunnel.stdout, tunnel.stderr]) {
    const lines = createInterface({input: stream});
    lines.on('line', line => {
      const found = line.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\b/i);
      if (found) {
        if (url) return;
        url = found[0];
        console.log('Endereço temporário recebido. Verificando o acesso sem autenticação…');
        verification = verifyTunnel(url).then(() => {
          if (tunnel.exitCode === null && !tunnel.killed) {
            console.log('\nLink privado do Ponto: ' + url);
            console.log('Mantenha esta janela aberta. Cada pessoa entra com seu próprio e-mail e sua conta do Ponto.\n');
          }
        }).catch(error => {
          console.error(error.message);
          stop();
          process.exitCode = 1;
        });
      } else if (/\b(ERR|WRN|failed to|error)\b/i.test(line)) {
        console.error('Cloudflare: ' + line);
      }
    });
  }
  const [code] = await once(tunnel, 'close');
  process.removeListener('SIGINT', stop);
  await verification;
  if (!url && code !== 0) throw new Error('O Cloudflare não abriu a conexão. Confira o erro acima.');
}

main().catch(error => {
  console.error(error.cause ? error.message + '. Confira se a instância privada do Ponto está ativa.' : error.message);
  process.exitCode = 1;
});
