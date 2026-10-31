/**
 * Content Studio filter mapping — tab + subtype bar → search-data payload,
 * plus Pathfinder / Starfinder source splitting.
 */

import type { AbilityBlock, AbilityBlockType, ContentSource, ItemGroup } from '@schemas/content';
import { getTraitIdByType, hasTraitType } from '@utils/traits';

export type ContentStudioTab = 'actions' | 'spells' | 'feats' | 'classes' | 'equipment' | 'monsters' | 'hazards';

export type SystemFilter = 'pathfinder' | 'starfinder' | 'both';

export type ActionBucket = 'basic' | 'specialty-basic' | 'skill' | 'exploration' | 'downtime';

/** Action subtype tabs shown under the Actions content tab. */
export const ACTION_BUCKET_TABS: { id: ActionBucket; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'specialty-basic', label: 'Specialty basic' },
  { id: 'skill', label: 'Skill actions' },
  { id: 'exploration', label: 'Exploration' },
  { id: 'downtime', label: 'Downtime' },
];

export type SpellKind = 'all' | 'normal' | 'cantrip' | 'focus' | 'ritual';

export type FeatCategory =
  | 'general'
  | 'skill'
  | 'class'
  | 'ancestry'
  | 'archetype'
  | 'dedication'
  | 'all-ancestries';

/** Feat subtype tabs shown under the Feats content tab. */
export const FEAT_CATEGORY_TABS: { id: FeatCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'skill', label: 'Skill' },
  { id: 'class', label: 'Class' },
  { id: 'ancestry', label: 'Ancestry' },
  { id: 'archetype', label: 'Archetype' },
  { id: 'dedication', label: 'Dedication' },
  { id: 'all-ancestries', label: 'All Ancestries' },
];

export interface FeatCategoryContext {
  classTraitIds: Set<number>;
  ancestryTraitIds: Set<number>;
  archetypeTraitIds: Set<number>;
  classTraitId: number | null;
  ancestryTraitId: number | null;
  archetypeTraitId: number | null;
}

/** Inner Feats / Features tabs on the Classes browse panel. */
export type ClassSection = 'features' | 'feats';

export type OwnershipFilter = 'any' | 'official' | 'homebrew';

/** Starfinder books use this content_source.group value. */
export const STARFINDER_GROUP = 'starfinder-core';

export interface ContentStudioSubtypeState {
  actionBucket: ActionBucket;
  spellKind: SpellKind;
  tradition: string | null;
  rankMin: number;
  rankMax: number;
  featCategory: FeatCategory;
  classTraitId: number | null;
  ancestryTraitId: number | null;
  archetypeTraitId: number | null;
  featLevelMin: number;
  featLevelMax: number;
  classId: number | null;
  classSection: ClassSection;
  classLevelMin: number;
  classLevelMax: number;
  itemGroup: ItemGroup | 'ALL';
  itemTags: string[];
  itemLevelMin: number;
  itemLevelMax: number;
  /** Level range for Monsters / Hazards tabs. */
  creatureLevelMin: number;
  creatureLevelMax: number;
  /**
   * Monster / hazard trait tags (Construct, Humanoid, …).
   * Trait record ids where `meta_data.creature_trait` is true.
   */
  creatureTraitIds: number[];
}

export const DEFAULT_SUBTYPE_STATE: ContentStudioSubtypeState = {
  actionBucket: 'basic',
  spellKind: 'all',
  tradition: null,
  rankMin: 0,
  rankMax: 10,
  featCategory: 'general',
  classTraitId: null,
  ancestryTraitId: null,
  archetypeTraitId: null,
  featLevelMin: 0,
  featLevelMax: 20,
  classId: null,
  classSection: 'feats',
  classLevelMin: 1,
  classLevelMax: 20,
  itemGroup: 'ALL',
  itemTags: [],
  itemLevelMin: 0,
  itemLevelMax: 30,
  creatureLevelMin: -1,
  creatureLevelMax: 25,
  creatureTraitIds: [],
};

export interface SearchDataFilters {
  is_advanced: true;
  type: string;
  ab_type?: AbilityBlockType;
  name?: string;
  description?: string;
  content_sources?: number[];
  /** Row must contain every id (AND). */
  traits?: number[];
  /** Row must contain at least one id (OR) — class/ancestry/archetype “any”. */
  traits_any?: number[];
  level_min?: number;
  level_max?: number;
  rank_min?: number;
  rank_max?: number;
  traditions?: string[];
  spell_type?: 'FOCUS' | 'RITUAL' | 'NORMAL';
  group?: ItemGroup;
  /** Local Content Studio API: page size. Use -1 for “all matching”. */
  limit?: number;
  offset?: number;
  /** Local Content Studio API: only traits with meta_data.creature_trait. */
  creature_trait?: boolean;
}

