/**
 * Imprint-style result rows for Content Studio.
 * Click expands the card in place (no side drawer).
 */

import { ActionSymbol } from '@common/Actions';
import { EllipsisText } from '@common/EllipsisText';
import { IMPRINT_BG_COLOR, IMPRINT_BG_COLOR_2, IMPRINT_BORDER_COLOR } from '@constants/data';
import { ActionDrawerContent } from '@drawers/types/ActionDrawer';
import { ClassDrawerContent } from '@drawers/types/ClassDrawer';
import { ClassFeatureDrawerContent } from '@drawers/types/ClassFeatureDrawer';
import { CreatureDrawerContent } from '@drawers/types/CreatureDrawer';
import { FeatDrawerContent } from '@drawers/types/FeatDrawer';
import { HazardDrawerContent } from '@drawers/types/HazardDrawer';
import { ItemDrawerContent } from '@drawers/types/ItemDrawer';
import { SpellDrawerContent } from '@drawers/types/SpellDrawer';
import { ActionIcon, Badge, Box, Divider, Group, Select, Stack, Tabs, Text, UnstyledButton } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import { IconChevronDown, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
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
import type { ReactNode } from 'react';
import {
  ACTION_BUCKET_TABS,
  FEAT_CATEGORY_TABS,
  drawerTypeForResult,
  type ActionBucket,
  type ContentStudioTab,
  type FeatCategory,
} from './filters';
import type { ContentStudioResult } from './useContentStudioSearch';

function ResultDetail(props: { tab: ContentStudioTab; row: ContentStudioResult }) {
  const type = drawerTypeForResult(props.tab, props.row as { type?: string });
  const id = props.row.id;

  if (type === 'feat') {
    return <FeatDrawerContent data={{ id, feat: props.row as AbilityBlock }} />;
  }
  if (type === 'action') {
    return <ActionDrawerContent data={{ id, action: props.row as AbilityBlock }} />;
  }
  if (type === 'class-feature') {
    return <ClassFeatureDrawerContent data={{ id, classFeature: props.row as AbilityBlock }} />;
  }
  if (type === 'class') {
    return <ClassDrawerContent data={{ id, class_: props.row as Class }} />;
  }
  if (type === 'spell') {
    return <SpellDrawerContent data={{ id, spell: props.row as Spell }} />;
  }
  if (type === 'item') {
    return <ItemDrawerContent data={{ id, item: props.row as Item }} />;
  }
  if (type === 'creature') {
    // List rows are slim — pass id so the drawer loads the full creature.
    return <CreatureDrawerContent data={{ id, readOnly: true }} />;
  }
  if (type === 'hazard') {
    return <HazardDrawerContent data={{ id, sourceId: props.row.content_source_id }} />;
  }
  return (
    <Text size='sm' c='dimmed'>
      Unsupported content type.
    </Text>
  );
}

function ResultRow(props: {
  tab: ContentStudioTab;
  row: ContentStudioResult;
  source?: ContentSource;
  onEdit?: () => void;
  showEdit: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { hovered, ref } = useHover();
  const expanded = props.expanded;
  const row = props.row;
  const level =
    'rank' in row && row.rank !== undefined && row.rank !== null
      ? `Rank ${row.rank}`
      : 'level' in row && row.level !== undefined && row.level !== null
        ? `Level ${row.level}`
        : null;
  const actions = 'actions' in row ? (row as AbilityBlock).actions : null;
  const group = 'group' in row ? (row as Item).group : null;
  const rarity =
    props.tab === 'monsters' || props.tab === 'hazards'
      ? (row as Creature | Hazard).rarity
      : null;
  // Browse-only for monsters/hazards — create/edit modals are not wired yet.
  const showEdit = props.showEdit && props.tab !== 'monsters' && props.tab !== 'hazards';
  const isHomebrew = !!props.source?.user_id;

  return (
    <Box
      ref={ref}
      style={{
        borderRadius: 8,
        border: `1px solid ${IMPRINT_BORDER_COLOR}`,
        background: hovered || expanded ? IMPRINT_BG_COLOR_2 : IMPRINT_BG_COLOR,
        boxShadow: hovered || expanded ? '0 6px 24px rgba(0, 0, 0, 0.3)' : '0 2px 10px rgba(0, 0, 0, 0.18)',
        transition: '200ms ease',
        overflow: 'hidden',
      }}
    >
      <UnstyledButton
        onClick={() => props.onExpandedChange(!expanded)}
        w='100%'
        px='sm'
        py={8}
        style={{ display: 'block' }}
        aria-expanded={expanded}
      >
        <Group justify='space-between' wrap='nowrap' gap='sm'>
          <Group gap={8} wrap='nowrap' style={{ minWidth: 0, flex: 1 }}>
            <IconChevronDown
              size={16}
              style={{
                flexShrink: 0,
                opacity: 0.75,
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 150ms ease',
              }}
            />
            <EllipsisText fw={600} c='gray.2'>
              {row.name}
            </EllipsisText>
            {actions && <ActionSymbol cost={actions} />}
          </Group>
          <Group gap={6} wrap='nowrap'>
            {level && (
              <Badge size='sm' variant='light' color='gray'>
                {level}
              </Badge>
            )}
            {group && (
              <Badge size='sm' variant='outline' color='gray'>
                {group}
              </Badge>
            )}
            {rarity && rarity !== 'COMMON' && (
              <Badge size='sm' variant='outline' color='gray'>
                {rarity}
              </Badge>
            )}
            {isHomebrew && (
              <Badge size='sm' variant='filled' color='violet'>
                Homebrew
              </Badge>
            )}
            {showEdit && props.onEdit && (
              <Badge
                size='sm'
                variant='light'
                color='blue'
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onEdit?.();
                }}
              >
                Edit
              </Badge>
            )}
          </Group>
        </Group>
        <Text size='xs' c='dimmed' mt={2} pl={24}>
          {props.source?.name ?? 'Unknown source'} · #{row.id}
        </Text>
      </UnstyledButton>

      {expanded ? (
        <Box px='md' pb='md' pt={4}>
          <Divider mb='sm' color='dark.5' />
          {/* Content mounts on expand so by-id fetches run on demand. */}
          <ResultDetail tab={props.tab} row={row} />
        </Box>
      ) : null}
    </Box>
  );
}

