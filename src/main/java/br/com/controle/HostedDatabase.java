package br.com.controle;

import java.net.URI;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@Profile("hosted")
class HostedDatabase {
    HostedDatabase(@Value("${spring.datasource.url}") String jdbc,
                   @Value("${spring.datasource.username}") String username,
                   @Value("${spring.datasource.password}") String password,
                   @Value("${spring.sql.init.mode}") String schemaInitialization,
                   @Value("${server.servlet.session.cookie.secure}") boolean secureCookie,
                   RegistrationPolicy registration, JdbcTemplate db) {
        if (!safeUrl(jdbc) || !"ponto_app".equals(username) || password.isBlank()
            || !"never".equals(schemaInitialization) || !secureCookie || !registration.inviteOnly()) {
            throw new IllegalStateException("Na hospedagem use PostgreSQL com TLS verificado, conta ponto_app, "
                + "cadastro por convite, cookie seguro e esquema provisionado separadamente.");
        }
        Boolean limited = db.queryForObject("""
            select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
                and not has_schema_privilege(current_user, 'public', 'CREATE')
                and not has_table_privilege(current_user, 'profiles', 'DELETE')
                and not has_column_privilege(current_user, 'profiles', 'password_hash', 'UPDATE')
            from pg_roles where rolname=current_user
            """, Boolean.class);
        if (!Boolean.TRUE.equals(limited)) {
            throw new IllegalStateException("O papel PostgreSQL do Ponto tem privilégios acima do necessário.");
        }
    }

    private static boolean safeUrl(String jdbc) {
        if (!jdbc.startsWith("jdbc:postgresql://")) return false;
        try {
            URI url = URI.create(jdbc.substring(5));
            if (url.getHost() == null || url.getUserInfo() != null || url.getFragment() != null
                || url.getPath() == null || url.getPath().length() <= 1 || url.getRawQuery() == null) return false;
            Set<String> options = Set.of(url.getRawQuery().split("&", -1));
            return options.equals(Set.of("sslmode=verify-full", "sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory"));
        } catch (IllegalArgumentException error) {
            return false;
        }
    }
}
