package br.com.controle;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class AuthRateLimit {
    private final JdbcTemplate db;

    AuthRateLimit(JdbcTemplate db) {
        this.db = db;
    }

    void login(String clientAddress) {
        check("login", clientAddress, 10);
    }

    void register(String clientAddress) {
        check("register", clientAddress, 5);
    }

    private void check(String operation, String clientAddress, int limit) {
        db.update("delete from auth_rate_limits where expires_at <= clock_timestamp()");
        var allowed = db.queryForList("""
            insert into auth_rate_limits(operation,client_address,expires_at,attempts)
            values (?,?,clock_timestamp() + interval '15 minutes',1)
            on conflict (operation,client_address) do update set
                expires_at = case when auth_rate_limits.expires_at <= clock_timestamp() then excluded.expires_at
                    else auth_rate_limits.expires_at end,
                attempts = case when auth_rate_limits.expires_at <= clock_timestamp() then 1
                    else auth_rate_limits.attempts + 1 end
            where auth_rate_limits.expires_at <= clock_timestamp() or auth_rate_limits.attempts < ?
            returning attempts
            """, Integer.class, operation, clientAddress, limit);
        if (allowed.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                "Muitas tentativas. Aguarde até 15 minutos e tente novamente.");
        }
    }
}
