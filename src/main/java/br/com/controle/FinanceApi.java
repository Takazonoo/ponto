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
import org.springframework.format.annotation.DateTimeFormat;
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
                 String method, LocalDate day, Integer installmentNumber, Integer installmentCount,
                 BigDecimal purchaseAmount, LocalDate reportDay, boolean locked) {}
    record EntryInput(Long id, String kind, String description, BigDecimal amount, String category,
                      String method, LocalDate day, Integer installments) {}
    record CardSettings(Integer closeDay, Integer dueDay) {}
    record Cycle(LocalDate closesOn, LocalDate dueOn) {}
    record ExistingEntry(UUID group, LocalDate day, YearMonth firstPeriod) {}
    record Payment(LocalDate period, LocalDate paidOn, BigDecimal amount) {}
    record Balance(BigDecimal amount) {}
    record Dashboard(String name, LocalDate today, String month, BigDecimal initialBalance,
                     BigDecimal balance, BigDecimal invoice, LocalDate dueDate, LocalDate closesOn, CardSettings card, Payment payment,
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
            select e.id,e.kind,e.description,e.amount,e.category,e.method,e.day,
                   e.installment_number,e.installment_count,
                   coalesce((select sum(part.amount) from entries part
                       where part.owner_id=e.owner_id and part.installment_group=e.installment_group), e.amount),
                   case when e.invoice_period is null then e.day
                        else greatest(e.invoice_period, least(e.day, (?::date))) end as report_day,
                   exists(select 1 from invoice_payments p
                       where p.owner_id=e.owner_id and (p.period=coalesce(e.invoice_period,
                           case when e.method='CREDIT' then date_trunc('month', e.day)::date end) or exists (
                           select 1 from entries part where part.owner_id=e.owner_id
                           and part.installment_group=e.installment_group and part.invoice_period=p.period))) as locked
            from entries e where e.owner_id=?
                and (e.invoice_period=? or (e.invoice_period is null and e.day between ? and ?))
            order by report_day desc,e.id desc
            """, (rs, row) -> new Entry(rs.getLong(1), rs.getString(2), rs.getString(3),
                rs.getBigDecimal(4), rs.getString(5), rs.getString(6), rs.getObject(7, LocalDate.class),
                rs.getObject(8, Integer.class), rs.getObject(9, Integer.class), rs.getBigDecimal(10),
                rs.getObject(11, LocalDate.class), rs.getBoolean(12)), end, owner, start, start, end);
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
        CardSettings card = cardSettings(owner);
        Cycle cycle = cycle(owner, period, card);
        return new Dashboard(name, today(), period.toString(), initial, balance, invoice(owner, period),
            cycle.dueOn(), cycle.closesOn(), card, payments.isEmpty() ? null : payments.getFirst(), entries);
    }

    @PostMapping("/balance")
    void balance(@RequestBody Balance value, HttpServletRequest request) {
        long owner = writeOwner(request);
        validateAmount(value.amount(), true);
        db.update("update profiles set initial_balance=? where id=?", value.amount(), owner);
    }

    @PostMapping("/card")
    @Transactional
    void configureCard(@RequestBody CardSettings card, HttpServletRequest request) {
        long owner = writeOwner(request);
        require(validCardDay(card.closeDay()) && validCardDay(card.dueDay()), "Informe dias entre 1 e 31.");
        lockOwner(owner);
        db.update("update profiles set card_close_day=?,card_due_day=? where id=?", card.closeDay(), card.dueDay(), owner);
    }

    @GetMapping("/card/preview")
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    Map<String, String> previewCard(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate day,
                                    @RequestParam(required = false) Long id,
                                    HttpSession session) {
        long owner = owner(session);
        require(day.getYear() >= 2000 && !day.isAfter(today()), "Informe uma data válida até hoje.");
        ExistingEntry existing = id == null ? null : ensureEditable(owner, id);
        return Map.of("month", purchasePeriod(owner, day, cardSettings(owner), existing).toString());
    }

    @PostMapping("/entries")
    @Transactional
    Map<String, String> save(@RequestBody EntryInput entry, HttpServletRequest request) {
        long owner = writeOwner(request);
        lockOwner(owner);
        require(entry.kind() != null && Set.of("EXPENSE", "INCOME").contains(entry.kind()), "Tipo inválido.");
        require(entry.method() != null && Set.of("CREDIT", "DEBIT", "PIX", "CASH", "BOLETO").contains(entry.method()),
            "Meio de pagamento inválido.");
        require(entry.category() != null && CATEGORIES.contains(entry.category()), "Categoria inválida.");
        require(entry.description() != null && !entry.description().isBlank() && entry.description().length() <= 120,
            "Informe uma descrição de até 120 caracteres.");
        require(entry.day() != null && entry.day().getYear() >= 2000 && !entry.day().isAfter(today()),
            "Informe uma data válida até hoje.");
        boolean credit = "CREDIT".equals(entry.method());
        require(!"INCOME".equals(entry.kind()) || (!credit && !"BOLETO".equals(entry.method())),
            "Crédito e boleto são meios de pagamento de despesas.");
        validateAmount(entry.amount(), false);
        int count = entry.installments() == null ? 1 : entry.installments();
        long cents = entry.amount().movePointRight(2).longValueExact();
        require(count >= 1 && count <= 60 && (credit || count == 1) && cents >= count,
            "Informe até 60 parcelas de pelo menos um centavo para compras no crédito.");
        ExistingEntry existing = entry.id() == null ? null : ensureEditable(owner, entry.id());
        CardSettings card = credit ? cardSettings(owner) : null;
        YearMonth first = null;
        if (credit) {
            YearMonth purchaseMonth = YearMonth.from(entry.day());
            first = purchasePeriod(owner, entry.day(), card, existing);
            require(first.plusMonths(count - 1L).getYear() <= 2100, "A última parcela excede o período disponível.");
            if (!purchaseMonth.equals(first)) freezeCycle(owner, purchaseMonth, card);
            for (int index = 0; index < count; index++) {
                YearMonth period = first.plusMonths(index);
                ensureUnpaid(owner, period.atDay(1));
                freezeCycle(owner, period, card);
            }
        }
        String month = (first == null ? YearMonth.from(entry.day()) : first).toString();
        if (existing != null && existing.group() == null && count == 1) {
            db.update("""
                update entries set kind=?,description=?,amount=?,category=?,method=?,day=?,invoice_period=?
                where id=? and owner_id=?
                """, entry.kind(), entry.description().strip(), entry.amount(), entry.category(),
                entry.method(), entry.day(), first == null ? null : first.atDay(1), entry.id(), owner);
            return Map.of("month", month);
        }
        if (existing != null) deleteEntry(owner, entry.id(), existing.group());
        UUID group = count == 1 ? null : existing != null && existing.group() != null ? existing.group() : UUID.randomUUID();
        for (int index = 0; index < count; index++) {
            BigDecimal amount = BigDecimal.valueOf(cents / count + (index < cents % count ? 1 : 0), 2);
            db.update("""
                insert into entries(owner_id,kind,description,amount,category,method,day,invoice_period,
                    installment_group,installment_number,installment_count) values (?,?,?,?,?,?,?,?,?,?,?)
                """, owner, entry.kind(), entry.description().strip(), amount, entry.category(), entry.method(),
                entry.day(), first == null ? null : first.plusMonths(index).atDay(1),
                group, group == null ? null : index + 1, group == null ? null : count);
        }
        return Map.of("month", month);
    }

    @DeleteMapping("/entries/{id}")
    @Transactional
    void delete(@PathVariable long id, HttpServletRequest request) {
        long owner = writeOwner(request);
        lockOwner(owner);
        deleteEntry(owner, id, ensureEditable(owner, id).group());
    }

    private void deleteEntry(long owner, long id, UUID group) {
        if (group == null) db.update("delete from entries where owner_id=? and id=?", owner, id);
        else db.update("delete from entries where owner_id=? and installment_group=?", owner, group);
    }

    @PostMapping("/invoice/pay")
    @Transactional
    void pay(@RequestParam String month, HttpServletRequest request) {
        long owner = writeOwner(request);
        lockOwner(owner);
        YearMonth period = parseMonth(month);
        require(cycle(owner, period, cardSettings(owner)).closesOn().isBefore(today()), "A fatura ainda está aberta.");
        ensureUnpaid(owner, period.atDay(1));
        BigDecimal amount = invoice(owner, period);
        require(amount.signum() > 0, "A fatura está sem compras.");
        db.update("insert into invoice_payments(owner_id,period,paid_on,amount) values (?,?,?,?)",
            owner, period.atDay(1), today(), amount);
    }

    private BigDecimal invoice(long owner, YearMonth period) {
        return db.queryForObject("""
            select coalesce(sum(amount),0) from entries where owner_id=? and
                (invoice_period=? or (invoice_period is null and method='CREDIT' and day between ? and ?))
            """, BigDecimal.class, owner, period.atDay(1), period.atDay(1), period.atEndOfMonth());
    }

    private ExistingEntry ensureEditable(long owner, long id) {
        var entries = db.query("""
            select installment_group,day,coalesce(invoice_period,
                case when method='CREDIT' then date_trunc('month', day)::date end)
            from entries where owner_id=? and id=?
            """, (rs, row) -> {
                LocalDate period = rs.getObject(3, LocalDate.class);
                return new ExistingEntry(rs.getObject(1, UUID.class), rs.getObject(2, LocalDate.class),
                    period == null ? null : YearMonth.from(period));
            }, owner, id);
        if (entries.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lançamento indisponível.");
        ExistingEntry entry = entries.getFirst();
        if (entry.group() == null) {
            if (entry.firstPeriod() != null) ensureUnpaid(owner, entry.firstPeriod().atDay(1));
            return entry;
        }
        List<LocalDate> periods = db.queryForList("""
            select invoice_period from entries where owner_id=? and installment_group=? order by invoice_period
            """, LocalDate.class, owner, entry.group());
        periods.forEach(period -> ensureUnpaid(owner, period));
        return new ExistingEntry(entry.group(), entry.day(), YearMonth.from(periods.getFirst()));
    }

    private CardSettings cardSettings(long owner) {
        return db.queryForObject("select card_close_day,card_due_day from profiles where id=?",
            (rs, row) -> new CardSettings(rs.getInt(1), rs.getInt(2)), owner);
    }

    private YearMonth purchasePeriod(long owner, LocalDate purchase, CardSettings card, ExistingEntry existing) {
        if (existing != null && purchase.equals(existing.day()) && existing.firstPeriod() != null) {
            return existing.firstPeriod();
        }
        YearMonth period = YearMonth.from(purchase);
        return purchase.isAfter(cycle(owner, period, card).closesOn()) ? period.plusMonths(1) : period;
    }

    private void freezeCycle(long owner, YearMonth period, CardSettings card) {
        Cycle dates = cycle(owner, period, card);
        db.update("""
            insert into invoice_cycles(owner_id,period,closes_on,due_on) values (?,?,?,?)
            on conflict (owner_id,period) do nothing
            """, owner, period.atDay(1), dates.closesOn(), dates.dueOn());
    }

    private Cycle cycle(long owner, YearMonth period, CardSettings card) {
        var saved = db.query("select closes_on,due_on from invoice_cycles where owner_id=? and period=?",
            (rs, row) -> new Cycle(rs.getObject(1, LocalDate.class), rs.getObject(2, LocalDate.class)),
            owner, period.atDay(1));
        if (!saved.isEmpty()) return saved.getFirst();
        Boolean hasLegacyPurchase = db.queryForObject("""
            select exists(select 1 from entries where owner_id=? and method='CREDIT'
                and invoice_period is null and day between ? and ?)
            """, Boolean.class, owner, period.atDay(1), period.atEndOfMonth());
        if (Boolean.TRUE.equals(hasLegacyPurchase)) {
            return new Cycle(period.atEndOfMonth(), period.plusMonths(1).atDay(10));
        }
        LocalDate close = cardDate(period, card.closeDay());
        LocalDate due = cardDate(period, card.dueDay());
        return new Cycle(close, due.isAfter(close) ? due : cardDate(period.plusMonths(1), card.dueDay()));
    }

    private static LocalDate cardDate(YearMonth month, int day) {
        return month.atDay(Math.min(day, month.lengthOfMonth()));
    }

    private static boolean validCardDay(Integer day) {
        return day != null && day >= 1 && day <= 31;
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
