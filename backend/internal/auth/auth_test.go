package auth

import (
	"testing"
	"time"
)

func TestPasswordHashing(t *testing.T) {
	password := "my-secure-password"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("unexpected error hashing: %v", err)
	}

	if !CheckPassword(password, hash) {
		t.Errorf("expected password to match hash")
	}

	if CheckPassword("wrong-password", hash) {
		t.Errorf("expected wrong password to fail")
	}
}

func TestNodeTokenGeneration(t *testing.T) {
	raw, hash, err := GenerateNodeToken()
	if err != nil {
		t.Fatalf("unexpected error generating token: %v", err)
	}

	if len(raw) < 10 {
		t.Errorf("raw token too short: %s", raw)
	}

	expectedHash := HashToken(raw)
	if hash != expectedHash {
		t.Errorf("hash mismatch: got %s, want %s", hash, expectedHash)
	}
}

func TestJWTTokenSigningAndVerification(t *testing.T) {
	mgr := NewAuthManager("test-secret-32-chars-long-12345678")

	token, err := mgr.SignJWT("user-1", "admin", "admin", 1*time.Hour)
	if err != nil {
		t.Fatalf("unexpected error signing JWT: %v", err)
	}

	claims, err := mgr.VerifyJWT(token)
	if err != nil {
		t.Fatalf("unexpected error verifying JWT: %v", err)
	}

	if claims.UserID != "user-1" || claims.Username != "admin" {
		t.Errorf("unexpected claims: %+v", claims)
	}

	// Test expired token
	expiredToken, _ := mgr.SignJWT("user-2", "expired", "admin", -1*time.Minute)
	_, err = mgr.VerifyJWT(expiredToken)
	if err == nil {
		t.Errorf("expected error for expired token")
	}

	// Test tampered token
	_, err = mgr.VerifyJWT(token + "tampered")
	if err == nil {
		t.Errorf("expected error for tampered token")
	}
}
