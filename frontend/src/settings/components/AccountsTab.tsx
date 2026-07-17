import React, { useCallback, useEffect, useState } from 'react';
import { User, KeyRound, Trash2, Plus } from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { useAuth } from '../../contexts/AuthContext';
import * as authApi from '../../services/authApi';
import type { RegistrationSettings, Role, UserRow } from '../../services/authApi';
import { toast } from '../../utils/toast';

// Accounts tab (task_02 auth, design per approved hub-auth slice):
// "Your account" for every rank; user management + self-registration
// settings render for admins only.

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'operator', label: 'Operator' },
  { value: 'viewer', label: 'Viewer' },
];

const ENABLED_OPTIONS = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const MIN_PASSWORD_LENGTH = 8;

const AccountsTab: React.FC = () => {
  const { username, role, can } = useAuth();

  // Your account - change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  // Users (admin)
  const [users, setUsers] = useState<UserRow[]>([]);
  const [registration, setRegistration] = useState<RegistrationSettings | null>(null);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>('viewer');

  const isAdmin = can('admin');
  const adminCount = users.filter((u) => u.role === 'admin').length;

  const reloadUsers = useCallback(async () => {
    try {
      setUsers(await authApi.listUsers());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    reloadUsers();
    authApi
      .getRegistrationSettings()
      .then(setRegistration)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load settings'));
  }, [isAdmin, reloadUsers]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setPwBusy(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setPwBusy(false);
    }
  };

  const handleRoleChange = async (user: UserRow, nextRole: Role) => {
    if (nextRole === user.role) return;
    try {
      await authApi.updateUser(user.id, { role: nextRole });
      toast.success(`${user.username} is now ${nextRole}`);
      await reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Role change failed');
    }
  };

  const handleResetPassword = async (user: UserRow) => {
    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    try {
      await authApi.updateUser(user.id, { password: resetPassword });
      toast.success(`Password reset for ${user.username}`);
      setResetUserId(null);
      setResetPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Password reset failed');
    }
  };

  const handleDeleteUser = async (user: UserRow) => {
    if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    try {
      await authApi.deleteUser(user.id);
      toast.success(`${user.username} deleted`);
      await reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deletion failed');
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await authApi.createUser(newUsername, newUserPassword, newUserRole);
      toast.success(`${newUsername} added as ${newUserRole}`);
      setShowAddForm(false);
      setNewUsername('');
      setNewUserPassword('');
      setNewUserRole('viewer');
      await reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add user');
    }
  };

  const handleRegistrationChange = async (changes: Partial<RegistrationSettings>) => {
    try {
      setRegistration(await authApi.updateRegistrationSettings(changes));
      toast.success('Registration settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  return (
    <div className="settings-section">
      <h3 style={{ marginTop: 0 }}>Your account</h3>
      <div className="signed-in-row">
        <User size={16} /> Signed in as <strong>{username}</strong>{' '}
        <span className="role-chip">{role}</span>
      </div>
      <form onSubmit={handleChangePassword}>
        <div className="pw-grid">
          <div className="form-group full">
            <label htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="pw-new">New password</label>
            <input
              id="pw-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="pw-confirm">Confirm new password</label>
            <input
              id="pw-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
        </div>
        <button type="submit" className="control-button pw-save" disabled={pwBusy}>
          {pwBusy ? 'Updating...' : 'Update password'}
        </button>
      </form>

      {isAdmin && (
        <>
          <h3>Users</h3>

          <div className="registration-settings">
            <div className="setting-item">
              <div className="setting-info-wrapper">
                <span className="setting-label">Account creation from the sign-in screen</span>
                <span className="setting-description">
                  Let anyone who can reach this Hub create their own account. Off by default.
                </span>
              </div>
              <Select
                value={registration ? (registration.enabled ? 'enabled' : 'disabled') : null}
                options={ENABLED_OPTIONS}
                onChange={(v) => handleRegistrationChange({ enabled: v === 'enabled' })}
                ariaLabel="Account creation from the sign-in screen"
                width={110}
              />
            </div>
            <div className="setting-item">
              <div className="setting-info-wrapper">
                <span className="setting-label">New accounts start as</span>
                <span className="setting-description">
                  Role given to self-created accounts. An admin can promote them later.
                </span>
              </div>
              <Select
                value={registration?.default_role ?? null}
                options={ROLE_OPTIONS}
                onChange={(v) => handleRegistrationChange({ default_role: v })}
                ariaLabel="Default role for new accounts"
                width={110}
              />
            </div>
          </div>

          <p className="role-hint">
            <span>
              <b>Admin</b> - everything, including users and settings
            </span>
            <span>
              <b>Operator</b> - controls fans and profiles
            </span>
            <span>
              <b>Viewer</b> - read-only dashboard
            </span>
          </p>

          <div className="user-rows">
            {users.map((user) => {
              const isSelf = user.username === username;
              const lastAdmin = user.role === 'admin' && adminCount <= 1;
              return (
                <React.Fragment key={user.id}>
                  <div className="user-row">
                    <span className="u-name">
                      <User size={15} /> {user.username}
                      {isSelf && <span className="u-you">(you)</span>}
                    </span>
                    <Select
                      value={user.role}
                      options={ROLE_OPTIONS}
                      onChange={(v) => handleRoleChange(user, v)}
                      disabled={lastAdmin}
                      ariaLabel={`Role for ${user.username}`}
                      width={110}
                    />
                    <div className="row-actions">
                      <button
                        className="row-action"
                        title="Reset password"
                        onClick={() => {
                          setResetPassword('');
                          setResetUserId(resetUserId === user.id ? null : user.id);
                        }}
                      >
                        <KeyRound size={15} />
                      </button>
                      <button
                        className="row-action danger"
                        title={lastAdmin ? 'Cannot delete the last admin' : 'Delete user'}
                        disabled={lastAdmin}
                        onClick={() => handleDeleteUser(user)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  {resetUserId === user.id && (
                    <div className="user-row-reset">
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder={`New password for ${user.username} (at least 8 characters)`}
                        autoFocus
                      />
                      <button
                        className="control-button"
                        onClick={() => handleResetPassword(user)}
                      >
                        Save
                      </button>
                      <button
                        className="add-user-cancel"
                        onClick={() => {
                          setResetUserId(null);
                          setResetPassword('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {!showAddForm ? (
            <button className="add-user-btn" onClick={() => setShowAddForm(true)}>
              <Plus size={14} /> Add user
            </button>
          ) : (
            <form className="add-user-form" onSubmit={handleAddUser}>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="new-user-name">Username</label>
                  <input
                    id="new-user-name"
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="new-user-pw">Password</label>
                  <input
                    id="new-user-pw"
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    required
                  />
                </div>
                <div className="form-group">
                  <label id="new-user-role">Role</label>
                  <Select
                    value={newUserRole}
                    options={ROLE_OPTIONS}
                    onChange={setNewUserRole}
                    ariaLabel="Role for the new user"
                    width="100%"
                  />
                </div>
              </div>
              <div className="add-user-actions">
                <button type="submit" className="control-button">
                  Add user
                </button>
                <button
                  type="button"
                  className="add-user-cancel"
                  onClick={() => setShowAddForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
};

export default AccountsTab;
