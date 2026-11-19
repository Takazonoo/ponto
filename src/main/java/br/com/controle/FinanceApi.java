package br.com.controle;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class FinanceApi {
    private static final ZoneId ZONE = ZoneId.of("America/Sao_Paulo");
    private static final Set<String> CATEGORIES = Set.of("Alimentação", "Moradia", "Transporte",
        "Jogos", "Entretenimento", "Vestuário", "Saúde", "Trabalho", "Outros");
    private final JdbcTemplate db;
    private final AuthRateLimit authRateLimit;
    private final RegistrationPolicy registration;
    private final String dummyHash = Passwords.hash(UUID.randomUUID().toString());

    public FinanceApi(JdbcTemplate db, AuthRateLimit authRateLimit, RegistrationPolicy registration) {
        this.db = db;
        this.authRateLimit = authRateLimit;
        this.registration = registration;
    }

    record Credentials(String identifier, String password, String name, String inviteCode) {}
    record Account(long id, String hash) {}
    record Entry(Long id, String kind, String description, BigDecimal amount, String category,
                 String method, LocalDate day) {}
    record Payment(LocalDate period, LocalDate paidOn, BigDecimal amount) {}
    record Balance(BigDecimal amount) {}
    record Dashboard(String name, LocalDate today, String month, BigDecimal initialBalance,
                     BigDecimal balance, BigDecimal invoice, LocalDate dueDate, Payment payment,
                     List<Entry> entries) {}

    @GetMapping("/session")
    Map<String, Object> session(HttpSession session) {
        return Map.of("csrf", token(session), "signedIn", session.getAttribute("owner") != null,
            "today", today(), "inviteOnly", registration.inviteOnly());
    }

    @PostMapping("/register")
    Map<String, String> register(@RequestBody Credentials input, HttpServletRequest request) {
        HttpSession anonymousSession = verify(request);
        if (!registration.inviteOnly()) authRateLimit.register(request.getRemoteAddr());
        String identifier = normalize(input.identifier());
        registration.check(identifier, input.inviteCode());
        if (registration.inviteOnly()) authRateLimit.register(registration.loginBucket(identifier, request.getRemoteAddr()));
        String name = input.name() == null ? "" : input.name().strip();
        require(!name.isEmpty() && name.length() <= 80, "Informe um nome de até 80 caracteres.");
        require(validPassword(input.password()), "Use uma senha de 8 a 128 caracteres.");
        boolean email = identifier.contains("@");
        try {
            Long id = db.queryForObject("""
                insert into profiles(name,email,phone,password_hash) values (?,?,?,?) returning id
                """, Long.class, name, email ? identifier : null, email ? null : identifier,
                Passwords.hash(input.password()));
            return signIn(request, anonymousSession, id);
        } catch (DuplicateKeyException ex) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este e-mail ou celular já está cadastrado.");
        }
    }

    @PostMapping("/login")
    Map<String, String> login(@RequestBody Credentials input, HttpServletRequest request) {
        HttpSession anonymousSession = verify(request);
        String identifier = normalize(input.identifier());
        authRateLimit.login(registration.loginBucket(identifier, request.getRemoteAddr()));
        require(validPassword(input.password()), "Confira o e-mail, celular e senha.");
        var accounts = db.query("""
            select id,password_hash from profiles where email=? or phone=?
            """, (rs, row) -> new Account(rs.getLong(1), rs.getString(2)),
            identifier, identifier);
        Account account = accounts.isEmpty() || !registration.allowsLogin(identifier) ? null : accounts.getFirst();
        if (!Passwords.matches(input.password(), account == null ? dummyHash : account.hash()) || account == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "E-mail, celular ou senha incorretos.");
        }
        return signIn(request, anonymousSession, account.id());
    }

    @ExceptionHandler(ResponseStatusException.class)
    ProblemDetail requestError(ResponseStatusException error) {
        return error.getBody();
    }

    @PostMapping("/logout")
    void logout(HttpServletRequest request) {
        endSession(verify(request));
    }

    @GetMapping("/dashboard")
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    Dashboard dashboard(@RequestParam String month, HttpSession session) {
        long owner = owner(session);
        YearMonth period = parseMonth(month);
        LocalDate start = period.atDay(1);
        LocalDate end = period.atEndOfMonth();
        List<Entry> entries = db.query("""
            select id,kind,description,amount,category,method,day from entries
            where owner_id=? and day between ? and ? order by day desc,id desc
            """, (rs, row) -> new Entry(rs.getLong(1), rs.getString(2), rs.getString(3),
                rs.getBigDecimal(4), rs.getString(5), rs.getString(6), rs.getObject(7, LocalDate.class)),
            owner, start, end);
        String name = db.queryForObject("select name from profiles where id=?", String.class, owner);
        BigDecimal initial = db.queryForObject("select initial_balance from profiles where id=?",
            BigDecimal.class, owner);
        BigDecimal balance = initial.add(db.queryForObject("""
            select coalesce(sum(case when kind='INCOME' then amount else -amount end),0)
            from entries where owner_id=? and method<>'CREDIT' and day<=?
            """, BigDecimal.class, owner, today())).subtract(db.queryForObject("""
            select coalesce(sum(amount),0) from invoice_payments where owner_id=? and paid_on<=?
            """, BigDecimal.class, owner, today()));
        var payments = db.query("""
            select period,paid_on,amount from invoice_payments where owner_id=? and period=?
            """, (rs, row) -> new Payment(rs.getObject(1, LocalDate.class), rs.getObject(2, LocalDate.class),
                rs.getBigDecimal(3)), owner, start);
        return new Dashboard(name, today(), period.toString(), initial, balance, invoice(owner, period),
            period.plusMonths(1).atDay(10), payments.isEmpty() ? null : payments.getFirst(), entries);
    }

    @PostMapping("/balance")
    void balance(@RequestBody Balance value, HttpServletRequest request) {
        long owner = writeOwner(request);
        validateAmount(value.amount(), true);
        db.update("update profiles set initial_balance=? where id=?", value.amount(), owner);
    }

    @PostMapping("/entries")
    @Transactional
    void save(@RequestBody Entry entry, HttpServletRequest request) {
        saveEntry(writeOwner(request), entry);
    }

    void saveEntry(long owner, Entry entry) {
        lockOwner(owner);
        require(entry.kind() != null && Set.of("EXPENSE", "INCOME").contains(entry.kind()), "Tipo inválido.");
        require(entry.method() != null && Set.of("CREDIT", "DEBIT", "PIX", "CASH").contains(entry.method()),
            "Meio de pagamento inválido.");
        require(entry.category() != null && CATEGORIES.contains(entry.category()), "Categoria inválida.");
        require(entry.description() != null && !entry.description().isBlank() && entry.description().length() <= 120,
            "Informe uma descrição de até 120 caracteres.");
        require(entry.day() != null && entry.day().getYear() >= 2000 && !entry.day().isAfter(today()),
            "Informe uma data válida até hoje.");
        require(!"INCOME".equals(entry.kind()) || !"CREDIT".equals(entry.method()), "Receitas não entram na fatura.");
        validateAmount(entry.amount(), false);
        if ("CREDIT".equals(entry.method())) ensureUnpaid(owner, entry.day());
        if (entry.id() == null) {
            db.update("""
                insert into entries(owner_id,kind,description,amount,category,method,day) values (?,?,?,?,?,?,?)
                """, owner, entry.kind(), entry.description().strip(), entry.amount(), entry.category(),
                entry.method(), entry.day());
        } else {
            ensureEditable(owner, entry.id());
            db.update("""
                update entries set kind=?,description=?,amount=?,category=?,method=?,day=? where id=? and owner_id=?
                """, entry.kind(), entry.description().strip(), entry.amount(), entry.category(),
                entry.method(), entry.day(), entry.id(), owner);
        }
    }

    @DeleteMapping("/entries/{id}")
    @Transactional
    void delete(@PathVariable long id, HttpServletRequest request) {
        long owner = writeOwner(request);
        lockOwner(owner);
        ensureEditable(owner, id);
        db.update("delete from entries where id=? and owner_id=?", id, owner);
    }

    @PostMapping("/invoice/pay")
    @Transactional
    void pay(@RequestParam String month, HttpServletRequest request) {
        long owner = writeOwner(request);
        lockOwner(owner);
        YearMonth period = parseMonth(month);
        require(period.atEndOfMonth().isBefore(today()), "A fatura ainda está aberta.");
        ensureUnpaid(owner, period.atDay(1));
        BigDecimal amount = invoice(owner, period);
        require(amount.signum() > 0, "A fatura está sem compras.");
        db.update("insert into invoice_payments(owner_id,period,paid_on,amount) values (?,?,?,?)",
            owner, period.atDay(1), today(), amount);
    }

    private BigDecimal invoice(long owner, YearMonth period) {
        return db.queryForObject("""
            select coalesce(sum(amount),0) from entries where owner_id=? and method='CREDIT' and day between ? and ?
            """, BigDecimal.class, owner, period.atDay(1), period.atEndOfMonth());
    }

    private void ensureEditable(long owner, long id) {
        var entries = db.query("select method,day from entries where owner_id=? and id=?",
            (rs, row) -> Map.entry(rs.getString(1), rs.getObject(2, LocalDate.class)), owner, id);
        if (entries.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lançamento indisponível.");
        var entry = entries.getFirst();
        if ("CREDIT".equals(entry.getKey())) ensureUnpaid(owner, entry.getValue());
    }

    void lockOwner(long owner) {
        db.queryForObject("select id from profiles where id=? for update", Long.class, owner);
    }

    private void ensureUnpaid(long owner, LocalDate day) {
        Boolean paid = db.queryForObject("""
            select exists(select 1 from invoice_payments where owner_id=? and period=?)
            """, Boolean.class, owner, day.withDayOfMonth(1));
        require(!Boolean.TRUE.equals(paid), "A fatura já foi paga.");
    }

    private static String normalize(String raw) {
        String value = raw == null ? "" : raw.strip().toLowerCase(Locale.ROOT);
        if (value.contains("@")) {
            require(value.length() <= 254 && value.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"), "Informe um e-mail válido.");
            return value;
        }
        String number = value.replaceAll("[ ()+.-]", "");
        if (number.matches("[0-9]{11}")) number = "55" + number;
        require(number.matches("55[1-9][0-9]9[0-9]{8}"), "Informe um celular brasileiro com DDD.");
        return "+" + number;
    }

    private static YearMonth parseMonth(String input) {
        try {
            YearMonth month = YearMonth.parse(input);
            require(month.getYear() >= 2000 && month.getYear() <= 2100, "Mês inválido.");
            return month;
        } catch (java.time.format.DateTimeParseException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Mês inválido.");
        }
    }

    private static void validateAmount(BigDecimal value, boolean signed) {
        require(value != null && (signed || value.signum() > 0) && value.scale() <= 2
            && value.abs().compareTo(new BigDecimal("9999999999.99")) <= 0, "Informe um valor válido com até duas casas decimais.");
    }

    private static boolean validPassword(String value) {
        return value != null && value.length() >= 8 && value.length() <= 128;
    }

    private static Map<String, String> signIn(HttpServletRequest request, HttpSession previous, long id) {
        endSession(previous);
        HttpSession session = request.getSession();
        session.setAttribute("owner", id);
        return Map.of("csrf", token(session));
    }

    private static void endSession(HttpSession session) {
        try {
            session.invalidate();
        } catch (IllegalStateException alreadyEnded) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A sessão expirou. Recarregue a página.");
        }
    }

    private static String token(HttpSession session) {
        synchronized (session) {
            String token = (String) session.getAttribute("csrf");
            if (token == null) {
                token = UUID.randomUUID().toString();
                session.setAttribute("csrf", token);
            }
            return token;
        }
    }

    private static HttpSession verify(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        String token = request.getHeader("X-CSRF-Token");
        try {
            if (token != null && session != null && token.equals(session.getAttribute("csrf"))) return session;
        } catch (IllegalStateException alreadyEnded) {
            // The session may have ended while another request was in flight.
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A sessão expirou. Recarregue a página.");
    }

    static long writeOwner(HttpServletRequest request) {
        return owner(verify(request));
    }

    static long owner(HttpSession session) {
        try {
            if (session != null && session.getAttribute("owner") instanceof Long id) return id;
        } catch (IllegalStateException alreadyEnded) {
            // Treat an invalidated session as signed out.
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Entre para acessar sua conta.");
    }

    static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
