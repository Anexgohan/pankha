/**
 * Toast Notifications Wrapper
 * 
 * Uses Sonner for toast notifications. This component configures the global
 * toast container with project-specific defaults.
 * 
 * FUTURE: When migrating to Tailwind/shadcn:
 * - Sonner is the official toast component in shadcn/ui
 * - Replace this file with shadcn's Toaster component
 * - Styling will use Tailwind classes instead of inline theme
 * 
 * @see https://sonner.emilkowal.ski/
 */

import { Toaster as SonnerToaster } from 'sonner';

// Custom styles for toast button positioning
const toastStyles = `
  [data-sonner-toast] {
    overflow: visible !important;
  }
  [data-sonner-toast] [data-close-button] {
    position: absolute !important;
    top: -12px !important;
    right: -4px !important;
    left: auto !important;
    transform: none !important;
  }
  [data-sonner-toast] button[data-button] {
    font-size: 18px !important;
    position: absolute !important;
    top: -14px !important;
    right: 24px !important;
    z-index: 1000 !important;
    pointer-events: auto !important;
    width: 24px !important;
    height: 24px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    border: 1px solid var(--neutral-500) !important;
    padding: 2px 2px !important;
    cursor: pointer !important;
  }
  [data-sonner-toast] button[data-button]:hover {
    background: var(--bg-panels_01) !important;
  }
`;

export function Toaster() {
  return (
    <>
      <style>{toastStyles}</style>
      <SonnerToaster
        position="top-right"
        expand={true}
        visibleToasts={3}
        richColors
        closeButton
        // 10 seconds (10000 milliseconds)
        duration={10000}
        toastOptions={{
          style: {
            // Use semantic tokens from semantic.css for theme compatibility
            background: 'var(--bg-panels_02)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--bg-tertiary)',
          },
        }}
      />
    </>
  );
}

