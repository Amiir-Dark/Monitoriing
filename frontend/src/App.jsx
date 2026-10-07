import { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import DashboardLayout from './layouts/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Nodes from './pages/Nodes';
import NodeDetail from './pages/NodeDetail';
import Alerts from './pages/Alerts';
import Groups from './pages/Groups';
import Settings from './pages/Settings';
import { getAlerts } from './services/api';
import { wsService } from './services/ws';

function MainApp() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    // Load active alerts count
    const updateCount = () => {
      getAlerts('triggered', 100)
        .then((alerts) => {
          setActiveAlertsCount(alerts?.length || 0);
        })
        .catch(() => {});
    };

    updateCount();

    const unsubAlert = wsService.subscribe('alert_triggered', updateCount);
    const unsubResolved = wsService.subscribe('alert_resolved', updateCount);

    return () => {
      unsubAlert();
      unsubResolved();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const handleSelectNode = (nodeId) => {
    setSelectedNodeId(nodeId);
    setActiveTab('node-detail');
  };

  const handleBackToNodes = () => {
    setSelectedNodeId(null);
    setActiveTab('nodes');
  };

  return (
    <DashboardLayout
      activeTab={activeTab === 'node-detail' ? 'nodes' : activeTab}
      onTabChange={(tab) => {
        setSelectedNodeId(null);
        setActiveTab(tab);
      }}
      alertsCount={activeAlertsCount}
    >
      {activeTab === 'dashboard' && (
        <Dashboard
          onNavigateToNode={handleSelectNode}
          onNavigateToAlerts={() => setActiveTab('alerts')}
        />
      )}

      {activeTab === 'nodes' && (
        <Nodes onSelectNode={handleSelectNode} />
      )}

      {activeTab === 'node-detail' && selectedNodeId && (
        <NodeDetail nodeId={selectedNodeId} onBack={handleBackToNodes} />
      )}

      {activeTab === 'alerts' && <Alerts />}

      {activeTab === 'groups' && (
        <Groups onSelectGroup={() => setActiveTab('nodes')} />
      )}

      {activeTab === 'settings' && <Settings />}
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}