/** Rows per page for paginated Content Studio lists. */
export const CONTENT_STUDIO_PAGE_SIZE = 10;

/**
 * Split content sources by Pathfinder vs Starfinder and ownership.
 */
export function filterContentSources(
  sources: ContentSource[],
  system: SystemFilter,
  ownership: OwnershipFilter
): ContentSource[] {
  return sources.filter((source) => {
    if (system === 'pathfinder' && source.group === STARFINDER_GROUP) return false;
    if (system === 'starfinder' && source.group !== STARFINDER_GROUP) return false;
    if (ownership === 'official' && source.user_id !== null) return false;
    if (ownership === 'homebrew' && source.user_id === null) return false;
    return true;
  });
}

/**
 * Match Skills & Actions panel buckets (client-side post-filter).
 */
export function matchesActionBucket(action: AbilityBlock, bucket: ActionBucket): boolean {
  const skill = action.meta_data?.skill;
  const hasSkill = Array.isArray(skill) ? skill.length > 0 : !!skill;
  const hasRequirements = !!(action.requirements && action.requirements.trim().length > 0);
  const isExploration = hasTraitType('EXPLORATION', action.traits ?? undefined);
  const isDowntime = hasTraitType('DOWNTIME', action.traits ?? undefined);

  if (bucket === 'skill') return hasSkill;
  if (bucket === 'exploration') return isExploration;
  if (bucket === 'downtime') return isDowntime;
  if (bucket === 'specialty-basic') return !hasSkill && hasRequirements;
  if (bucket === 'basic') {
    return !hasSkill && !hasRequirements && !isExploration && !isDowntime;
  }
  return true;
}

/**
 * Match feat subtype tabs. Optional nested trait ids further narrow class / ancestry / archetype.
 */
export function matchesFeatCategory(
  feat: AbilityBlock,
  category: FeatCategory,
  ctx: FeatCategoryContext
): boolean {
  const traits = feat.traits ?? [];
  const has = (id: number) => traits.includes(id);

  if (category === 'general') return has(getTraitIdByType('GENERAL'));
  if (category === 'skill') return has(getTraitIdByType('SKILL'));
  if (category === 'dedication') return has(getTraitIdByType('DEDICATION'));
  if (category === 'all-ancestries') return has(getTraitIdByType('ALL-ANCESTRIES'));

  if (category === 'class') {
    if (ctx.classTraitId != null) return has(ctx.classTraitId);
    return traits.some((t) => ctx.classTraitIds.has(t));
  }
  if (category === 'ancestry') {
    if (ctx.ancestryTraitId != null) return has(ctx.ancestryTraitId);
    return traits.some((t) => ctx.ancestryTraitIds.has(t));
  }
  if (category === 'archetype') {
    if (ctx.archetypeTraitId != null) return has(ctx.archetypeTraitId);
    return traits.some((t) => ctx.archetypeTraitIds.has(t));
  }
  return true;
}

const ITEM_TAG_TRAITS: Record<string, 'CONSUMABLE' | 'INVESTED' | 'MAGICAL' | 'BOMB' | 'STAFF' | 'WAND'> = {
  Consumable: 'CONSUMABLE',
  Invested: 'INVESTED',
  Magical: 'MAGICAL',
  Bomb: 'BOMB',
  Staff: 'STAFF',
  Wand: 'WAND',
};

/**
 * Build the search-data advanced filter body for the active tab + subtypes.
 * Action buckets and some feat nesting are refined client-side after fetch.
 */
