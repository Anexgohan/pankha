import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search } from 'lucide-react';
import './Select.css';

/**
 * Select (Design1) - in-house dropdown replacing every native <select>.
 * Own menu DOM (portal): below/above placement, scroll-lock, Esc consumed,
 * type-ahead, optional search; desktop popover / mobile bottom sheet.
 * Plain by default; renderTrigger/renderOption for rich content.
 * Full spec: pankha-dev task_12_dropdown-menu-rework.md
 */

export interface SelectOption<V extends string | number = string> {
  value: V;
  label: string; // a11y name + type-ahead target + default render text
  disabled?: boolean;
  title?: string; // hover tooltip (replaces <option title>)
  data?: unknown; // arbitrary payload for renderOption/renderTrigger
}

export interface SelectGroup<V extends string | number = string> {
  label: string;
  options: SelectOption<V>[];
}

export interface SelectProps<V extends string | number = string> {
  value: V | null;
  onChange: (value: V) => void;
  options: SelectOption<V>[] | SelectGroup<V>[]; // flat OR grouped

  id?: string; // lets <label htmlFor> target the trigger (native parity)
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;

  // ---- presentation (length / breadth / width / contents) ----
  width?: number | string; // trigger + menu width
  menuMaxHeight?: number; // px; list scrolls past this (default 320)
  searchable?: boolean; // built-in filter input at the top of the menu
  align?: 'start' | 'end'; // menu edge alignment (default 'start')

  // ---- double-representation (omit for a plain dropdown) ----
  renderTrigger?: (selected: SelectOption<V> | null) => React.ReactNode;
  renderOption?: (
    opt: SelectOption<V>,
    state: { active: boolean; selected: boolean }
  ) => React.ReactNode;
}

type Row<V extends string | number> =
  | { kind: 'group'; label: string }
  // grouped/groupFirst/groupLast let the CSS draw group chrome (rail etc.)
  | {
      kind: 'option';
      opt: SelectOption<V>;
      index: number;
      grouped: boolean;
      groupFirst: boolean;
      groupLast: boolean;
    };

function isGrouped<V extends string | number>(
  options: SelectOption<V>[] | SelectGroup<V>[]
): options is SelectGroup<V>[] {
  return options.length > 0 && 'options' in options[0];
}

const MOBILE_BREAKPOINT = 768; // matches useContextualPanel
const TYPEAHEAD_RESET_MS = 700;
const MENU_GAP = 4; // px between trigger and menu
const VIEWPORT_EDGE = 8; // px min distance from viewport edges

