import React from 'react';
import { Terminal, Server, Settings2, ExternalLink, ArrowRight } from 'lucide-react';

interface ResourcesSectionProps {
  githubRepo: string;
  pankhaSite: string;
}

const ResourcesSection: React.FC<ResourcesSectionProps> = React.memo(({ githubRepo, pankhaSite }) => (
  <section className="deployment-section">
    <h3><Terminal size={20} /> Technical Documentation</h3>
    <div className="resource-grid">
      <a href={`${pankhaSite}/docs/`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Server size={18} />
          <span>Wiki: Setup &amp; Configuration</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${pankhaSite}/docs/wiki/agents-linux/`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Settings2 size={18} />
          <span>Linux Service Guide</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${pankhaSite}/docs/wiki/agents-windows/`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Settings2 size={18} />
          <span>Windows Service Guide</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${pankhaSite}/docs/wiki/agents-advanced-settings/`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <Settings2 size={18} />
          <span>Advanced Agent Settings</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
      <a href={`${githubRepo}/issues`} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div className="link-label">
          <ExternalLink size={18} />
          <span>Bug Reports &amp; Issues</span>
        </div>
        <ArrowRight size={16} className="link-arrow" />
      </a>
    </div>
  </section>
));

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;