function ResultsPager(props: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));
  const from = props.total === 0 ? 0 : props.page * props.pageSize + 1;
  const to = Math.min(props.total, (props.page + 1) * props.pageSize);

  return (
    <Group justify='space-between' wrap='nowrap'>
      <Text size='sm' c='dimmed'>
        {props.total === 0 ? '0 results' : `${from}–${to} of ${props.total}`}
      </Text>
      <Group gap={4} wrap='nowrap'>
        <ActionIcon
          variant='subtle'
          size='sm'
          aria-label='Previous page'
          disabled={props.page <= 0}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          <IconChevronLeft size={16} />
        </ActionIcon>
        <Text size='xs' c='dimmed' style={{ minWidth: 48, textAlign: 'center' }}>
          {props.page + 1} / {pageCount}
        </Text>
        <ActionIcon
          variant='subtle'
          size='sm'
          aria-label='Next page'
          disabled={props.page + 1 >= pageCount}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          <IconChevronRight size={16} />
        </ActionIcon>
      </Group>
    </Group>
  );
}

function ResultCards(props: {
  tab: ContentStudioTab;
  results: ContentStudioResult[];
  sourcesById: Map<number, ContentSource>;
  onEditHomebrew: (row: ContentStudioResult) => void;
  expandedIds: number[];
  onExpandedIdsChange: (ids: number[]) => void;
}) {
  const expanded = new Set(props.expandedIds);
  return (
    <Stack gap={8}>
      {props.results.map((row) => {
        const source = props.sourcesById.get(row.content_source_id);
        return (
          <ResultRow
            key={row.id}
            tab={props.tab}
            row={row}
            source={source}
            showEdit={!!source?.user_id}
            onEdit={() => props.onEditHomebrew(row)}
            expanded={expanded.has(row.id)}
            onExpandedChange={(next) => {
              if (next) {
                if (expanded.has(row.id)) return;
                props.onExpandedIdsChange([...props.expandedIds, row.id]);
              } else {
                props.onExpandedIdsChange(props.expandedIds.filter((id) => id !== row.id));
              }
            }}
          />
        );
      })}
    </Stack>
  );
}

