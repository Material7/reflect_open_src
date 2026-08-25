package com.reflect.backend.controller;

import com.reflect.backend.dto.request.ChangePasswordRequest;
import com.reflect.backend.dto.request.LoginRequest;
import com.reflect.backend.dto.request.UpdateVcsCredentialsRequest;
import com.reflect.backend.dto.response.LoginResponse;
import com.reflect.backend.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout() {
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public ResponseEntity<LoginResponse> me(@AuthenticationPrincipal String employeeNumber) {
        return ResponseEntity.ok(authService.me(employeeNumber));
    }

    @PostMapping("/change-password")
    public ResponseEntity<Void> changePassword(
            @AuthenticationPrincipal String employeeNumber,
            @Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(employeeNumber, request.getCurrentPassword(), request.getNewPassword());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/me/credentials")
    public ResponseEntity<Void> updateVcsCredentials(
            @AuthenticationPrincipal String employeeNumber,
            @RequestBody UpdateVcsCredentialsRequest request) {
        authService.updateVcsCredentials(employeeNumber, request);
        return ResponseEntity.noContent().build();
    }
}
