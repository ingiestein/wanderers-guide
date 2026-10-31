/**
 * Local Content Studio — sheet-like browse (+ optional homebrew edit when signed in).
 * No auth gate: private tooling only, not a public product surface.
 */

import { userState } from '@atoms/userAtoms';
import BlurBox from '@common/BlurBox';
import { IMPRINT_BORDER_COLOR } from '@constants/data';
import { defineDefaultSources, fetchContentSources } from '@content/content-store';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  Group,
  MultiSelect,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeRequest } from '@requests/request-manager';
import type { AbilityBlockType, Ancestry, Archetype, Class, Trait } from '@schemas/content';
import { setPageTitle } from '@utils/document-change';
import { phoneQuery } from '@utils/mobile-responsive';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { ContentStudioEditModals, type EditTarget } from './EditActions';
import {
  DEFAULT_SUBTYPE_STATE,
  type ContentStudioSubtypeState,
  type ContentStudioTab,
  type OwnershipFilter,
  type SystemFilter,
} from './filters';
import { ClassBrowsePanel } from './ClassBrowsePanel';
import { ResultsList } from './ResultsList';
import { SubtypeToolbar } from './SubtypeToolbar';
import {
  defaultTabPlaces,
  sourceByIdMap,
  useContentStudioSearch,
  useContentStudioSources,
  type ContentStudioResult,
} from './useContentStudioSearch';

const TABS: { value: ContentStudioTab; label: string }[] = [
  { value: 'actions', label: 'Actions' },
  { value: 'spells', label: 'Spells' },
  { value: 'feats', label: 'Feats' },
  { value: 'classes', label: 'Classes' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'monsters', label: 'Monsters' },
  { value: 'hazards', label: 'Hazards' },
];

const BROWSE_ONLY_TABS = new Set<ContentStudioTab>(['monsters', 'hazards']);

function createAbilityType(tab: ContentStudioTab, subtype: ContentStudioSubtypeState): AbilityBlockType | undefined {
  if (tab === 'actions') return 'action';
  if (tab === 'feats') return 'feat';
  if (tab === 'classes') {
    return subtype.classSection === 'features' ? 'class-feature' : 'feat';
  }
  return undefined;
}

