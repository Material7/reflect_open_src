package com.reflect.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Arrays;
import java.util.List;

@Configuration
public class CorsConfig {

    /**
     * 許可するオリジンのパターン（カンマ区切り）。
     *
     * <p>既定はローカル開発用の localhost のみ。フロントエンドを別ホストから配信する場合や
     * LAN 内の実機から開発サーバーへ接続する場合は、環境変数 CORS_ALLOWED_ORIGINS で
     * 明示的に指定する（例: {@code https://reflect.example.com,http://192.168.1.10:5173}）。
     *
     * <p>本番の標準構成ではフロントエンドの Nginx が同一オリジンで /api/ をプロキシするため、
     * CORS の追加設定は不要。
     */
    @Value("${cors.allowed-origins:https://localhost:*,http://localhost:*}")
    private String allowedOrigins;

    @Bean
    public CorsFilter corsFilter() {
        List<String> patterns = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();

        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(patterns);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of("Authorization"));
        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return new CorsFilter(source);
    }
}
