/**
 * Debounced Content Studio search against the search-data edge function.
 */

import { DEBOUNCE_DELAY } from '@constants/data';
import { makeRequest } from '@requests/request-manager';
import type {
  AbilityBlock,
  Ancestry,
  Archetype,
  Class,
  ContentSource,
  Creature,
  Hazard,
  Item,
  Spell,
} from '@schemas/content';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  ACTION_BUCKET_TABS,
  FEAT_CATEGORY_TABS,
  buildSearchFilters,
  CONTENT_STUDIO_PAGE_SIZE,
  matchesActionBucket,
  type ActionBucket,
  type ContentStudioSubtypeState,
  type ContentStudioTab,
  type FeatCategory,
  type OwnershipFilter,
  type SystemFilter,
  filterContentSources,
  type SearchDataFilters,
} from './filters';

export type ContentStudioResult = AbilityBlock | Spell | Item | Class | Creature | Hazard;

const SEARCH_STALE_MS = 1000 * 60 * 5;

export function useContentStudioSources(system: SystemFilter, ownership: OwnershipFilter) {
  const sourcesQuery = useQuery({
    queryKey: ['content-studio-sources'],
    queryFn: async () => {
      const { fetchContentSources } = await import('@content/content-store');
      return fetchContentSources('ALL-PUBLIC');
    },
    staleTime: SEARCH_STALE_MS,
  });

  const filtered = useMemo(() => {
    const all = sourcesQuery.data ?? [];
    return filterContentSources(all, system, ownership);
  }, [sourcesQuery.data, system, ownership]);

  return { sources: filtered, allSources: sourcesQuery.data ?? [], isLoading: sourcesQuery.isLoading };
}

async function runSearch(filters: SearchDataFilters): Promise<{ results: ContentStudioResult[]; total: number }> {
  const result = await makeRequest<Record<string, unknown>>('search-data', filters);
  if (!result) return { results: [], total: 0 };
  const total = typeof result.total === 'number' ? result.total : 0;
  if (filters.type === 'ability-block') {
    return { results: (result.ability_blocks ?? []) as AbilityBlock[], total };
  }
  if (filters.type === 'spell') {
    return { results: (result.spells ?? []) as Spell[], total };
  }
  if (filters.type === 'item') {
    return { results: (result.items ?? []) as Item[], total };
  }
  if (filters.type === 'class') {
    return { results: (result.classes ?? []) as Class[], total };
  }
  if (filters.type === 'creature') {
    return { results: (result.creatures ?? []) as Creature[], total };
  }
  if (filters.type === 'hazard') {
    return { results: (result.hazards ?? []) as Hazard[], total };
  }
  return { results: [], total: 0 };
}

