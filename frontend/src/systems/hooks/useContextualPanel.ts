import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Shared positioning/behavior for card-anchored modals (Bulk Edit, Sensor
 * Builder, Manage Sensors). Encapsulates the niceties these popups share:
 *
 * - Desktop + an anchor rect -> a "contextual" panel placed beside the card
 *   (right of it, flipped to the left if it would overflow, clamped vertically).
 * - Mobile (or no anchor) -> empty styles so the CSS bottom-sheet/centered
 *   fallback takes over.
 * - ESC closes; window resize re-evaluates mobile/position.
 *
 * Returns the pieces the caller wires into the standard markup:
 *   <div className={`bulk-edit-modal-root ${contextual ? 'contextual' : ''}`}>
 *     <div className="bulk-edit-backdrop" onClick={onClose} />
 *     <div className="bulk-edit-modal-container" style={panelStyles}>
 *       <div ref={panelRef} className={`bulk-edit-panel ${isMobile ? 'mobile' : 'desktop'}`}>
 */
export function useContextualPanel(
  isOpen: boolean,
  anchorRect: DOMRect | null,
  onClose: () => void
) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [panelStyles, setPanelStyles] = useState<React.CSSProperties>({});
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Position the panel next to the anchoring card (desktop only).
  useLayoutEffect(() => {
    if (!isOpen || isMobile || !anchorRect || !panelRef.current) {
      setPanelStyles({});
      return;
    }

    const panelWidth = panelRef.current.offsetWidth;
    const gap = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default: align to the right side of the card.
    let left = anchorRect.right + gap;

    // If it overflows right, place it to the left of the card instead.
    if (left + panelWidth > viewportWidth - 10) {
      left = anchorRect.left - panelWidth - gap;
      if (left < 10) left = 10; // clamp to edge if it now overflows left
    }

    // Vertical: align tops, then clamp into the viewport.
    const panelHeight = panelRef.current.offsetHeight;
    let top = anchorRect.top;
    if (top + panelHeight > viewportHeight - 10) top = viewportHeight - panelHeight - 10;
    if (top < 10) top = 10;

    setPanelStyles({ position: 'fixed', top: `${top}px`, left: `${left}px`, margin: 0, transform: 'none' });
  }, [isOpen, isMobile, anchorRect]);

  // ESC to close.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  return { isMobile, panelStyles, panelRef, contextual: !!anchorRect && !isMobile };
}
