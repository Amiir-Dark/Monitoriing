# NodeWatch Security Architecture

Security is a foundational tenet in the design of NodeWatch.

---

## 1. Authentication & Token Hashing

- **User Passwords**: Passwords are never stored in plaintext. They are hashed using `bcrypt` with cost 10.
- **Node Agent Tokens**:
  - Generated using 32 cryptographically secure random bytes (`crypto/rand`).
  - The raw token is returned **only once** upon generation.
  - The server stores only the `SHA-256` digest in the `node_tokens` table.
  - Even in the event of an unauthorized database read, raw agent tokens cannot be reconstructed.
- **Token Rotation & Revocation**:
  - Administrators can revoke or rotate node tokens instantly with one click from the dashboard.
  - Disabled nodes are blocked immediately from metric ingestion.

---

## 2. API & Injection Protection

- **Parameterized Queries**: All SQLite database interactions utilize prepared statements and parameterized inputs. User inputs are never concatenated into SQL strings.
- **Foreign Key Enforcement**: `PRAGMA foreign_keys=ON;` enforces referential integrity on cascade deletions.
- **Input Validation & Bound Checking**: All incoming JSON payloads are unmarshaled into strictly typed Go structs.
- **Audit Logging**: Sensitive administrative actions (login, node deletion, token rotation) are logged into the `audit_logs` table with client IP addresses.

---

## 3. Network & System Security

- **Strict CORS & Headers**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
- **Minimal Privilege Principle**:
  - The agent binary requires no root shell command execution and can read system metrics through standard virtual files.
  - Systemd sandboxing directives (`ProtectSystem=full`, `ProtectHome=true`, `NoNewPrivileges=true`) are pre-configured in the unit files.
