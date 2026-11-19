package br.com.controle;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class RegistrationPolicy {
    private record Invite(String code, String rateBucket) {}
    private final Map<String, Invite> invites;

    RegistrationPolicy(@Value("${ponto.registration.invite-only:false}") boolean inviteOnly,
                       @Value("${PONTO_INVITE_EMAIL_1:}") String firstEmail,
                       @Value("${PONTO_INVITE_CODE_1:}") String firstCode,
                       @Value("${PONTO_INVITE_EMAIL_2:}") String secondEmail,
                       @Value("${PONTO_INVITE_CODE_2:}") String secondCode) {
        if (!inviteOnly) {
            invites = Map.of();
            return;
        }
        String first = email(firstEmail);
        if (!validCode(firstCode)) {
            throw new IllegalStateException("Configure um código válido para o primeiro convite.");
        }
        Invite firstInvite = new Invite(firstCode.toLowerCase(Locale.ROOT), "invited-1");
        if (secondEmail.isBlank() && secondCode.isBlank()) {
            invites = Map.of(first, firstInvite);
            return;
        }
        String second = email(secondEmail);
        if (first.equals(second) || !validCode(secondCode)
            || firstCode.equalsIgnoreCase(secondCode)) {
            throw new IllegalStateException("Configure dois convites diferentes para o cadastro privado.");
        }
        invites = Map.of(first, firstInvite,
            second, new Invite(secondCode.toLowerCase(Locale.ROOT), "invited-2"));
    }

    boolean inviteOnly() {
        return !invites.isEmpty();
    }

    void check(String identifier, String submitted) {
        if (!inviteOnly()) return;
        Invite expected = invites.get(identifier);
        if (expected == null || !validCode(submitted) || !MessageDigest.isEqual(
            expected.code().getBytes(StandardCharsets.US_ASCII),
            submitted.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "E-mail ou código de convite inválido.");
        }
    }

    String loginBucket(String identifier, String clientAddress) {
        if (!inviteOnly()) return clientAddress;
        Invite invite = invites.get(identifier);
        return invite == null ? "uninvited" : invite.rateBucket();
    }

    boolean allowsLogin(String identifier) {
        return !inviteOnly() || invites.containsKey(identifier);
    }

    private static String email(String raw) {
        String email = raw.strip().toLowerCase(Locale.ROOT);
        if (email.length() > 254 || !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) {
            throw new IllegalStateException("Configure um e-mail válido para cada convite.");
        }
        return email;
    }

    private static boolean validCode(String code) {
        return code != null && code.matches("[0-9a-fA-F]{64}");
    }
}
