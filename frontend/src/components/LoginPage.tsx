import React, { useState } from 'react';
import { Eye, EyeOff, CircleAlert } from 'lucide-react';
import { PankhaFanIcon } from './icons/PankhaFanIcon';
import { useAuth } from '../contexts/AuthContext';

/**
 * Sign-in screen, with an optional create-account mode when the admin has
 * enabled self-registration (D15). Shown whenever no session exists.
 */
const LoginPage: React.FC = () => {
  const { login, registerAccount, registrationEnabled } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await registerAccount(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirm('');
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

        {mode === 'register' && (
          <>
            <h2 className="auth-heading">Create your account</h2>
            <p className="auth-subtext">
              Pick a username and password to access this Hub.
            </p>
          </>
        )}

        {error && (
          <div className="auth-error">
            <CircleAlert size={15} /> {error}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="auth-username">Username</label>
          <input
            id="auth-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="auth-password">Password</label>
          <div className="password-wrap">
            <input
              id="auth-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? 'At least 8 characters' : undefined}
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

        {mode === 'register' && (
          <div className="form-group">
            <label htmlFor="auth-confirm">Confirm password</label>
            <input
              id="auth-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
        )}

        <button type="submit" className="control-button auth-submit" disabled={busy}>
          {mode === 'login' ? (busy ? 'Signing in...' : 'Sign in') : busy ? 'Creating...' : 'Create account'}
        </button>

        {registrationEnabled && mode === 'login' && (
          <div className="auth-alt">
            New here? <a onClick={() => switchMode('register')}>Create an account</a>
          </div>
        )}
        {mode === 'register' && (
          <div className="auth-alt">
            Already have an account? <a onClick={() => switchMode('login')}>Sign in</a>
          </div>
        )}
      </form>
    </div>
  );
};

export default LoginPage;