export function Select<V extends string | number = string>(props: SelectProps<V>) {
  const {
    value,
    onChange,
    options,
    id,
    placeholder,
    disabled,
    ariaLabel,
    className,
    width,
    menuMaxHeight = 320,
    searchable,
    align = 'start',
    renderTrigger,
    renderOption,
  } = props;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>();
  // Mobile: lift + grow the sheet while the on-screen keyboard is up.
  const [sheetStyle, setSheetStyle] = useState<React.CSSProperties>();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeaheadRef = useRef({ buffer: '', time: 0 });
  const listboxId = useId();

  // Normalize flat|grouped options, apply search filter, flatten for
  // keyboard nav; emptied groups drop their header too.
  const { rows, flat } = useMemo(() => {
    const groups: SelectGroup<V>[] = isGrouped(options) ? options : [{ label: '', options }];
    const q = searchable && query ? query.toLowerCase() : null;
    const rows: Row<V>[] = [];
    const flat: SelectOption<V>[] = [];
    for (const group of groups) {
      const visible = q
        ? group.options.filter((o) => o.label.toLowerCase().includes(q))
        : group.options;
      if (visible.length === 0) continue;
      // Empty label = headerless group (plain top-level rows)
      const grouped = Boolean(group.label);
      if (grouped) rows.push({ kind: 'group', label: group.label });
      visible.forEach((opt, i) => {
        rows.push({
          kind: 'option',
          opt,
          index: flat.length,
          grouped,
          groupFirst: grouped && i === 0,
          groupLast: grouped && i === visible.length - 1,
        });
        flat.push(opt);
      });
    }
    return { rows, flat };
  }, [options, searchable, query]);

  // Unfiltered lookup: the trigger keeps its value while search hides the row.
  const selected = useMemo(() => {
    const groups: SelectGroup<V>[] = isGrouped(options) ? options : [{ label: '', options }];
    for (const group of groups) {
      const match = group.options.find((o) => o.value === value);
      if (match) return match;
    }
    return null;
  }, [options, value]);
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const firstEnabled = () => flat.findIndex((o) => !o.disabled);
  const lastEnabled = () => {
    for (let i = flat.length - 1; i >= 0; i--) if (!flat[i].disabled) return i;
    return -1;
  };

  const openMenu = (initial?: 'first' | 'last') => {
    if (disabled || flat.length === 0) return;
    const selectedIndex = flat.findIndex((o) => o.value === value && !o.disabled);
    setActiveIndex(
      initial === 'first' ? firstEnabled()
        : initial === 'last' ? lastEnabled()
        : selectedIndex >= 0 ? selectedIndex : firstEnabled()
    );
    setOpen(true);
  };

  const closeMenu = (refocus = true) => {
    setOpen(false);
    setMenuStyle(undefined);
    setQuery('');
    typeaheadRef.current = { buffer: '', time: 0 };
    if (refocus) triggerRef.current?.focus();
  };

  const commit = (v: V) => {
    onChange(v);
    closeMenu();
  };

  const moveActive = (dir: 1 | -1) => {
    // Native reference: no wrap; skip disabled options.
    let i = activeIndex;
    do {
      i += dir;
    } while (i >= 0 && i < flat.length && flat[i].disabled);
    if (i >= 0 && i < flat.length) setActiveIndex(i);
  };

  const typeahead = (char: string) => {
    const now = Date.now();
    if (now - typeaheadRef.current.time > TYPEAHEAD_RESET_MS) typeaheadRef.current.buffer = '';
    typeaheadRef.current = { buffer: typeaheadRef.current.buffer + char.toLowerCase(), time: now };
    const { buffer } = typeaheadRef.current;
    // Single char cycles past active; longer prefixes re-match from active
    const start = Math.max(activeIndex, 0) + (buffer.length === 1 ? 1 : 0);
    for (let i = 0; i < flat.length; i++) {
      const idx = (start + i) % flat.length;
      if (!flat[idx].disabled && flat[idx].label.toLowerCase().startsWith(buffer)) {
        setActiveIndex(idx);
        return;
      }
    }
  };

  const isPrintable = (e: React.KeyboardEvent) =>
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      } else if (e.key === 'Home') {
        e.preventDefault();
        openMenu('first');
      } else if (e.key === 'End') {
        e.preventDefault();
        openMenu('last');
      } else if (isPrintable(e)) {
        openMenu();
        // Searchable: typed char seeds the filter; otherwise type-ahead
        if (searchable) handleQueryChange(e.key);
        else typeahead(e.key);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(firstEnabled());
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(lastEnabled());
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0 && !flat[activeIndex]?.disabled) commit(flat[activeIndex].value);
        break;
      case 'Tab':
        closeMenu(false); // let focus move on naturally
        break;
      default:
        if (!searchable && isPrintable(e)) {
          e.preventDefault();
          typeahead(e.key);
        }
    }
    // Esc: window capture listener below (consumed before parent panels)
  };

  // Search input keys: arrows/Enter drive the list, the rest edits the query
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && !flat[activeIndex]?.disabled) commit(flat[activeIndex].value);
        break;
      case 'Tab':
        closeMenu(false);
        break;
      // Esc: window capture listener
    }
  };

  // Track the mobile breakpoint (same rule as useContextualPanel)
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Lock page scroll while open (native parity); pad for the lost scrollbar
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  // Consume Esc at capture phase so parent panels' Esc handlers don't fire too
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open]);

  // Pointerdown outside trigger+menu closes and is consumed; never close on
  // blur (clicking the portaled menu blurs the trigger first)
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

  // Close on resize - WIDTH changes only (mobile URL bar / keyboard resizes
  // are height-only and must not close the sheet)
  useEffect(() => {
    if (!open) return;
    const startWidth = window.innerWidth;
    const handleResize = () => {
      if (window.innerWidth !== startWidth) closeMenu(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  // On-screen keyboard: rest the sheet on its top edge and grow into the
  // space above (the keyboard shrinks only the visual viewport)
  useEffect(() => {
    if (!open || !isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (keyboard > 50) {
        setSheetStyle({ bottom: keyboard, maxHeight: Math.max(120, vv.height - 12) });
      } else {
        setSheetStyle(undefined);
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setSheetStyle(undefined);
    };
  }, [open, isMobile]);

  // Desktop placement: below the trigger, flip above near the viewport bottom
  useLayoutEffect(() => {
    if (!open || isMobile) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = rect.bottom + MENU_GAP;
    if (top + menuHeight > vh - VIEWPORT_EDGE) {
      const above = rect.top - MENU_GAP - menuHeight;
      top = above >= VIEWPORT_EDGE ? above : Math.max(VIEWPORT_EDGE, vh - VIEWPORT_EDGE - menuHeight);
    }
    let left = align === 'end' ? rect.right - menuWidth : rect.left;
    left = Math.min(Math.max(left, VIEWPORT_EDGE), Math.max(VIEWPORT_EDGE, vw - VIEWPORT_EDGE - menuWidth));

    setMenuStyle({ top, left, minWidth: rect.width });
  }, [open, isMobile, align, flat.length]);

  // Keep the active row visible - desktop only (on mobile this scrolled the
  // page mid sheet-animation and killed the menu)
  useEffect(() => {
    if (!open || isMobile) return;
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, isMobile]);

  // Autofocus the filter on open - desktop only (no surprise keyboard)
  useEffect(() => {
    if (open && searchable && !isMobile) searchRef.current?.focus();
  }, [open, searchable, isMobile]);

  // Reset active row here, not in an effect: options change identity on every
  // live update and an effect would yank keyboard nav every few seconds
  const handleQueryChange = (q: string) => {
    setQuery(q);
    const ql = q.toLowerCase();
    const groups: SelectGroup<V>[] = isGrouped(options) ? options : [{ label: '', options }];
    let idx = -1;
    for (const group of groups) {
      for (const opt of group.options) {
        if (ql && !opt.label.toLowerCase().includes(ql)) continue;
        idx++;
        if (!opt.disabled) {
          setActiveIndex(idx);
          return;
        }
      }
    }
    setActiveIndex(-1);
  };

  const renderRows = () =>
    rows.map((row) => {
      if (row.kind === 'group') {
        return (
          <li key={`group-${row.label}`} className="pk-select-group-label" role="presentation">
            {row.label}
          </li>
        );
      }
      const { opt, index } = row;
      const isSelected = opt.value === value;
      const isActive = index === activeIndex;
      return (
        <li
          key={`${opt.value}`}
          id={optionId(index)}
          role="option"
          aria-selected={isSelected}
          aria-disabled={opt.disabled || undefined}
          data-active={isActive || undefined}
          title={opt.title}
          className={[
            'pk-select-option',
            isActive && 'active',
            isSelected && 'selected',
            opt.disabled && 'disabled',
            row.grouped && 'in-group',
            row.groupFirst && 'group-first',
            row.groupLast && 'group-last',
          ]
            .filter(Boolean)
            .join(' ')}
          // keep DOM focus on the trigger (a row press would blur it)
          onPointerDown={(e) => e.preventDefault()}
          onMouseEnter={() => !opt.disabled && setActiveIndex(index)}
          onClick={() => !opt.disabled && commit(opt.value)}
        >
          {renderOption ? (
            renderOption(opt, { active: isActive, selected: isSelected })
          ) : (
            <span className="pk-select-option-label">{opt.label}</span>
          )}
          {isSelected && <Check size={14} className="pk-select-check" aria-hidden="true" />}
        </li>
      );
    });

  const searchBox = searchable ? (
    <div className="pk-select-search">
      <Search size={13} aria-hidden="true" className="pk-select-search-icon" />
      <input
        ref={searchRef}
        type="text"
        className="pk-select-search-input"
        value={query}
        placeholder="Search..."
        aria-label="Search options"
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleSearchKeyDown}
      />
    </div>
  ) : null;

  const list = (
    <ul
      id={listboxId}
      role="listbox"
      className="pk-select-list"
      aria-label={ariaLabel}
      style={!isMobile ? { maxHeight: menuMaxHeight } : undefined}
    >
      {rows.length === 0 ? (
        <li className="pk-select-empty" role="presentation">
          No matches
        </li>
      ) : (
        renderRows()
      )}
    </ul>
  );

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        title={selected?.title}
        className={className ? `pk-select-trigger ${className}` : 'pk-select-trigger'}
        style={width != null ? { width } : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="pk-select-value">
          {renderTrigger ? (
            renderTrigger(selected)
          ) : selected ? (
            selected.label
          ) : (
            <span className="pk-select-placeholder">{placeholder ?? 'Select...'}</span>
          )}
        </span>
      </button>

      {open &&
        !isMobile &&
        createPortal(
          <div ref={menuRef} className="pk-select-menu" style={menuStyle}>
            {searchBox}
            {list}
          </div>,
          document.body
        )}

      {open &&
        isMobile &&
        createPortal(
          <div className="pk-select-backdrop">
            <div ref={menuRef} className="pk-select-sheet" style={sheetStyle}>
              {searchBox}
              {list}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
