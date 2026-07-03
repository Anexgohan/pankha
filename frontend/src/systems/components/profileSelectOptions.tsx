import type { ReactNode } from 'react';
import type { FanProfile } from '../../services/fanProfilesApi';
import type { SelectGroup, SelectOption } from '../../components/ui/Select';

/**
 * Options builder + renderers for the Fan Profile <Select> dropdowns in
 * SystemCard (zone + per-fan).
 */

/** Sentinel for "No Profile (Manual)" - DB profile ids are SERIAL (>= 1). */
export const NO_PROFILE = 0;

/** Manual -> System (A-Z) -> User (A-Z); callers pass pre-sorted lists. */
export function buildProfileOptions(
  systemProfiles: FanProfile[],
  userProfiles: FanProfile[],
  emptyLabel = 'No Profile (Manual)' // bulk edit passes "Don't change"
): SelectGroup<number>[] {
  const toOption = (profile: FanProfile): SelectOption<number> => ({
    value: profile.id,
    label: `${profile.profile_name} (${profile.profile_type})`,
    title: profile.description || profile.profile_name,
    data: profile,
  });
  const groups: SelectGroup<number>[] = [
    // Headerless group: renders as a plain top-level row.
    { label: '', options: [{ value: NO_PROFILE, label: emptyLabel }] },
  ];
  if (systemProfiles.length > 0) {
    groups.push({ label: 'System', options: systemProfiles.map(toOption) });
  }
  if (userProfiles.length > 0) {
    groups.push({ label: 'User', options: userProfiles.map(toOption) });
  }
  return groups;
}

/**
 * Renderers for trigger + rows: name + (type) + profile_type colour dot.
 */
export function makeProfileRenderers(
  typeColorMap: Record<string, string | null>,
  emptyTriggerLabel = 'No Profile' // bulk edit passes "Don't change"
) {
  const profileContent = (profile: FanProfile): ReactNode => {
    const dotColor = typeColorMap[profile.profile_type] || null;
    // "GPU Optimal (optimal) <dot>" - dot last; spacing from the flex gap
    return (
      <>
        <span className="profile-name-label">{profile.profile_name}</span>
        <span className="profile-type-label">({profile.profile_type})</span>
        {dotColor && <span className="profile-color-dot" style={{ background: dotColor }} />}
      </>
    );
  };
  return {
    renderTrigger: (selected: SelectOption<number> | null): ReactNode => {
      const profile = selected?.data as FanProfile | undefined;
      return profile ? profileContent(profile) : emptyTriggerLabel;
    },
    renderOption: (opt: SelectOption<number>): ReactNode => {
      const profile = opt.data as FanProfile | undefined;
      return profile ? (
        profileContent(profile)
      ) : (
        <span className="pk-select-option-label">{opt.label}</span>
      );
    },
  };
}
