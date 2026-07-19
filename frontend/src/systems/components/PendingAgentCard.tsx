import React, { useState } from 'react';
import { Check, X, ShieldQuestion } from 'lucide-react';
import type { PendingAgent } from '../../services/authApi';
import { approvePendingAgent, dismissPendingAgent } from '../../services/authApi';
import { toast } from '../../utils/toast';
import './PendingAgentCard.css';

// Defanged card for an agent awaiting admin approval: registration
// metadata only - no telemetry flows until approved. The card disappears via
// the agentPendingRemoved broadcast after either action.

interface PendingAgentCardProps {
  agent: PendingAgent;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

const PendingAgentCard: React.FC<PendingAgentCardProps> = ({ agent }) => {
  const [busy, setBusy] = useState(false);

  const isWindows = agent.platform === 'windows' || agent.agentType === 'os_windows';
  // Old Linux/IPMI builds are updated as part of the approval
  const willChainUpdate = agent.belowTokenVersion === true && !isWindows;
  const windowsOldBuild = agent.belowTokenVersion === true && isWindows;

  const handleApprove = async () => {
    setBusy(true);
    try {
      await approvePendingAgent(agent.agentId);
      toast.success(`${agent.name} approved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    setBusy(true);
    try {
      await dismissPendingAgent(agent.agentId);
      toast.success(`${agent.name} dismissed - it may reappear when the agent reconnects`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dismissal failed');
      setBusy(false);
    }
  };

  return (
    <div className="system-card pending-card">
      <div className="system-header">
        <div className="system-title">
          <div className="system-title-top">
            <span className="pending-name">{agent.name}</span>
            <div className="status-group">
              <span className="status-badge read-only">
                <span className="status-dot"></span>Pending approval
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="pending-reason">
        <ShieldQuestion size={15} /> {agent.reason}
      </div>

      <div className="pending-meta">
        <div className="pending-meta-row">
          <span className="k">Agent ID</span>
          <span className="v">{agent.agentId}</span>
        </div>
        {agent.ip && (
          <div className="pending-meta-row">
            <span className="k">Address</span>
            <span className="v">{agent.ip}</span>
          </div>
        )}
        {(agent.platform || agent.agentType) && (
          <div className="pending-meta-row">
            <span className="k">Platform</span>
            <span className="v">
              {agent.platform ?? 'unknown'}
              {agent.agentType ? ` (${agent.agentType})` : ''}
            </span>
          </div>
        )}
        {agent.version && (
          <div className="pending-meta-row">
            <span className="k">Version</span>
            <span className="v">{agent.version}</span>
          </div>
        )}
        <div className="pending-meta-row">
          <span className="k">Requested</span>
          <span className="v">{timeAgo(agent.requestedAt)}</span>
        </div>
      </div>

      {windowsOldBuild && (
        <div className="pending-reason">
          <ShieldQuestion size={15} /> Old build: after approving, run the latest
          Windows MSI installer on the machine, then approve it again to secure it.
        </div>
      )}

      <div className="pending-actions">
        <button
          className="btn-primary-tactical deploy-copy-cta pending-approve"
          onClick={handleApprove}
          disabled={busy}
          title={willChainUpdate ? 'Approves this agent and updates it in one step' : undefined}
        >
          <Check size={15} /> {willChainUpdate ? 'Approve & Update' : 'Approve'}
        </button>
        <button className="pending-dismiss" onClick={handleDismiss} disabled={busy}>
          <X size={15} /> Dismiss
        </button>
      </div>
    </div>
  );
};

export default PendingAgentCard;
