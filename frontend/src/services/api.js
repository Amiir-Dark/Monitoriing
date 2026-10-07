// Centralized API client for NodeWatch

const BASE_URL = import.meta.env.VITE_API_URL || '';

function getAuthHeader() {
  const token = localStorage.getItem('nodewatch_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // If not on login page, clear token and redirect
    if (!window.location.pathname.includes('/login')) {
      localStorage.removeItem('nodewatch_token');
      localStorage.removeItem('nodewatch_user');
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Unauthorized');
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP error ${response.status}`);
  }

  // Handle empty responses
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

// Auth API
export async function login(username, password) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) {
    localStorage.setItem('nodewatch_token', data.token);
    localStorage.setItem('nodewatch_user', JSON.stringify(data.user));
  }
  return data;
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    localStorage.removeItem('nodewatch_token');
    localStorage.removeItem('nodewatch_user');
  }
}

export async function getCurrentUser() {
  return request('/api/auth/me');
}

// Dashboard API
export async function getDashboardSummary() {
  return request('/api/dashboard');
}

// Nodes API
export async function getNodes(filters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.append('search', filters.search);
  if (filters.status) params.append('status', filters.status);
  if (filters.group) params.append('group', filters.group);
  if (filters.tag) params.append('tag', filters.tag);

  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/nodes${query}`);
}

export async function getNode(id) {
  return request(`/api/nodes/${id}`);
}

export async function createNode(data) {
  return request('/api/nodes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateNode(id, data) {
  return request(`/api/nodes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteNode(id) {
  return request(`/api/nodes/${id}`, {
    method: 'DELETE',
  });
}

export async function rotateNodeToken(id) {
  return request(`/api/nodes/${id}/token/rotate`, {
    method: 'POST',
  });
}

export async function disableNode(id) {
  return request(`/api/nodes/${id}/disable`, {
    method: 'POST',
  });
}

export async function enableNode(id) {
  return request(`/api/nodes/${id}/enable`, {
    method: 'POST',
  });
}

// Metrics, Processes, Network, Services, Docker, Logs & Alerts
export async function getNodeMetrics(id, type = 'cpu', window = '1h') {
  return request(`/api/nodes/${id}/metrics?type=${encodeURIComponent(type)}&window=${encodeURIComponent(window)}`);
}

export async function getNodeProcesses(id) {
  return request(`/api/nodes/${id}/processes`);
}

export async function getNodeNetwork(id) {
  return request(`/api/nodes/${id}/network`);
}

export async function getNodeServices(id) {
  return request(`/api/nodes/${id}/services`);
}

export async function getNodeDocker(id) {
  return request(`/api/nodes/${id}/docker`);
}

export async function getNodeLogs(id, limit = 100) {
  return request(`/api/nodes/${id}/logs?limit=${limit}`);
}

export async function getNodeAlerts(id) {
  return request(`/api/nodes/${id}/alerts`);
}

// Alerts API
export async function getAlerts(status = '', limit = 50) {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (limit) params.append('limit', limit);
  return request(`/api/alerts?${params.toString()}`);
}

export async function acknowledgeAlert(id) {
  return request(`/api/alerts/${id}/acknowledge`, {
    method: 'POST',
  });
}

export async function resolveAlert(id) {
  return request(`/api/alerts/${id}/resolve`, {
    method: 'POST',
  });
}

export async function getAlertRules() {
  return request('/api/alerts/rules');
}

export async function saveAlertRule(rule) {
  return request('/api/alerts/rules', {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

export async function deleteAlertRule(id) {
  return request(`/api/alerts/rules/${id}`, {
    method: 'DELETE',
  });
}

// Groups API
export async function getGroups() {
  return request('/api/groups');
}

export async function createGroup(data) {
  return request('/api/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateGroup(id, data) {
  return request(`/api/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(id) {
  return request(`/api/groups/${id}`, {
    method: 'DELETE',
  });
}

// Settings & Backup API
export async function getTelegramSettings() {
  return request('/api/settings/telegram');
}

export async function saveTelegramSettings(data) {
  return request('/api/settings/telegram', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function testTelegram(data) {
  return request('/api/settings/telegram/test', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getRetentionSettings() {
  return request('/api/settings/retention');
}

export async function saveRetentionSettings(data) {
  return request('/api/settings/retention', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function triggerBackup() {
  return request('/api/backup', {
    method: 'POST',
  });
}