export function buildSearchFilters(args: {
  tab: ContentStudioTab;
  name: string;
  sourceIds: number[];
  subtype: ContentStudioSubtypeState;
  /** Resolved class.trait_id when Classes tab nests Features/Feats. */
  nestedClassTraitId?: number | null;
  /** Trait ids for Feats category “any class / ancestry / archetype”. */
  featCategoryTraitIds?: number[];
}): SearchDataFilters | null {
  const { tab, name, sourceIds, subtype, nestedClassTraitId, featCategoryTraitIds } = args;
  const nameFilter = name.trim() || undefined;
  const base = {
    is_advanced: true as const,
    name: nameFilter,
    content_sources: sourceIds.length ? sourceIds : undefined,
  };

  if (tab === 'actions') {
    return {
      ...base,
      type: 'ability-block',
      ab_type: 'action',
    };
  }

  if (tab === 'spells') {
    const filters: SearchDataFilters = {
      ...base,
      type: 'spell',
      rank_min: subtype.rankMin,
      rank_max: subtype.rankMax,
    };
    if (subtype.tradition) {
      filters.traditions = [subtype.tradition];
    }
    if (subtype.spellKind === 'cantrip') {
      filters.traits = [getTraitIdByType('CANTRIP')];
    } else if (subtype.spellKind === 'focus') {
      filters.spell_type = 'FOCUS';
    } else if (subtype.spellKind === 'ritual') {
      filters.spell_type = 'RITUAL';
    } else if (subtype.spellKind === 'normal') {
      filters.spell_type = 'NORMAL';
    }
    return filters;
  }

  if (tab === 'feats') {
    // Push category into SQL so we never download the full ~11k feat corpus.
    const filters: SearchDataFilters = {
      ...base,
      type: 'ability-block',
      ab_type: 'feat',
      level_min: subtype.featLevelMin,
      level_max: subtype.featLevelMax,
    };
    const cat = subtype.featCategory;
    if (cat === 'general') filters.traits = [getTraitIdByType('GENERAL')];
    else if (cat === 'skill') filters.traits = [getTraitIdByType('SKILL')];
    else if (cat === 'dedication') filters.traits = [getTraitIdByType('DEDICATION')];
    else if (cat === 'all-ancestries') filters.traits = [getTraitIdByType('ALL-ANCESTRIES')];
    else if (cat === 'class') {
      if (subtype.classTraitId != null) filters.traits = [subtype.classTraitId];
      else if (featCategoryTraitIds?.length) filters.traits_any = featCategoryTraitIds;
    } else if (cat === 'ancestry') {
      if (subtype.ancestryTraitId != null) filters.traits = [subtype.ancestryTraitId];
      else if (featCategoryTraitIds?.length) filters.traits_any = featCategoryTraitIds;
    } else if (cat === 'archetype') {
      if (subtype.archetypeTraitId != null) filters.traits = [subtype.archetypeTraitId];
      else if (featCategoryTraitIds?.length) filters.traits_any = featCategoryTraitIds;
    }
    return filters;
  }

  if (tab === 'classes') {
    // Classes tab uses ClassBrowsePanel (overview + Feats/Features), not search-data lists.
    return null;
  }

  if (tab === 'equipment') {
    const tagTraitIds = subtype.itemTags
      .map((tag) => {
        const key = ITEM_TAG_TRAITS[tag];
        return key ? getTraitIdByType(key) : NaN;
      })
      .filter((id) => Number.isFinite(id) && id > 0);
    return {
      ...base,
      type: 'item',
      group: subtype.itemGroup === 'ALL' ? undefined : subtype.itemGroup,
      traits: tagTraitIds.length ? tagTraitIds : undefined,
      level_min: subtype.itemLevelMin,
      level_max: subtype.itemLevelMax,
    };
  }

  if (tab === 'monsters') {
    return {
      ...base,
      type: 'creature',
      level_min: subtype.creatureLevelMin,
      level_max: subtype.creatureLevelMax,
      traits: subtype.creatureTraitIds.length ? subtype.creatureTraitIds : undefined,
    };
  }

  if (tab === 'hazards') {
    return {
      ...base,
      type: 'hazard',
      level_min: subtype.creatureLevelMin,
      level_max: subtype.creatureLevelMax,
      traits: subtype.creatureTraitIds.length ? subtype.creatureTraitIds : undefined,
    };
  }

  return null;
}

export function drawerTypeForResult(
  tab: ContentStudioTab,
  row: { type?: string }
): 'action' | 'feat' | 'class-feature' | 'spell' | 'item' | 'class' | 'creature' | 'hazard' {
  if (tab === 'spells') return 'spell';
  if (tab === 'equipment') return 'item';
  if (tab === 'monsters') return 'creature';
  if (tab === 'hazards') return 'hazard';
  if (tab === 'classes' && row.type === 'class-feature') return 'class-feature';
  if (tab === 'classes' && (!row.type || row.type === 'class')) return 'class';
  if (row.type === 'action') return 'action';
  if (row.type === 'class-feature') return 'class-feature';
  if (row.type === 'feat') return 'feat';
  if (row.type === 'creature') return 'creature';
  if (row.type === 'hazard') return 'hazard';
  if (tab === 'actions') return 'action';
  if (tab === 'feats') return 'feat';
  return 'feat';
}
