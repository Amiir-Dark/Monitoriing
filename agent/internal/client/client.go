package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"nodewatch/agent/internal/collectors"
	"nodewatch/agent/internal/system"
)

type Client struct {
	serverURL  string
	nodeToken  string
	httpClient *http.Client

	mu               sync.Mutex
	isServerDown     bool
	consecutiveFails int
}

func NewClient(serverURL, nodeToken string) *Client {
	return &Client{
		serverURL: serverURL,
		nodeToken: nodeToken,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Register sends system information on agent startup.
func (c *Client) Register(info *system.SystemInfo) error {
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/api/agent/register", c.serverURL)
	return c.postWithRetry(url, data)
}

// SendHeartbeat sends a periodic heartbeat.
func (c *Client) SendHeartbeat() error {
	url := fmt.Sprintf("%s/api/agent/heartbeat", c.serverURL)
	return c.postWithRetry(url, []byte("{}"))
}

// SendMetrics posts the batch collected metrics payload.
func (c *Client) SendMetrics(p *collectors.Payload) error {
	p.Timestamp = time.Now().Unix()
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/api/agent/metrics", c.serverURL)
	return c.postWithRetry(url, data)
}

func (c *Client) postWithRetry(url string, body []byte) error {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(body))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Node-Token", c.nodeToken)

	resp, err := c.httpClient.Do(req)
	c.mu.Lock()
	defer c.mu.Unlock()

	if err != nil {
		c.consecutiveFails++
		if !c.isServerDown {
			log.Printf("[WARN] Monitoring server unavailable: %v", err)
			c.isServerDown = true
		}
		c.applyBackoff()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		log.Printf("[ERROR] NodeWatch agent authentication failed: invalid or revoked token")
		return fmt.Errorf("authentication failed: 401 Unauthorized")
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		c.consecutiveFails++
		return fmt.Errorf("server returned error %d: %s", resp.StatusCode, string(respBody))
	}

	// Success
	if c.isServerDown {
		log.Printf("[INFO] Connection to monitoring server restored.")
		c.isServerDown = false
		c.consecutiveFails = 0
	}

	return nil
}

func (c *Client) applyBackoff() {
	if c.consecutiveFails > 1 {
		// Exponential backoff with jitter: min 1s, max 15s
		backoff := time.Duration(1<<min(c.consecutiveFails, 4)) * time.Second
		jitter := time.Duration(rand.Intn(1000)) * time.Millisecond
		time.Sleep(backoff + jitter)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
