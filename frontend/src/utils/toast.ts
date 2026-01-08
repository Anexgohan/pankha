/**
 * Toast Utility
 * 
 * Wraps sonner's toast function with enhanced features.
 * All components should import from this file, not directly from sonner.
 * 
 * Features:
 * - Copy button on error toasts for easy error copying
 * - Single import point for all toast calls
 * 
 * Usage:
 *   import { toast } from '../utils/toast';
 *   toast.success('Profile saved!');
 *   toast.error('Failed to connect');
 */

import { toast as sonnerToast } from 'sonner';

// Copy text to clipboard
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    sonnerToast.success('Copied to clipboard', { duration: 2000 });
  } catch {
    // Fallback for older browsers or denied permission
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    sonnerToast.success('Copied to clipboard', { duration: 2000 });
  }
};

// Enhanced toast with copy action for all types
export const toast = {
  ...sonnerToast,
  
  // Override error to add copy action
  error: (message: string, options?: Parameters<typeof sonnerToast.error>[1]) => {
    return sonnerToast.error(message, {
      ...options,
      action: {
        label: '📋',
        onClick: () => {
          copyToClipboard(message);
        },
      },
    });
  },
  
  // Override success to add copy action
  success: (message: string, options?: Parameters<typeof sonnerToast.success>[1]) => {
    return sonnerToast.success(message, {
      ...options,
      action: {
        label: '📋',
        onClick: () => {
          copyToClipboard(message);
        },
      },
    });
  },
  
  // Override info to add copy action
  info: (message: string, options?: Parameters<typeof sonnerToast.info>[1]) => {
    return sonnerToast.info(message, {
      ...options,
      action: {
        label: '📋',
        onClick: () => {
          copyToClipboard(message);
        },
      },
    });
  },
  
  // Override warning to add copy action
  warning: (message: string, options?: Parameters<typeof sonnerToast.warning>[1]) => {
    return sonnerToast.warning(message, {
      ...options,
      action: {
        label: '📋',
        onClick: () => {
          copyToClipboard(message);
        },
      },
    });
  },
  
  // Re-export other methods as-is
  loading: sonnerToast.loading,
  promise: sonnerToast.promise,
  custom: sonnerToast.custom,
  dismiss: sonnerToast.dismiss,
};

