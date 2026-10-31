/**
 * Classes tab body: selected class overview + Feats / Features by level.
 * Each level accordion loads its rows only when opened (short React Query cache).
 */

import { isAbilityBlockVisible } from '@content/content-hidden';
import { fetchContentById } from '@content/content-store';
import DrawerLoadState from '@drawers/DrawerLoadState';
import { ClassInitialOverview, ExpandableAbilityBlockRow } from '@drawers/types/ClassDrawer';
import {
  Accordion,
  Badge,
  Box,
  Divider,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IMPRINT_BORDER_COLOR } from '@constants/data';
import { makeRequest } from '@requests/request-manager';
import { useQuery } from '@tanstack/react-query';
import type { AbilityBlock, AbilityBlockType, Class, ContentSource } from '@schemas/content';
import { useEffect, useMemo } from 'react';
import type { ClassSection } from './filters';

/** Keep per-level class lists warm briefly after close / tab switch. */
const LEVEL_CACHE_MS = 90_000;

function levelsInRange(min: number, max: number): number[] {
  // Class feats/features start at 1 — the DB has none at level 0.
  const lo = Math.max(1, Math.min(min, max));
  const hi = Math.min(20, Math.max(min, max));
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

async function searchClassBlocks(args: {
  sourceIds: number[];
  traitId: number;
  abType: AbilityBlockType;
  levelMin: number;
  levelMax: number;
  name?: string;
}): Promise<AbilityBlock[]> {
  const result = await makeRequest<Record<string, unknown>>('search-data', {
    is_advanced: true,
    type: 'ability-block',
    ab_type: args.abType,
    traits: [args.traitId],
    level_min: args.levelMin,
    level_max: args.levelMax,
    name: args.name?.trim() || undefined,
    content_sources: args.sourceIds,
    limit: -1,
    offset: 0,
  });
  const rows = (result?.ability_blocks ?? []) as AbilityBlock[];
  return rows
    .filter((b) => isAbilityBlockVisible('CHARACTER', b))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export function ClassBrowsePanel(props: {
  classId: number | null;
  classes: Class[];
  nameFilter: string;
  levelMin: number;
  levelMax: number;
  section: ClassSection;
  onSectionChange: (section: ClassSection) => void;
  expandedIds: number[];
  onExpandedIdsChange: (ids: number[]) => void;
  /** Open level accordion values (e.g. "5") — persisted with tab place. */
  openLevels: string[];
  onOpenLevelsChange: (levels: string[]) => void;
  sourceIds: number[];
  sourcesById: Map<number, ContentSource>;
  onEditHomebrew: (row: AbilityBlock) => void;
}) {
  const catalogClass = props.classes.find((c) => c.id === props.classId) ?? null;
  const traitId = catalogClass?.trait_id ?? null;
  const classTraitIds = useMemo(
    () => new Set(props.classes.map((c) => c.trait_id).filter((id): id is number => id != null)),
    [props.classes]
  );
  const levels = useMemo(
    () => levelsInRange(props.levelMin, props.levelMax),
    [props.levelMin, props.levelMax]
  );

  const {
    data: fullClass,
    isFetching: classFetching,
    refetch: refetchClass,
  } = useQuery({
    queryKey: ['content-studio-class', props.classId],
    queryFn: async () =>
      props.classId == null ? null : await fetchContentById<Class>('class', props.classId),
    enabled: props.classId != null,
    staleTime: 1000 * 60 * 5,
  });

  const class_ = fullClass ?? (catalogClass?.description ? catalogClass : undefined);

  // Lightweight totals for tab labels (COUNT via limit:1).
  const featTotalQuery = useQuery({
    queryKey: [
      'content-studio-class-section-total',
      props.classId,
      traitId,
      'feat',
      props.levelMin,
      props.levelMax,
      props.nameFilter,
      props.sourceIds,
    ],
    enabled: traitId != null && props.sourceIds.length > 0,
    staleTime: LEVEL_CACHE_MS,
    gcTime: LEVEL_CACHE_MS,
    queryFn: async () => {
      const result = await makeRequest<Record<string, unknown>>('search-data', {
        is_advanced: true,
        type: 'ability-block',
        ab_type: 'feat',
        traits: [traitId!],
        level_min: props.levelMin,
        level_max: props.levelMax,
        name: props.nameFilter.trim() || undefined,
        content_sources: props.sourceIds,
        limit: 1,
        offset: 0,
      });
      return typeof result?.total === 'number' ? result.total : 0;
    },
  });

  const featureTotalQuery = useQuery({
    queryKey: [
      'content-studio-class-section-total',
      props.classId,
      traitId,
      'class-feature',
      props.levelMin,
      props.levelMax,
      props.nameFilter,
      props.sourceIds,
    ],
    enabled: traitId != null && props.sourceIds.length > 0,
    staleTime: LEVEL_CACHE_MS,
    gcTime: LEVEL_CACHE_MS,
    queryFn: async () => {
      const result = await makeRequest<Record<string, unknown>>('search-data', {
        is_advanced: true,
        type: 'ability-block',
        ab_type: 'class-feature',
        traits: [traitId!],
        level_min: props.levelMin,
        level_max: props.levelMax,
        name: props.nameFilter.trim() || undefined,
        content_sources: props.sourceIds,
        limit: 1,
        offset: 0,
      });
      return typeof result?.total === 'number' ? result.total : 0;
    },
  });

  if (props.classId == null) {
    return (
      <Text c='dimmed' size='sm'>
        Pick a class above to browse its features and feats.
      </Text>
    );
  }

  if (!class_) {
    return (
      <DrawerLoadState
        loading={classFetching}
        onRetry={() => {
          void refetchClass();
        }}
      />
    );
  }

  const source = props.sourcesById.get(class_.content_source_id);

  return (
    <Stack gap='md'>
      <Box>
        <Group justify='space-between' align='baseline' wrap='wrap' mb='xs'>
          <Title order={3}>{class_.name}</Title>
          <Text size='xs' c='dimmed'>
            {source?.name ?? 'Unknown source'} · #{class_.id}
          </Text>
        </Group>
        <ClassInitialOverview class_={class_} mode='READ' />
      </Box>

      <Divider />

      <Tabs
        color='dark.6'
        variant='pills'
        radius='xl'
        value={props.section}
        onChange={(v) => {
          if (v === 'feats' || v === 'features') props.onSectionChange(v);
        }}
      >
        <Tabs.List mb='sm'>
          <Tabs.Tab
            value='feats'
            style={{
              border: props.section === 'feats' ? `1px solid ${IMPRINT_BORDER_COLOR}` : '1px solid transparent',
            }}
          >
            Feats{featTotalQuery.data != null ? ` (${featTotalQuery.data})` : ''}
          </Tabs.Tab>
          <Tabs.Tab
            value='features'
            style={{
              border:
                props.section === 'features' ? `1px solid ${IMPRINT_BORDER_COLOR}` : '1px solid transparent',
            }}
          >
            Features{featureTotalQuery.data != null ? ` (${featureTotalQuery.data})` : ''}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value='feats'>
          {traitId != null ? (
            <ClassLevelAccordion
              classId={props.classId}
              traitId={traitId}
              classTraitIds={classTraitIds}
              abType='feat'
              levels={levels}
              nameFilter={props.nameFilter}
              sourceIds={props.sourceIds}
              openLevels={props.section === 'feats' ? props.openLevels : []}
              onOpenLevelsChange={props.onOpenLevelsChange}
              expandedIds={props.expandedIds}
              onExpandedIdsChange={props.onExpandedIdsChange}
              sourcesById={props.sourcesById}
              onEditHomebrew={props.onEditHomebrew}
              emptyLabel='No feats in this level range.'
            />
          ) : null}
        </Tabs.Panel>
        <Tabs.Panel value='features'>
          {traitId != null ? (
            <ClassLevelAccordion
              classId={props.classId}
              traitId={traitId}
              classTraitIds={classTraitIds}
              abType='class-feature'
              levels={levels}
              nameFilter={props.nameFilter}
              sourceIds={props.sourceIds}
              openLevels={props.section === 'features' ? props.openLevels : []}
              onOpenLevelsChange={props.onOpenLevelsChange}
              expandedIds={props.expandedIds}
              onExpandedIdsChange={props.onExpandedIdsChange}
              sourcesById={props.sourcesById}
              onEditHomebrew={props.onEditHomebrew}
              emptyLabel='No class features in this level range.'
            />
          ) : null}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function ClassLevelAccordion(props: {
  classId: number;
  traitId: number;
  classTraitIds: ReadonlySet<number>;
  abType: AbilityBlockType;
  levels: number[];
  nameFilter: string;
  sourceIds: number[];
  openLevels: string[];
  onOpenLevelsChange: (levels: string[]) => void;
  expandedIds: number[];
  onExpandedIdsChange: (ids: number[]) => void;
  sourcesById: Map<number, ContentSource>;
  onEditHomebrew: (row: AbilityBlock) => void;
  emptyLabel: string;
}) {
  const nameQ = props.nameFilter.trim();
  const expanded = new Set(props.expandedIds);

  // Name search: one query for the whole section, then group — still no per-card body until expand.
  const nameSearchQuery = useQuery({
    queryKey: [
      'content-studio-class-level',
      props.classId,
      props.traitId,
      props.abType,
      'name-search',
      nameQ,
      props.levels[0],
      props.levels[props.levels.length - 1],
      props.sourceIds,
    ],
    enabled: !!nameQ && props.sourceIds.length > 0,
    staleTime: LEVEL_CACHE_MS,
    gcTime: LEVEL_CACHE_MS,
    queryFn: () =>
      searchClassBlocks({
        sourceIds: props.sourceIds,
        traitId: props.traitId,
        abType: props.abType,
        levelMin: props.levels[0] ?? 1,
        levelMax: props.levels[props.levels.length - 1] ?? 20,
        name: nameQ,
      }),
  });

  const levelsWithNameHits = useMemo(() => {
    if (!nameQ || !nameSearchQuery.data) return props.levels;
    const hit = new Set(nameSearchQuery.data.map((b) => b.level ?? 0));
    return props.levels.filter((l) => hit.has(l));
  }, [nameQ, nameSearchQuery.data, props.levels]);

  // When searching by name, auto-open levels that have hits (once per result set).
  useEffect(() => {
    if (!nameQ || !nameSearchQuery.data) return;
    const hitLevels = [
      ...new Set(nameSearchQuery.data.map((b) => String(b.level ?? 0))),
    ].filter((l) => props.levels.some((n) => String(n) === l));
    if (hitLevels.length === 0) return;
    props.onOpenLevelsChange(hitLevels);
    // Only react to search results, not openLevels identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameQ, nameSearchQuery.dataUpdatedAt]);

  const displayLevels = nameQ ? levelsWithNameHits : props.levels;

  if (nameQ && nameSearchQuery.isLoading) {
    return (
      <Group justify='center' py='md'>
        <Loader size='sm' type='dots' />
      </Group>
    );
  }

  if (displayLevels.length === 0) {
    return (
      <Text c='dimmed' size='sm'>
        {props.emptyLabel}
      </Text>
    );
  }

  return (
    <Accordion
      multiple
      variant='separated'
      value={props.openLevels}
      onChange={(value) => props.onOpenLevelsChange(value)}
    >
      {displayLevels.map((level) => {
        const value = String(level);
        const isOpen = props.openLevels.includes(value);
        return (
          <Accordion.Item key={value} value={value}>
            <Accordion.Control>
              <Group justify='space-between' wrap='nowrap' pr='sm'>
                <Text fw={600}>Level {level}</Text>
                {isOpen ? (
                  <LevelCountBadge
                    classId={props.classId}
                    traitId={props.traitId}
                    abType={props.abType}
                    level={level}
                    nameFilter={nameQ}
                    sourceIds={props.sourceIds}
                    prefetched={
                      nameQ
                        ? nameSearchQuery.data?.filter((b) => (b.level ?? 0) === level)
                        : undefined
                    }
                  />
                ) : null}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {isOpen ? (
                <ClassLevelBlockList
                  classId={props.classId}
                  traitId={props.traitId}
                  classTraitIds={props.classTraitIds}
                  abType={props.abType}
                  level={level}
                  nameFilter={nameQ}
                  sourceIds={props.sourceIds}
                  prefetched={
                    nameQ
                      ? nameSearchQuery.data?.filter((b) => (b.level ?? 0) === level)
                      : undefined
                  }
                  expanded={expanded}
                  expandedIds={props.expandedIds}
                  onExpandedIdsChange={props.onExpandedIdsChange}
                  sourcesById={props.sourcesById}
                  onEditHomebrew={props.onEditHomebrew}
                />
              ) : null}
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion>
  );
}

function LevelCountBadge(props: {
  classId: number;
  traitId: number;
  abType: AbilityBlockType;
  level: number;
  nameFilter: string;
  sourceIds: number[];
  prefetched?: AbilityBlock[];
}) {
  const query = useClassLevelQuery(props);
  const count = props.prefetched?.length ?? query.data?.length;
  if (count == null) {
    return query.isFetching ? <Loader size={12} type='dots' /> : null;
  }
  return (
    <Badge size='sm' variant='outline' color='gray'>
      {count}
    </Badge>
  );
}

function useClassLevelQuery(args: {
  classId: number;
  traitId: number;
  abType: AbilityBlockType;
  level: number;
  nameFilter: string;
  sourceIds: number[];
  /** When set (name search), skip network — parent already loaded. */
  prefetched?: AbilityBlock[];
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [
      'content-studio-class-level',
      args.classId,
      args.traitId,
      args.abType,
      args.level,
      args.nameFilter,
      args.sourceIds,
    ],
    enabled:
      args.prefetched == null &&
      (args.enabled ?? true) &&
      args.sourceIds.length > 0,
    staleTime: LEVEL_CACHE_MS,
    gcTime: LEVEL_CACHE_MS,
    queryFn: () =>
      searchClassBlocks({
        sourceIds: args.sourceIds,
        traitId: args.traitId,
        abType: args.abType,
        levelMin: args.level,
        levelMax: args.level,
        name: args.nameFilter || undefined,
      }),
    initialData: args.prefetched,
    initialDataUpdatedAt: args.prefetched ? Date.now() : undefined,
  });
}

function ClassLevelBlockList(props: {
  classId: number;
  traitId: number;
  classTraitIds: ReadonlySet<number>;
  abType: AbilityBlockType;
  level: number;
  nameFilter: string;
  sourceIds: number[];
  prefetched?: AbilityBlock[];
  expanded: Set<number>;
  expandedIds: number[];
  onExpandedIdsChange: (ids: number[]) => void;
  sourcesById: Map<number, ContentSource>;
  onEditHomebrew: (row: AbilityBlock) => void;
}) {
  const query = useClassLevelQuery({
    classId: props.classId,
    traitId: props.traitId,
    abType: props.abType,
    level: props.level,
    nameFilter: props.nameFilter,
    sourceIds: props.sourceIds,
    prefetched: props.prefetched,
  });

  if (query.isLoading && !props.prefetched) {
    return (
      <Group justify='center' py='sm'>
        <Loader size='sm' type='dots' />
      </Group>
    );
  }

  if (query.isError) {
    return (
      <Text c='red' size='sm'>
        Failed to load this level.{' '}
        <Text span c='blue' style={{ cursor: 'pointer' }} onClick={() => void query.refetch()}>
          Retry
        </Text>
      </Text>
    );
  }

  const blocks = props.prefetched ?? query.data ?? [];
  if (blocks.length === 0) {
    return (
      <Text c='dimmed' size='sm' py='xs'>
        None at this level.
      </Text>
    );
  }

  const kind = props.abType === 'class-feature' ? 'class-feature' : 'feat';

  return (
    <Stack gap={0}>
      {blocks.map((block) => {
        const source = props.sourcesById.get(block.content_source_id);
        return (
          <Box key={block.id} style={{ position: 'relative' }}>
            <ExpandableAbilityBlockRow
              block={block}
              kind={kind}
              focusTraitId={props.traitId}
              classTraitIds={props.classTraitIds}
              expanded={props.expanded.has(block.id)}
              onExpandedChange={(next) => {
                if (next) {
                  if (props.expanded.has(block.id)) return;
                  props.onExpandedIdsChange([...props.expandedIds, block.id]);
                } else {
                  props.onExpandedIdsChange(props.expandedIds.filter((id) => id !== block.id));
                }
              }}
            />
            {source?.user_id ? (
              <Badge
                size='xs'
                variant='light'
                color='blue'
                style={{ position: 'absolute', top: 10, right: 10, cursor: 'pointer', zIndex: 1 }}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onEditHomebrew(block);
                }}
              >
                Edit
              </Badge>
            ) : null}
          </Box>
        );
      })}
    </Stack>
  );
}
