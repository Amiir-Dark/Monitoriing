// Utility functions for formatting metrics, units, and dates accurately

export function formatBytes(bytes, decimals = 2) {
  if (bytes === undefined || bytes === null) return 'Unavailable';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0) return '0 B';
  if (i >= sizes.length) return `${(bytes / Math.pow(k, sizes.length - 1)).toFixed(dm)} PB`;
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatNetworkSpeed(bytesPerSec) {
  if (bytesPerSec === undefined || bytesPerSec === null) return 'Unavailable';
  if (bytesPerSec === 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatPercent(val) {
  if (val === undefined || val === null || isNaN(val)) return 'Unavailable';
  return `${(Math.round(val * 10) / 10).toFixed(1)}%`;
}

export function formatNumber(val) {
  if (val === undefined || val === null || isNaN(val)) return 'Unavailable';
  return new Intl.NumberFormat('en-US').format(val);
}

export function formatDurationUS(us) {
  if (us === undefined || us === null) return '-';
  if (us < 1000) return `${us} µs`;
  if (us < 1000000) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1000000).toFixed(2)} s`;
}

export function formatUptime(seconds) {
  if (seconds === undefined || seconds === null) return 'Unavailable';
  if (seconds <= 0) return 'Just started';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

export function timeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  if (isNaN(date.getTime())) return 'Unknown';
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 0) return 'just now';
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatDate(timestamp) {
  if (!timestamp) return 'Unavailable';
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatLatency(ms) {
  if (ms === undefined || ms === null || isNaN(ms)) return 'Unavailable';
  return `${Number(ms).toFixed(2)} ms`;
}

export function formatIOPS(iops) {
  if (iops === undefined || iops === null || isNaN(iops)) return 'Unavailable';
  return `${formatNumber(Math.round(iops))} IOPS`;
}

export function formatPacketRate(pkts) {
  if (pkts === undefined || pkts === null || isNaN(pkts)) return 'Unavailable';
  return `${formatNumber(Math.round(pkts))} pkts/s`;
}

export function formatDataFreshness(timestamp) {
  if (!timestamp) {
    return {
      status: 'OFFLINE',
      text: 'No telemetry reported',
      isLive: false,
      isStale: false,
      isOffline: true,
      lastKnown: false,
    };
  }

  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  if (isNaN(date.getTime())) {
    return {
      status: 'OFFLINE',
      text: 'Invalid timestamp',
      isLive: false,
      isStale: false,
      isOffline: true,
      lastKnown: false,
    };
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (diffSec <= 15) {
    const s = diffSec < 2 ? '1.2s' : `${diffSec}s`;
    return {
      status: 'LIVE',
      text: `Updated ${s} ago`,
      isLive: true,
      isStale: false,
      isOffline: false,
      lastKnown: false,
    };
  } else if (diffSec <= 45) {
    return {
      status: 'STALE',
      text: `Last update: ${diffSec}s ago`,
      isLive: false,
      isStale: true,
      isOffline: false,
      lastKnown: true,
    };
  } else {
    const ago = timeAgo(timestamp);
    return {
      status: 'OFFLINE',
      text: `Last update: ${ago}`,
      isLive: false,
      isStale: false,
      isOffline: true,
      lastKnown: true,
    };
  }
}