export function useContentStudioSearch(args: {
  tab: ContentStudioTab;
  name: string;
  sourceIds: number[];
  subtype: ContentStudioSubtypeState;
  classes: Class[];
  ancestries: Ancestry[];
  archetypes: Archetype[];
  page: number;
  enabled: boolean;
}) {
  const [debouncedName] = useDebouncedValue(args.name, DEBOUNCE_DELAY);

  const nestedClassTraitId = useMemo(() => {
    // Classes tab uses ClassBrowsePanel; search-data is not used there.
    if (args.tab === 'classes') return null;
    const cls = args.classes.find((c) => c.id === args.subtype.classId);
    return cls?.trait_id ?? null;
  }, [args.tab, args.subtype.classId, args.classes]);

  // Actions only: small corpus (~100s). Feats are server-paginated (~11k total).
  const clientBucketed = args.tab === 'actions';
  const pageSize = CONTENT_STUDIO_PAGE_SIZE;

  const featCategoryTraitIds = useMemo(() => {
    if (args.tab !== 'feats') return undefined;
    const cat = args.subtype.featCategory;
    if (cat === 'class') {
      return args.classes.map((c) => c.trait_id).filter((id): id is number => id != null);
    }
    if (cat === 'ancestry') {
      return args.ancestries.map((a) => a.trait_id).filter((id): id is number => id != null);
    }
    if (cat === 'archetype') {
      return args.archetypes.map((a) => a.trait_id).filter((id): id is number => id != null);
    }
    return undefined;
  }, [args.tab, args.subtype.featCategory, args.classes, args.ancestries, args.archetypes]);

  // Actions: exclude bucket from server key (client filters). Feats: include category.
  const serverSubtype = useMemo(() => {
    if (args.tab === 'actions') {
      return { ...args.subtype, actionBucket: 'basic' as const };
    }
    return args.subtype;
  }, [args.tab, args.subtype]);

  const filters = useMemo(() => {
    const base = buildSearchFilters({
      tab: args.tab,
      name: debouncedName,
      sourceIds: args.sourceIds,
      subtype: serverSubtype,
      nestedClassTraitId,
      featCategoryTraitIds,
    });
    if (!base) return null;
    return {
      ...base,
      limit: clientBucketed ? -1 : pageSize,
      offset: clientBucketed ? 0 : args.page * pageSize,
    };
  }, [
    args.tab,
    debouncedName,
    args.sourceIds,
    serverSubtype,
    nestedClassTraitId,
    featCategoryTraitIds,
    args.page,
    clientBucketed,
    pageSize,
  ]);

  const query = useQuery({
    queryKey: ['content-studio-search', filters],
    enabled: args.enabled && !!filters && args.sourceIds.length > 0,
    staleTime: SEARCH_STALE_MS,
    // No keepPreviousData across tabs — that kept the ~4MB feats dump mounted while switching.
    queryFn: async () => {
      if (!filters) return { results: [] as ContentStudioResult[], total: 0 };
      return runSearch(filters);
    },
  });

  // Feat category tab counts: one cheap limit:1 total per category (cached 5 min).
  const featCountsQuery = useQuery({
    queryKey: [
      'content-studio-feat-counts',
      args.sourceIds,
      debouncedName,
      args.subtype.featLevelMin,
      args.subtype.featLevelMax,
      args.classes.map((c) => c.trait_id),
      args.ancestries.map((a) => a.trait_id),
      args.archetypes.map((a) => a.trait_id),
    ],
    enabled: args.enabled && args.tab === 'feats' && args.sourceIds.length > 0,
    staleTime: SEARCH_STALE_MS,
    queryFn: async () => {
      const classIds = args.classes.map((c) => c.trait_id).filter((id): id is number => id != null);
      const ancestryIds = args.ancestries.map((a) => a.trait_id).filter((id): id is number => id != null);
      const archetypeIds = args.archetypes.map((a) => a.trait_id).filter((id): id is number => id != null);
      const counts = {} as Record<FeatCategory, number>;
      await Promise.all(
        FEAT_CATEGORY_TABS.map(async (tab) => {
          const subtype: ContentStudioSubtypeState = {
            ...args.subtype,
            featCategory: tab.id,
            classTraitId: null,
            ancestryTraitId: null,
            archetypeTraitId: null,
          };
          let traitIds: number[] | undefined;
          if (tab.id === 'class') traitIds = classIds;
          else if (tab.id === 'ancestry') traitIds = ancestryIds;
          else if (tab.id === 'archetype') traitIds = archetypeIds;
          const f = buildSearchFilters({
            tab: 'feats',
            name: debouncedName,
            sourceIds: args.sourceIds,
            subtype,
            featCategoryTraitIds: traitIds,
          });
          if (!f) {
            counts[tab.id] = 0;
            return;
          }
          const { total } = await runSearch({ ...f, limit: 1, offset: 0 });
          counts[tab.id] = total;
        })
      );
      return counts;
    },
  });

  const allResults = query.data?.results ?? [];

  const actionBucketCounts = useMemo(() => {
    if (args.tab !== 'actions') return null;
    const actions = allResults as AbilityBlock[];
    const counts = {} as Record<ActionBucket, number>;
    for (const tab of ACTION_BUCKET_TABS) {
      counts[tab.id] = actions.filter((row) => matchesActionBucket(row, tab.id)).length;
    }
    return counts;
  }, [args.tab, allResults]);

  const bucketResults = useMemo(() => {
    if (args.tab === 'actions') {
      return (allResults as AbilityBlock[]).filter((row) =>
        matchesActionBucket(row, args.subtype.actionBucket)
      );
    }
    return allResults;
  }, [args.tab, allResults, args.subtype.actionBucket]);

  const results = useMemo(() => {
    if (!clientBucketed) return allResults;
    const start = args.page * pageSize;
    return bucketResults.slice(start, start + pageSize);
  }, [clientBucketed, allResults, bucketResults, args.page, pageSize]);

  const total = clientBucketed ? bucketResults.length : (query.data?.total ?? results.length);

  return {
    results,
    total,
    page: args.page,
    pageSize,
    showPager: true,
    actionBucketCounts,
    featCategoryCounts: args.tab === 'feats' ? (featCountsQuery.data ?? null) : null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    filtersReady: !!filters,
    missingNestedPick: !filters && args.tab !== 'actions' && args.tab !== 'feats',
  };
}

export function sourceByIdMap(sources: ContentSource[]): Map<number, ContentSource> {
  return new Map(sources.map((s) => [s.id, s]));
}

/** Per-main-tab UI place (page + which result cards / class levels are open). */
export type ContentStudioTabPlace = {
  page: number;
  expandedIds: number[];
  /** Classes tab: open level accordion values (e.g. `"5"`). */
  openLevels: string[];
};

export function defaultTabPlaces(): Record<ContentStudioTab, ContentStudioTabPlace> {
  const empty = (): ContentStudioTabPlace => ({ page: 0, expandedIds: [], openLevels: [] });
  return {
    actions: empty(),
    spells: empty(),
    feats: empty(),
    classes: empty(),
    equipment: empty(),
    monsters: empty(),
    hazards: empty(),
  };
}
