import React from 'react';

/**
 * Global SVG pattern definitions for sparkline gap visualization.
 * Rendered ONCE at app root, reused by all sparklines via url(#gap-hatch-pattern).
 * 
 * Uses CSS token var(--text-tertiary) for theme compatibility.
 */
export const GraphPatternDefs = React.memo(() => (
  <svg 
    width={0} 
    height={0} 
    style={{ position: 'absolute', pointerEvents: 'none' }}
    aria-hidden="true"
  >
    <defs>
      <pattern
        id="gap-hatch-pattern"
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
        patternTransform="rotate(45)"
      >
        <line 
          x1="0" 
          y1="0" 
          x2="0" 
          y2="6"
          stroke="var(--text-tertiary)"
          strokeWidth="2"
          opacity="0.3"
        />
      </pattern>
    </defs>
  </svg>
));

GraphPatternDefs.displayName = 'GraphPatternDefs';