function SubtypeTabResults(props: {
  tab: ContentStudioTab;
  tabs: { id: string; label: string }[];
  activeId: string;
  counts: Record<string, number> | null;
  onChange: (id: string) => void;
  refine?: ReactNode;
  results: ContentStudioResult[];
  sourcesById: Map<number, ContentSource>;
  onEditHomebrew: (row: ContentStudioResult) => void;
  showPager: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  expandedIds: number[];
  onExpandedIdsChange: (ids: number[]) => void;
}) {
  const emptyMessage = (
    <Text c='dimmed' size='sm'>
      No results. Adjust filters or search name.
    </Text>
  );

  return (
    <Stack gap='sm'>
      <Tabs
        color='dark.6'
        variant='pills'
        radius='xl'
        value={props.activeId}
        onChange={(v) => {
          if (!v) return;
          props.onChange(v);
        }}
      >
        <Tabs.List>
          {props.tabs.map((bucket) => {
            const count = props.counts?.[bucket.id] ?? 0;
            return (
              <Tabs.Tab
                key={bucket.id}
                value={bucket.id}
                style={{
                  border:
                    props.activeId === bucket.id
                      ? `1px solid ${IMPRINT_BORDER_COLOR}`
                      : '1px solid transparent',
                }}
              >
                {bucket.label} ({count})
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs>

      {props.refine}

      {props.results.length === 0 ? (
        emptyMessage
      ) : (
        <Stack gap={8}>
          {props.showPager ? (
            <ResultsPager
              page={props.page}
              pageSize={props.pageSize}
              total={props.total}
              onPageChange={props.onPageChange}
            />
          ) : null}
          <ResultCards
            tab={props.tab}
            results={props.results}
            sourcesById={props.sourcesById}
            onEditHomebrew={props.onEditHomebrew}
            expandedIds={props.expandedIds}
            onExpandedIdsChange={props.onExpandedIdsChange}
          />
          {props.showPager && props.total > props.pageSize ? (
            <ResultsPager
              page={props.page}
              pageSize={props.pageSize}
              total={props.total}
              onPageChange={props.onPageChange}
            />
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}

export function ResultsList(props: {
  tab: ContentStudioTab;
  results: ContentStudioResult[];
  sourcesById: Map<number, ContentSource>;
  actionBucket: ActionBucket;
  onActionBucketChange: (bucket: ActionBucket) => void;
  actionBucketCounts: Record<ActionBucket, number> | null;
  featCategory: FeatCategory;
  onFeatCategoryChange: (category: FeatCategory) => void;
  featCategoryCounts: Record<FeatCategory, number> | null;
  classTraitId: number | null;
  ancestryTraitId: number | null;
  archetypeTraitId: number | null;
  onClassTraitIdChange: (traitId: number | null) => void;
  onAncestryTraitIdChange: (traitId: number | null) => void;
  onArchetypeTraitIdChange: (traitId: number | null) => void;
  classes: Class[];
  ancestries: Ancestry[];
  archetypes: Archetype[];
  isLoading: boolean;
  onEditHomebrew: (row: ContentStudioResult) => void;
  showPager: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  expandedIds: number[];
  onExpandedIdsChange: (ids: number[]) => void;
}) {
  if (props.isLoading) {
    return (
      <Text c='dimmed' size='sm'>
        Searching…
      </Text>
    );
  }

  if (props.tab === 'actions') {
    return (
      <SubtypeTabResults
        tab={props.tab}
        tabs={ACTION_BUCKET_TABS}
        activeId={props.actionBucket}
        counts={props.actionBucketCounts}
        onChange={(id) => props.onActionBucketChange(id as ActionBucket)}
        results={props.results}
        sourcesById={props.sourcesById}
        onEditHomebrew={props.onEditHomebrew}
        showPager={props.showPager}
        page={props.page}
        pageSize={props.pageSize}
        total={props.total}
        onPageChange={props.onPageChange}
        expandedIds={props.expandedIds}
        onExpandedIdsChange={props.onExpandedIdsChange}
      />
    );
  }

  if (props.tab === 'feats') {
    // Select values must be unique — remaster duplicates share trait_id, so use record id.
    let refine: ReactNode = null;
    if (props.featCategory === 'class') {
      const selected = props.classes.find((c) => c.trait_id === props.classTraitId);
      refine = (
        <Select
          label='Class (optional)'
          w={240}
          size='xs'
          searchable
          clearable
          placeholder='All classes'
          data={props.classes.map((c) => ({ value: String(c.id), label: c.name }))}
          value={selected ? String(selected.id) : null}
          onChange={(v) => {
            const cls = v ? props.classes.find((c) => c.id === parseInt(v, 10)) : undefined;
            props.onClassTraitIdChange(cls?.trait_id ?? null);
          }}
        />
      );
    } else if (props.featCategory === 'ancestry') {
      const selected = props.ancestries.find((a) => a.trait_id === props.ancestryTraitId);
      refine = (
        <Select
          label='Ancestry (optional)'
          w={240}
          size='xs'
          searchable
          clearable
          placeholder='All ancestries'
          data={props.ancestries.map((a) => ({ value: String(a.id), label: a.name }))}
          value={selected ? String(selected.id) : null}
          onChange={(v) => {
            const ancestry = v ? props.ancestries.find((a) => a.id === parseInt(v, 10)) : undefined;
            props.onAncestryTraitIdChange(ancestry?.trait_id ?? null);
          }}
        />
      );
    } else if (props.featCategory === 'archetype') {
      const selected = props.archetypes.find((a) => a.trait_id === props.archetypeTraitId);
      refine = (
        <Select
          label='Archetype (optional)'
          w={240}
          size='xs'
          searchable
          clearable
          placeholder='All archetypes'
          data={props.archetypes.map((a) => ({ value: String(a.id), label: a.name }))}
          value={selected ? String(selected.id) : null}
          onChange={(v) => {
            const archetype = v ? props.archetypes.find((a) => a.id === parseInt(v, 10)) : undefined;
            props.onArchetypeTraitIdChange(archetype?.trait_id ?? null);
          }}
        />
      );
    }

    return (
      <SubtypeTabResults
        tab={props.tab}
        tabs={FEAT_CATEGORY_TABS}
        activeId={props.featCategory}
        counts={props.featCategoryCounts}
        onChange={(id) => props.onFeatCategoryChange(id as FeatCategory)}
        refine={refine}
        results={props.results}
        sourcesById={props.sourcesById}
        onEditHomebrew={props.onEditHomebrew}
        showPager={props.showPager}
        page={props.page}
        pageSize={props.pageSize}
        total={props.total}
        onPageChange={props.onPageChange}
        expandedIds={props.expandedIds}
        onExpandedIdsChange={props.onExpandedIdsChange}
      />
    );
  }

  if (props.results.length === 0) {
    return (
      <Text c='dimmed' size='sm'>
        No results. Adjust filters or search name.
      </Text>
    );
  }

  return (
    <Stack gap={8}>
      {props.showPager ? (
        <ResultsPager
          page={props.page}
          pageSize={props.pageSize}
          total={props.total}
          onPageChange={props.onPageChange}
        />
      ) : (
        <Text size='sm' c='dimmed'>
          {props.results.length} result{props.results.length === 1 ? '' : 's'}
        </Text>
      )}
      <ResultCards
        tab={props.tab}
        results={props.results}
        sourcesById={props.sourcesById}
        onEditHomebrew={props.onEditHomebrew}
        expandedIds={props.expandedIds}
        onExpandedIdsChange={props.onExpandedIdsChange}
      />
      {props.showPager && props.total > props.pageSize ? (
        <ResultsPager
          page={props.page}
          pageSize={props.pageSize}
          total={props.total}
          onPageChange={props.onPageChange}
        />
      ) : null}
    </Stack>
  );
}
