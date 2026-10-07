package nodes

import (
	"os"
	"path/filepath"
	"testing"


	"nodewatch/backend/internal/database"
)

func setupTestDB(t *testing.T) (*database.DB, func()) {
	tmpDir, err := os.MkdirTemp("", "nodewatch_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dbPath := filepath.Join(tmpDir, "test.db")
	db, err := database.Open(dbPath)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	cleanup := func() {
		db.Close()
		os.RemoveAll(tmpDir)
	}

	return db, cleanup
}

func TestNodeLifecycleAndTokenValidation(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewRepository(db)

	// 1. Create Node
	node, rawToken, err := repo.CreateNode("Germany-01", nil, []string{"prod", "vpn"})
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	if node.Name != "Germany-01" {
		t.Errorf("expected node name 'Germany-01', got %s", node.Name)
	}
	if len(node.Tags) != 2 {
		t.Errorf("expected 2 tags, got %d", len(node.Tags))
	}

	// 2. Validate Token
	nodeID, err := repo.ValidateAgentToken(rawToken)
	if err != nil {
		t.Fatalf("expected valid token: %v", err)
	}
	if nodeID != node.ID {
		t.Errorf("expected node id %s, got %s", node.ID, nodeID)
	}

	// 3. Test Invalid Token
	_, err = repo.ValidateAgentToken("invalid-token")
	if err == nil {
		t.Errorf("expected error with invalid token")
	}

	// 4. Rotate Token
	newToken, err := repo.RotateToken(node.ID)
	if err != nil {
		t.Fatalf("failed to rotate token: %v", err)
	}

	// Old token should now fail
	_, err = repo.ValidateAgentToken(rawToken)
	if err == nil {
		t.Errorf("expected old token to be revoked")
	}

	// New token should succeed
	nodeID2, err := repo.ValidateAgentToken(newToken)
	if err != nil || nodeID2 != node.ID {
		t.Errorf("expected new token to be valid: %v", err)
	}

	// 5. Check Offline Nodes
	offlineNodes, err := repo.CheckOfflineNodes(0)
	if err != nil {
		t.Fatalf("failed to check offline: %v", err)
	}
	if len(offlineNodes) == 0 {
		t.Errorf("expected node without heartbeats to be offline")
	}

	// 6. Update seen
	err = repo.UpdateNodeSeen(node.ID)
	if err != nil {
		t.Fatalf("failed to update seen: %v", err)
	}

	fetched, err := repo.GetNode(node.ID)
	if err != nil {
		t.Fatalf("failed to get node: %v", err)
	}
	if fetched.Status != "online" {
		t.Errorf("expected node status 'online', got %s", fetched.Status)
	}

	// 7. Delete Node
	err = repo.DeleteNode(node.ID)
	if err != nil {
		t.Fatalf("failed to delete node: %v", err)
	}

	_, err = repo.GetNode(node.ID)
	if err == nil {
		t.Errorf("expected error fetching deleted node")
	}
}

func TestNodeListingAndFiltering(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewRepository(db)

	_, _, _ = repo.CreateNode("Web-Server-01", nil, []string{"web", "prod"})
	_, _, _ = repo.CreateNode("DB-Server-01", nil, []string{"db", "prod"})
	_, _, _ = repo.CreateNode("Test-Server", nil, []string{"staging"})

	// Search
	results, err := repo.ListNodes("DB", "", "", "")
	if err != nil || len(results) != 1 {
		t.Fatalf("expected 1 result for 'DB', got %d", len(results))
	}

	// Filter by tag
	prodNodes, err := repo.ListNodes("", "", "", "prod")
	if err != nil || len(prodNodes) != 2 {
		t.Fatalf("expected 2 prod nodes, got %d", len(prodNodes))
	}
}
