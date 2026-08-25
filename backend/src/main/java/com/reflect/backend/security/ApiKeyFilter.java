package com.reflect.backend.security;

import com.reflect.backend.entity.Member;
import com.reflect.backend.service.ApiKeyService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * X-API-Key ヘッダーによる認証フィルター。
 * JWT フィルターより先に評価し、ヘッダーが存在しない場合はスキップする。
 */
@Slf4j
@Component
public class ApiKeyFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-API-Key";
    public static final String QUERY_PARAM = "apiKey";

    private final ApiKeyService apiKeyService;

    @Autowired
    public ApiKeyFilter(@Lazy ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain) throws ServletException, IOException {

        // ヘッダー優先。無ければクエリパラメータ ?apiKey=<key> をフォールバックで参照
        // （アクセスログ等に残るため簡易確認・社内ツール・Webhook 用途を想定）
        String apiKey = request.getHeader(HEADER_NAME);
        if (apiKey == null || apiKey.isBlank()) {
            apiKey = request.getParameter(QUERY_PARAM);
        }

        if (apiKey != null && !apiKey.isBlank()) {
            apiKeyService.authenticate(apiKey).ifPresentOrElse(
                member -> setAuthentication(member),
                () -> {
                    // 不正なキーは即 401
                    try {
                        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                        response.setContentType("application/json");
                        response.getWriter().write("{\"error\":\"無効なAPIキーです\"}");
                    } catch (IOException ex) {
                        log.warn("401 レスポンスの書き込みに失敗しました", ex);
                    }
                }
            );

            if (response.isCommitted()) return; // 401 を返した場合はここで終了
        }

        filterChain.doFilter(request, response);
    }

    private void setAuthentication(Member member) {
        var auth = new UsernamePasswordAuthenticationToken(
                member.getEmployeeNumber(),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_" + member.getRole()))
        );
        SecurityContextHolder.getContext().setAuthentication(auth);
    }
}
