package telegram

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"nodewatch/backend/internal/database"
	"nodewatch/backend/internal/models"
)

type Client struct {
	db         *database.DB
	httpClient *http.Client
	mu         sync.Mutex
	cooldowns  map[string]time.Time
}

func NewClient(db *database.DB) *Client {
	return &Client{
		db: db,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		cooldowns: make(map[string]time.Time),
	}
}

// GetConfig returns the stored Telegram integration configuration.
func (c *Client) GetConfig() (*models.TelegramIntegration, error) {
	row := c.db.QueryRow("SELECT id, bot_token, chat_id, enabled, created_at, updated_at FROM telegram_integrations LIMIT 1")
	var t models.TelegramIntegration
	var enabledInt int
	var createdAt, updatedAt int64

	err := row.Scan(&t.ID, &t.BotToken, &t.ChatID, &enabledInt, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	t.Enabled = enabledInt == 1
	t.CreatedAt = time.Unix(createdAt, 0)
	t.UpdatedAt = time.Unix(updatedAt, 0)
	return &t, nil
}

// SaveConfig updates or creates Telegram integration settings.
func (c *Client) SaveConfig(botToken, chatID string, enabled bool) error {
	now := time.Now().Unix()
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	_, err := c.db.Exec(`
		INSERT INTO telegram_integrations (id, bot_token, chat_id, enabled, created_at, updated_at)
		VALUES ('default', ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		  bot_token = excluded.bot_token,
		  chat_id = excluded.chat_id,
		  enabled = excluded.enabled,
		  updated_at = excluded.updated_at
	`, botToken, chatID, enabledInt, now, now)
	return err
}

// SendMessage sends an arbitrary message via Telegram bot API if configured and enabled.
func (c *Client) SendMessage(message string) error {
	cfg, err := c.GetConfig()
	if err != nil || !cfg.Enabled || cfg.BotToken == "" || cfg.ChatID == "" {
		return nil // Not enabled or configured, skip silently
	}

	return c.sendDirect(cfg.BotToken, cfg.ChatID, message)
}

// TestNotification sends a test message to verify Telegram credentials.
func (c *Client) TestNotification(botToken, chatID string) error {
	msg := "🟢 *NodeWatch Test Notification*\n\nYour Telegram integration is configured correctly!"
	return c.sendDirect(botToken, chatID, msg)
}

func (c *Client) sendDirect(botToken, chatID, text string) error {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)

	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Post(apiURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("telegram post failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram api error (%d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// SendAlertNotification sends formatted alert notifications with cooldown.
func (c *Client) SendAlertNotification(key string, text string, cooldown time.Duration) {
	c.mu.Lock()
	lastSent, exists := c.cooldowns[key]
	if exists && time.Since(lastSent) < cooldown {
		c.mu.Unlock()
		return
	}
	c.cooldowns[key] = time.Now()
	c.mu.Unlock()

	go func() {
		_ = c.SendMessage(text)
	}()
}
