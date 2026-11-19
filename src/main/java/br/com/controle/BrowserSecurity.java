package br.com.controle;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class BrowserSecurity extends OncePerRequestFilter {
    private static final String POLICY = "default-src 'self'; script-src 'self'; "
        + "style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
        + "img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    private final boolean hosted;

    BrowserSecurity(Environment environment) {
        hosted = environment.acceptsProfiles(Profiles.of("hosted"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        response.setHeader("Content-Security-Policy", POLICY);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        if (hosted) {
            response.setHeader("Strict-Transport-Security", "max-age=31536000");
            response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        }
        if (request.getServletPath().startsWith("/api/")) {
            response.setHeader("Cache-Control", "no-store");
        }
        chain.doFilter(request, response);
    }
}
