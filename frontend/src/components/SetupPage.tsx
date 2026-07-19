import React, { useState } from 'react';
import { Eye, EyeOff, CircleAlert } from 'lucide-react';
import { PankhaFanIcon } from './icons/PankhaFanIcon';
import { useAuth } from '../contexts/AuthContext';

/**
 * First-run screen: create the initial admin account (D1). Rendered while
 * no user accounts exist (fresh install, or after PANKHA_AUTH_RESET).
 */
const SetupPage: React.FC = () => {
  const { setupAdmin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    try {
      await setupAdmin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="system-card auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <PankhaFanIcon size={38} className="animate-fan-spin auth-brand-fan" />
          <div className="auth-brand-name">
            <strong>Pankha</strong>
            <span>Fan Control</span>
          </div>
        </div>

        <h2 className="auth-heading">Create your admin account</h2>
        <p className="auth-subtext">
          This Hub has no accounts yet. The first account gets full admin
          access - create it now to secure the dashboard.
        </p>

        {error && (
          <div className="auth-error">
            <CircleAlert size={15} /> {error}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="setup-username">Username</label>
          <input
            id="setup-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="admin"
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="setup-password">Password</label>
          <div className="password-wrap">
            <input
              id="setup-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
            />
            <button
              type="button"
              className="password-eye"
              title={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="setup-confirm">Confirm password</label>
          <input
            id="setup-confirm"
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        <button type="submit" className="btn-primary-tactical auth-submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create account'}
        </button>
      </form>
    </div>
  );
};

export default SetupPage;
