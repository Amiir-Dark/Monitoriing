package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidToken = errors.New("invalid or expired token")
	ErrUnauthorized = errors.New("unauthorized")
)

type Claims struct {
	UserID   string `json:"uid"`
	Username string `json:"sub"`
	Role     string `json:"role"`
	Exp      int64  `json:"exp"`
}

type AuthManager struct {
	jwtSecret []byte
}

func NewAuthManager(secret string) *AuthManager {
	if secret == "" {
		// Default secure random fallback if not specified
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		secret = hex.EncodeToString(b)
	}
	return &AuthManager{jwtSecret: []byte(secret)}
}

// HashPassword hashes a plain text password using bcrypt.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword compares a plaintext password with its bcrypt hash.
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// GenerateNodeToken creates a cryptographically secure random token and its SHA256 hash.
func GenerateNodeToken() (rawToken string, tokenHash string, err error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	rawToken = "nw_" + hex.EncodeToString(bytes)
	tokenHash = HashToken(rawToken)
	return rawToken, tokenHash, nil
}

// HashToken produces a SHA256 hex digest of a node token.
func HashToken(rawToken string) string {
	h := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(h[:])
}

// SignJWT creates a compact signed JWT token for user dashboard authentication.
func (a *AuthManager) SignJWT(userID, username, role string, duration time.Duration) (string, error) {
	headerJSON := `{"alg":"HS256","typ":"JWT"}`
	headerB64 := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))

	claims := Claims{
		UserID:   userID,
		Username: username,
		Role:     role,
		Exp:      time.Now().Add(duration).Unix(),
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)

	payloadToSign := headerB64 + "." + claimsB64
	mac := hmac.New(sha256.New, a.jwtSecret)
	mac.Write([]byte(payloadToSign))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return payloadToSign + "." + sigB64, nil
}

// VerifyJWT parses and verifies a signed JWT token.
func (a *AuthManager) VerifyJWT(tokenString string) (*Claims, error) {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}

	payloadToSign := parts[0] + "." + parts[1]
	expectedSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, ErrInvalidToken
	}

	mac := hmac.New(sha256.New, a.jwtSecret)
	mac.Write([]byte(payloadToSign))
	calculatedSig := mac.Sum(nil)

	if !hmac.Equal(expectedSig, calculatedSig) {
		return nil, ErrInvalidToken
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}

	var claims Claims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, ErrInvalidToken
	}

	if claims.Exp < time.Now().Unix() {
		return nil, fmt.Errorf("token expired")
	}

	return &claims, nil
}

// ExtractBearerToken reads the bearer token from the Authorization header or cookie.
func ExtractBearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			return strings.TrimSpace(parts[1])
		}
		return strings.TrimSpace(authHeader)
	}

	// Also check query param for WebSockets (browser WS can't send headers easily)
	if q := r.URL.Query().Get("token"); q != "" {
		return q
	}

	// Fallback to cookie
	if cookie, err := r.Cookie("nodewatch_token"); err == nil && cookie.Value != "" {
		return cookie.Value
	}

	return ""
}

// ExtractAgentToken reads the node token from X-Node-Token or Authorization.
func ExtractAgentToken(r *http.Request) string {
	if token := r.Header.Get("X-Node-Token"); token != "" {
		return strings.TrimSpace(token)
	}
	return ExtractBearerToken(r)
}
