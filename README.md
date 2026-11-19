# Ponto

Controle pessoal de gastos com Java 21, Spring Boot e PostgreSQL. O painel permite registrar receitas e despesas, acompanhar saldo e fatura e consultar ou imprimir relatórios mensais.


## Rodar localmente

É necessário ter Java 21 ou posterior, Maven e PostgreSQL. Crie um usuário e um banco próprios para a aplicação. Em um terminal SQL conectado como administrador do PostgreSQL, execute:

```sql
CREATE ROLE controle WITH LOGIN;
\password controle
CREATE DATABASE controledegastos OWNER controle;
```

No PowerShell, informe a senha definida acima no prompt seguro e inicie a aplicação:

```powershell
$env:DATABASE_URL = 'jdbc:postgresql://localhost:5432/controledegastos'
$env:DATABASE_USER = 'controle'
$env:DATABASE_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha do PostgreSQL' -AsSecureString)).Password
mvn spring-boot:run
```

Abra http://localhost:8080. A aplicação cria as tabelas na inicialização. O painel de demonstração pode ser explorado antes do cadastro. Cadastre-se com e-mail ou celular brasileiro com DDD para gravar seus dados.

## Hospedar o piloto sem manter o computador ligado

O `Dockerfile` prepara o Ponto para um **Web Service Docker** no [Render Free](https://render.com/docs/free), com HTTPS e URL própria. Use o [Neon Free](https://neon.com/pricing) para o PostgreSQL persistente. O Render Free adormece após 15 minutos sem uso e pode demorar cerca de um minuto para responder de novo. O PostgreSQL gratuito do próprio Render expira após 30 dias.

1. Prepare um banco dedicado ao Ponto no Neon. Com a conta de administração do banco, crie o papel abaixo **por SQL** e execute `src/main/resources/schema.sql` seguido de `scripts/grants-hosted.sql`. Defina a senha do papel `ponto_app` no SQL Editor do Neon. Use a conexão direta do Neon e mantenha as credenciais administrativas separadas. [Papéis do Neon](https://neon.com/docs/manage/roles).

   ```sql
   CREATE ROLE ponto_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   ```

2. Use um repositório do site com `Dockerfile`, `.dockerignore`, `pom.xml` e `src/main`. Conecte-o ao Render, selecione **Docker** e **Free**. O contêiner ativa o perfil `hosted`, escuta na porta fornecida pelo Render e espera que o banco já esteja provisionado. [Serviços web do Render](https://render.com/docs/web-services).

3. Configure as variáveis diretamente no ambiente do Render. Guarde a senha do banco e os convites como segredos, fora do Git.

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | `jdbc:postgresql://HOST/BASE?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory` |
   | `DATABASE_USER` | `ponto_app` |
   | `DATABASE_PASSWORD` | Senha do papel `ponto_app` |
   | `PONTO_INVITE_EMAIL_1` e `PONTO_INVITE_EMAIL_2` | Os dois e-mails autorizados a entrar |
   | `PONTO_INVITE_CODE_1` e `PONTO_INVITE_CODE_2` | Dois códigos distintos de 64 caracteres hexadecimais, gerados aleatoriamente |

   Para gerar cada código no PowerShell, execute o bloco abaixo uma vez e use a saída apenas na configuração do Render e no convite individual.

   ```powershell
   $bytes = New-Object byte[] 32
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $rng.Dispose()
   -join ($bytes | ForEach-Object { $_.ToString('x2') })
   ```

4. Antes de usar dados reais, acesse a URL HTTPS e confirme que **Entrar → Usar convite** exige o e-mail e o código corretos. Crie as duas contas e faça um lançamento fictício em uma delas. Abra a outra conta em um navegador separado e verifique saldo, lançamentos e fatura. Confira também se `/api/dashboard?month=2026-11` retorna `401` em uma janela anônima. Cada convite pode registrar apenas a conta de e-mail a que foi associado.

5. Comece com um banco vazio ou restaure um backup específico por uma operação separada. Para uso contínuo, mantenha cópias criptografadas fora do ambiente de hospedagem e verifique periodicamente se o backup pode ser restaurado.

O endereço pode abrir a demonstração para visitantes. A API exige sessão para acessar dados reais e aceita login somente dos dois e-mails configurados. O perfil hospedado usa cookies seguros, bloqueia scripts e estilos inline e valida a identidade TLS do PostgreSQL. O papel do serviço só recebe os privilégios necessários para operar o site. A separação de dados entre as contas é aplicada na API.

### Revalidação do perfil hospedado

`node src/test/security/hosted-smoke.cjs` testa um Ponto com o perfil `hosted` em `127.0.0.1:58084`, conectado a um banco local de teste vazio. Configure os e-mails fictícios `ponto-a@example.com` e `ponto-b@example.com` e os respectivos convites de 64 letras `a` e `b`. Use uma URL JDBC com validação TLS e uma CA de teste confiável na JVM. A suíte cobre convites, isolamento de contas, CSRF, revogação de sessão, limites por conta, cabeçalhos do navegador e renderização de descrições como texto. Use um banco novo a cada execução, pois a suíte cria as duas contas.

## Regras desta versão

- Cada perfil tem uma conta e um cartão. O banco registra o proprietário dos lançamentos e a API usa a sessão autenticada para limitar a consulta e edição.
- O saldo é calculado com base no saldo inicial, nas movimentações à vista e nos pagamentos de fatura. Informe como saldo inicial o valor anterior ao primeiro lançamento.
- A fatura reúne as compras no crédito do mês civil. Ela fecha no último dia e vence no dia 10 do mês seguinte. O pagamento integral pode ser registrado após o fechamento. As compras de uma fatura paga ficam bloqueadas para edição.
- O servidor escuta em loopback por padrão. Em um ambiente HTTPS, configure `COOKIE_SECURE=true` e defina o endereço de escuta com `SERVER_ADDRESS` conforme a infraestrutura.
