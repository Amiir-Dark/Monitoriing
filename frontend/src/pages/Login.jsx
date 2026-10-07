import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, ArrowRight, Server, Lock, User } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-center items-center p-4 selection:bg-brand-500 selection:text-white">
      {/* Background glow effects */}
      <div className="absolute top-1/4 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 w-96 h-96 bg-emerald-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600 text-white font-black text-2xl shadow-glow-brand mb-4">
            NW
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">NodeWatch</h1>
          <p className="text-sm text-dark-400 mt-1">
            Production-Ready Linux Server Monitoring Platform
          </p>
        </div>

        {/* Card */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-dark-300 mb-1.5">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-dark-500">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                  placeholder="admin"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-dark-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-dark-500">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-glow-brand disabled:opacity-50"
            >
              {loading ? (
                'Authenticating...'
              ) : (
                <>
                  Sign in to Dashboard <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Credential Badge */}
          <div className="mt-6 pt-5 border-t border-dark-800/80 text-center">
            <div className="inline-flex items-center gap-1.5 text-xs text-dark-400 font-mono bg-dark-950 px-3 py-1.5 rounded-lg border border-dark-800">
              <ShieldCheck size={14} className="text-emerald-400" />
              Default credentials: <span className="text-dark-200">admin</span> / <span className="text-dark-200">admin123</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-dark-500">
          Pure Go API • SQLite 3 WAL • Standalone Agent • Modern UI
        </div>
      </div>
    </div>
  );
}