export function Component() {
  setPageTitle('Content Studio');
  const user = useAtomValue(userState);
  const isPhone = useMediaQuery(phoneQuery());
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<ContentStudioTab>('actions');
  const [name, setName] = useState('');
  const [system, setSystem] = useState<SystemFilter>('pathfinder');
  const [ownership, setOwnership] = useState<OwnershipFilter>('any');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [subtype, setSubtype] = useState<ContentStudioSubtypeState>(DEFAULT_SUBTYPE_STATE);
  // Per-tab page + expanded cards so switching tabs restores place.
  const [tabPlaces, setTabPlaces] = useState(defaultTabPlaces);
  const place = tabPlaces[tab];
  const page = place.page;
  const setPage = (next: number | ((p: number) => number)) => {
    setTabPlaces((prev) => {
      const cur = prev[tab];
      const page = typeof next === 'function' ? next(cur.page) : next;
      return { ...prev, [tab]: { ...cur, page } };
    });
  };
  const setExpandedIds = (next: number[] | ((ids: number[]) => number[])) => {
    setTabPlaces((prev) => {
      const cur = prev[tab];
      const expandedIds = typeof next === 'function' ? next(cur.expandedIds) : next;
      return { ...prev, [tab]: { ...cur, expandedIds } };
    });
  };
  const setOpenLevels = (next: string[] | ((levels: string[]) => string[])) => {
    setTabPlaces((prev) => {
      const cur = prev.classes;
      const openLevels = typeof next === 'function' ? next(cur.openLevels) : next;
      return { ...prev, classes: { ...cur, openLevels } };
    });
  };
  const [createSourceId, setCreateSourceId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget>({ mode: 'closed' });

  const { sources, allSources, isLoading: sourcesLoading } = useContentStudioSources(system, ownership);
  const sourcesById = useMemo(() => sourceByIdMap(allSources), [allSources]);
  const catalogSourceIds = useMemo(
    () => allSources.map((s) => s.id).toSorted((a, b) => a - b),
    [allSources]
  );

  // Slim id/name/trait_id catalogs via search-data (not find-* SELECT *).
  const catalogQuery = useQuery({
    queryKey: ['content-studio-catalog', catalogSourceIds],
    enabled: catalogSourceIds.length > 0,
    queryFn: async () => {
      const base = {
        is_advanced: true as const,
        content_sources: catalogSourceIds,
        limit: -1,
        offset: 0,
      };
      const [classesRes, ancestriesRes, archetypesRes, traitsRes] = await Promise.all([
        makeRequest<Record<string, unknown>>('search-data', { ...base, type: 'class' }),
        makeRequest<Record<string, unknown>>('search-data', { ...base, type: 'ancestry' }),
        makeRequest<Record<string, unknown>>('search-data', { ...base, type: 'archetype' }),
        // Local API accepts creature_trait; remote ignores unknown keys and returns all traits.
        makeRequest<Record<string, unknown>>('search-data', {
          ...base,
          type: 'trait',
          creature_trait: true,
        }),
      ]);
      return {
        classes: (classesRes?.classes ?? []) as Class[],
        ancestries: (ancestriesRes?.ancestries ?? []) as Ancestry[],
        archetypes: (archetypesRes?.archetypes ?? []) as Archetype[],
        traits: (traitsRes?.traits ?? []) as Trait[],
      };
    },
    staleTime: 1000 * 60 * 10,
  });

  const homebrewSourcesQuery = useQuery({
    queryKey: ['content-studio-homebrew-sources', user?.user_id],
    enabled: !!user?.user_id,
    queryFn: async () => {
      const all = await fetchContentSources('ALL-HOMEBREW-ACCESSIBLE');
      return all.filter((s) => s.user_id);
    },
    staleTime: 1000 * 60 * 5,
  });

  const classes = useMemo(
    () => (catalogQuery.data?.classes ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
    [catalogQuery.data?.classes]
  );
  const ancestries = useMemo(
    () => (catalogQuery.data?.ancestries ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
    [catalogQuery.data?.ancestries]
  );
  const archetypes = useMemo(
    () => (catalogQuery.data?.archetypes ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
    [catalogQuery.data?.archetypes]
  );
  /** Creature/hazard tag options — traits marked `meta_data.creature_trait` in the DB. */
  const creatureTraits = useMemo(
    () =>
      (catalogQuery.data?.traits ?? [])
        .filter((trait) => trait.meta_data?.creature_trait === true)
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [catalogQuery.data?.traits]
  );

  // Default class pick for Classes tab
  useEffect(() => {
    if (subtype.classId == null && classes.length > 0) {
      setSubtype((s) => ({ ...s, classId: classes[0].id }));
    }
  }, [classes, subtype.classId]);

  // Default homebrew create target
  useEffect(() => {
    const hb = homebrewSourcesQuery.data ?? [];
    if (!createSourceId && hb.length > 0) {
      setCreateSourceId(String(hb[0].id));
    }
  }, [homebrewSourcesQuery.data, createSourceId]);

  // Drawers fetch via content-store defaults. Use public official sources so
  // logged-out local mode never hits ALL-USER-ACCESSIBLE → get-user.
  useEffect(() => {
    defineDefaultSources('BOTH', 'ALL-PUBLIC');
  }, []);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const activeSourceIds = useMemo(() => {
    if (selectedSourceIds.length > 0) {
      return selectedSourceIds.map((id) => parseInt(id, 10));
    }
    return sources.map((s) => s.id);
  }, [selectedSourceIds, sources]);

  // Shared corpus change → reset every tab's page (expanded cards stay).
  useEffect(() => {
    setTabPlaces((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as ContentStudioTab[]) {
        next[key] = { ...next[key], page: 0 };
      }
      return next;
    });
  }, [name, system, ownership, selectedSourceIds]);

  // Subtype tweaks only reset the active tab's page (keep other tabs' place).
  useEffect(() => {
    setTabPlaces((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], page: 0 },
    }));
    // tab read from closure on purpose — switching tabs must not clear page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtype]);

  const search = useContentStudioSearch({
    tab,
    name,
    sourceIds: activeSourceIds,
    subtype,
    classes,
    ancestries,
    archetypes,
    page,
    enabled: tab !== 'classes' && !sourcesLoading && activeSourceIds.length > 0,
  });

  // Changing class clears expanded cards / open levels on the Classes panel.
  useEffect(() => {
    setTabPlaces((prev) => ({
      ...prev,
      classes: { ...prev.classes, expandedIds: [], openLevels: [], page: 0 },
    }));
  }, [subtype.classId]);

  const openCreate = () => {
    if (!createSourceId) return;
    setEditTarget({
      mode: 'create',
      tab,
      sourceId: parseInt(createSourceId, 10),
      abilityType: createAbilityType(tab, subtype),
    });
  };

  const openEdit = (row: ContentStudioResult) => {
    setEditTarget({
      mode: 'edit',
      tab,
      sourceId: row.content_source_id,
      row,
    });
  };

  const onSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ['content-studio-search'] });
    void queryClient.invalidateQueries({ queryKey: ['content-studio-class-level'] });
    void queryClient.invalidateQueries({ queryKey: ['content-studio-class-section-total'] });
    void queryClient.invalidateQueries({ queryKey: ['content-studio-class'] });
  };

  const sourceOptions = sources.map((s) => ({
    value: String(s.id),
    label: s.name,
  }));

  const homebrewOptions = (homebrewSourcesQuery.data ?? []).map((s) => ({
    value: String(s.id),
    label: s.name,
  }));

  return (
    <Center>
      <Box maw={1100} w='100%'>
        <BlurBox p='md'>
          <Stack gap='md'>
            <Group justify='space-between' align='flex-start' wrap='wrap'>
              <div>
                <Title order={2}>Content Studio</Title>
                <Text size='sm' c='dimmed'>
                  Local content browser. Use `npm run content-studio` for the no-Docker pipeline.
                </Text>
              </div>
              <Group gap='sm' wrap='wrap'>
                <Select
                  label='Create into'
                  w={220}
                  size='xs'
                  placeholder='Homebrew source'
                  data={homebrewOptions}
                  value={createSourceId}
                  onChange={setCreateSourceId}
                  searchable
                  disabled={homebrewOptions.length === 0}
                />
                <Button
                  size='xs'
                  mt={isPhone ? 0 : 22}
                  leftSection={<IconPlus size={14} />}
                  onClick={openCreate}
                  disabled={!createSourceId || BROWSE_ONLY_TABS.has(tab)}
                >
                  Create
                </Button>
              </Group>
            </Group>

            <Group gap='sm' align='flex-end' wrap='wrap'>
              <Select
                label='System'
                w={150}
                size='xs'
                data={[
                  { value: 'pathfinder', label: 'Pathfinder' },
                  { value: 'starfinder', label: 'Starfinder' },
                  { value: 'both', label: 'Both' },
                ]}
                value={system}
                onChange={(v) => {
                  setSystem((v as SystemFilter) || 'pathfinder');
                  setSelectedSourceIds([]);
                }}
                allowDeselect={false}
              />
              <Select
                label='Ownership'
                w={140}
                size='xs'
                data={[
                  { value: 'any', label: 'Any' },
                  { value: 'official', label: 'Official' },
                  { value: 'homebrew', label: 'Homebrew' },
                ]}
                value={ownership}
                onChange={(v) => {
                  setOwnership((v as OwnershipFilter) || 'any');
                  setSelectedSourceIds([]);
                }}
                allowDeselect={false}
              />
              <MultiSelect
                label='Sources'
                w={isPhone ? '100%' : 320}
                size='xs'
                placeholder={sourcesLoading ? 'Loading…' : 'All matching sources'}
                data={sourceOptions}
                value={selectedSourceIds}
                onChange={setSelectedSourceIds}
                searchable
                clearable
                maxDropdownHeight={280}
              />
              <TextInput
                ref={searchRef}
                label='Name'
                w={isPhone ? '100%' : 220}
                size='xs'
                placeholder='Search by name'
                leftSection={<IconSearch size={14} />}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                rightSection={
                  name ? (
                    <ActionIcon variant='subtle' size='sm' onClick={() => setName('')}>
                      <IconX size={14} />
                    </ActionIcon>
                  ) : null
                }
              />
            </Group>

            <Tabs
              color='dark.6'
              variant='pills'
              radius='xl'
              value={tab}
              onChange={(v) => {
                if (!v) return;
                setTab(v as ContentStudioTab);
              }}
            >
              <Tabs.List grow={!isPhone}>
                {TABS.map((t) => (
                  <Tabs.Tab
                    key={t.value}
                    value={t.value}
                    style={{
                      border: tab === t.value ? `1px solid ${IMPRINT_BORDER_COLOR}` : '1px solid transparent',
                    }}
                  >
                    {t.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>

            {tab !== 'actions' ? (
              <>
                <SubtypeToolbar
                  tab={tab}
                  subtype={subtype}
                  onChange={setSubtype}
                  classes={classes}
                  creatureTraits={creatureTraits}
                />
                <Divider />
              </>
            ) : null}

            {tab === 'classes' ? (
              <ClassBrowsePanel
                classId={subtype.classId}
                classes={classes}
                nameFilter={name}
                levelMin={subtype.classLevelMin}
                levelMax={subtype.classLevelMax}
                section={subtype.classSection}
                onSectionChange={(section) => {
                  setSubtype((s) => ({ ...s, classSection: section }));
                  setOpenLevels([]);
                }}
                expandedIds={tabPlaces.classes.expandedIds}
                onExpandedIdsChange={(ids) =>
                  setTabPlaces((prev) => ({
                    ...prev,
                    classes: { ...prev.classes, expandedIds: ids },
                  }))
                }
                openLevels={tabPlaces.classes.openLevels}
                onOpenLevelsChange={setOpenLevels}
                sourceIds={activeSourceIds}
                sourcesById={sourcesById}
                onEditHomebrew={openEdit}
              />
            ) : !search.filtersReady && search.missingNestedPick ? (
              <Text c='dimmed' size='sm'>
                Pick the nested filter above to search.
              </Text>
            ) : search.isError ? (
              <Text c='red' size='sm'>
                Search failed. Try again or adjust filters.
              </Text>
            ) : (
              <ResultsList
                tab={tab}
                results={search.results}
                sourcesById={sourcesById}
                actionBucket={subtype.actionBucket}
                onActionBucketChange={(bucket) => setSubtype((s) => ({ ...s, actionBucket: bucket }))}
                actionBucketCounts={search.actionBucketCounts}
                featCategory={subtype.featCategory}
                onFeatCategoryChange={(category) =>
                  setSubtype((s) => ({
                    ...s,
                    featCategory: category,
                    // Clear nested refine when leaving that subtype tab.
                    classTraitId: category === 'class' ? s.classTraitId : null,
                    ancestryTraitId: category === 'ancestry' ? s.ancestryTraitId : null,
                    archetypeTraitId: category === 'archetype' ? s.archetypeTraitId : null,
                  }))
                }
                featCategoryCounts={search.featCategoryCounts}
                classTraitId={subtype.classTraitId}
                ancestryTraitId={subtype.ancestryTraitId}
                archetypeTraitId={subtype.archetypeTraitId}
                onClassTraitIdChange={(traitId) => setSubtype((s) => ({ ...s, classTraitId: traitId }))}
                onAncestryTraitIdChange={(traitId) => setSubtype((s) => ({ ...s, ancestryTraitId: traitId }))}
                onArchetypeTraitIdChange={(traitId) => setSubtype((s) => ({ ...s, archetypeTraitId: traitId }))}
                classes={classes}
                ancestries={ancestries}
                archetypes={archetypes}
                isLoading={search.isLoading || sourcesLoading}
                onEditHomebrew={openEdit}
                showPager={search.showPager}
                page={search.page}
                pageSize={search.pageSize}
                total={search.total}
                onPageChange={setPage}
                expandedIds={place.expandedIds}
                onExpandedIdsChange={setExpandedIds}
              />
            )}
          </Stack>
        </BlurBox>

        <ContentStudioEditModals
          target={editTarget}
          onClose={() => setEditTarget({ mode: 'closed' })}
          onSaved={onSaved}
        />
      </Box>
    </Center>
  );
}
