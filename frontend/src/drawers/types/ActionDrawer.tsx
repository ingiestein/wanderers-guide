import { characterState } from '@atoms/characterAtoms';
import { drawerState } from '@atoms/navAtoms';
import { ActionSymbol } from '@common/Actions';
import { DisplayIcon } from '@common/IconDisplay';
import IndentedText from '@common/IndentedText';
import RichText from '@common/RichText';
import TraitsDisplay from '@common/TraitsDisplay';
import { TEXT_INDENT_AMOUNT } from '@constants/data';
import { isAbilityBlockVisible } from '@content/content-hidden';
import {
  fetchContentById,
  fetchContentSources,
  fetchTraitByName,
  getDefaultSources,
} from '@content/content-store';
import ShowInjectedText from '@drawers/ShowInjectedText';
import ShowOperationsButton from '@drawers/ShowOperationsButton';
import {
  Title,
  Text,
  Image,
  Loader,
  Group,
  Divider,
  Stack,
  Box,
  Flex,
  List,
  Anchor,
  Button,
  ScrollArea,
  ActionIcon,
} from '@mantine/core';
import {
  determineFilteredSelectionList,
  getSelectedOptions,
  ObjectWithUUID,
  sortObjectByName,
} from '@operations/operation-utils';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import DrawerLoadState from '@drawers/DrawerLoadState';
import { makeRequest } from '@requests/request-manager';
import { AbilityBlock, AbilityBlockType } from '@schemas/content';
import {
  Operation,
  OperationSelect,
  OperationSelectFilters,
  OperationSelectFiltersAbilityBlock,
  OperationSelectOptionCustom,
} from '@schemas/operations';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { toLabel } from '@utils/strings';
import { instanceOfOperationSelectOptionCustom } from '@utils/type-fixing';
import { isNumber } from 'lodash-es';
import { useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';

/** Flat lists stay short; level columns page through results. */
const SELECTION_DISPLAY_LIMIT = 25;
/** Fixed column width so pager arrows stay put. */
const LEVEL_COLUMN_WIDTH = 260;
/** Max feats visible per level column before paging with left/right arrows. */
const LEVEL_COLUMN_PAGE_SIZE = 10;
const LEVEL_COLUMN_PAGER_WIDTH = 92;

export function ActionDrawerTitle(props: { data: { id?: number; action?: AbilityBlock; onSelect?: () => void } }) {
  const id = props.data.id;

  const [_drawer, openDrawer] = useAtom(drawerState);

  const {
    data: _action,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [`find-action-${id}`, { id }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore

      const [_key, { id }] = queryKey;
      return await fetchContentById<AbilityBlock>('ability-block', id);
    },
    enabled: !!id,
  });
  // Prefer network so a slim list-row placeholder can upgrade to the full record.
  const action = _action ?? props.data.action;

  return (
    <>
      {action && (
        <Group justify='space-between' wrap='nowrap'>
          <Group wrap='nowrap' gap={10}>
            <Box>
              <Title order={3}>{toLabel(action.name)}</Title>
            </Box>
            <Box>
              <ActionSymbol cost={action.actions} size={'2.1rem'} />
            </Box>
          </Group>
          {props.data.onSelect ? (
            <Button
              variant='filled'
              radius='xl'
              mb={5}
              size='compact-sm'
              onClick={() => {
                props.data.onSelect?.();
                openDrawer(null);
              }}
            >
              Select
            </Button>
          ) : (
            <Text style={{ textWrap: 'nowrap' }}>{action.type !== 'action' ? toLabel(action.type) : ''}</Text>
          )}
        </Group>
      )}
    </>
  );
}

export function ActionDrawerContent(props: { data: { id?: number; action?: AbilityBlock; showOperations?: boolean } }) {
  const id = props.data.id;

  const {
    data: _action,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [`find-action-${id}`, { id }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore

      const [_key, { id }] = queryKey;
      return await fetchContentById<AbilityBlock>('ability-block', id);
    },
    enabled: !!id,
  });
  // Slim search rows lack description — wait for by-id (or a full in-memory record).
  const action = _action ?? (props.data.action?.description != null ? props.data.action : undefined);

  if (!action) {
    return <DrawerLoadState loading={isFetching} onRetry={refetch} />;
  }

  const hasTopSection =
    (action.prerequisites && action.prerequisites.length > 0) ||
    action.frequency ||
    action.trigger ||
    action.cost ||
    action.requirements ||
    action.access;

  return (
    <Box>
      <DisplayIcon strValue={action.meta_data?.image_url} />
      <Box>
        {/* Note: Can't use a Stack here as it breaks the floating image */}
        <Box pb={2}>
          <TraitsDisplay
            traitIds={action.traits ?? []}
            rarity={action.rarity}
            availability={action.availability ?? undefined}
            skill={action.meta_data?.skill}
            interactable
          />
        </Box>
        {action.prerequisites && action.prerequisites.length > 0 && (
          <IndentedText ta='justify'>
            <Text fw={600} c='gray.2' span>
              Prerequisites
            </Text>{' '}
            {action.prerequisites.join(', ')}
          </IndentedText>
        )}
        {action.frequency && (
          <IndentedText ta='justify'>
            <Text fw={600} c='gray.2' span>
              Frequency
            </Text>{' '}
            {action.frequency}
          </IndentedText>
        )}
        {action.trigger && (
          <IndentedText ta='justify'>
            <Text fw={600} c='gray.2' span>
              Trigger
            </Text>{' '}
            <RichText span>{action.trigger}</RichText>
          </IndentedText>
        )}
        {action.cost && (
          <IndentedText ta='justify'>
            <Text fw={600} c='gray.2' span>
              Cost
            </Text>{' '}
            <RichText span>{action.cost}</RichText>
          </IndentedText>
        )}
        {action.requirements && (
          <IndentedText ta='justify'>
            <Text fw={600} c='gray.2' span>
              Requirements
            </Text>{' '}
            <RichText span>{action.requirements}</RichText>
          </IndentedText>
        )}
        {action.access && (
          <IndentedText ta='justify'>
            <Text fw={600} c='gray.2' span>
              Access
            </Text>{' '}
            {action.access}
          </IndentedText>
        )}
        {hasTopSection && <Divider />}
        <RichText ta='justify'>{action.description}</RichText>
        {action.special && (
          <Text ta='justify' style={{ textIndent: TEXT_INDENT_AMOUNT }}>
            <Text fw={600} c='gray.2' span>
              Special
            </Text>{' '}
            <RichText span>{action.special}</RichText>
          </Text>
        )}
      </Box>
      <ShowInjectedText varId='CHARACTER' type='action' id={action.id} />
      <DisplayOperationSelectionOptions operations={action.operations ?? undefined} />
      {props.data.showOperations && (
        <ShowOperationsButton name={action.name} operations={action.operations ?? undefined} />
      )}
    </Box>
  );
}

export function DisplayOperationSelectionOptions(props: { operations?: Operation[] | undefined }) {
  const operations = (props.operations ?? []).filter(
    (op) => op.type === 'select' && ['CUSTOM', 'ABILITY_BLOCK'].includes(op.data.optionType)
  ) as OperationSelect[];
  if (operations.length === 0) return null;

  return (
    <Box>
      <Divider mt={5} />
      <Stack gap='sm'>
        {operations.map((op) => (
          <DisplayOperationSelection key={op.id} op={op} />
        ))}
      </Stack>
    </Box>
  );
}

function optionLabel(option: OperationSelectOptionCustom | ObjectWithUUID): string {
  return instanceOfOperationSelectOptionCustom(option) ? option.title : option.name;
}

/** Trait + level filters that search-data can page without loading the full dump. */
function canLazyPageAbilityBlockFilters(
  filters: OperationSelectFilters | undefined
): filters is OperationSelectFiltersAbilityBlock {
  if (!filters || filters.type !== 'ABILITY_BLOCK') return false;
  if (typeof filters.level?.max !== 'number') return false;
  if (filters.skill) return false;
  if (filters.isFromClass || filters.isFromAncestry || filters.isFromArchetype) return false;
  if (filters.excludedTraits?.length) return false;
  return true;
}

async function resolveTraitIds(traits: Array<string | number> | undefined): Promise<number[]> {
  if (!traits?.length) return [];
  const resolved = await Promise.all(
    traits.map(async (t) => {
      if (isNumber(t)) return t;
      const row = await fetchTraitByName(t);
      return row?.id ?? null;
    })
  );
  return resolved.filter((id): id is number => id != null);
}

/**
 * Content Studio sets PAGE to `'ALL-PUBLIC'` (a sentinel), not an id list.
 * search-data needs real ids — resolve sentinels via fetchContentSources.
 */
async function resolveSourceIds(): Promise<number[]> {
  const scope = getDefaultSources('PAGE');
  if (Array.isArray(scope)) return scope.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (scope == null) return [];
  const sources = await fetchContentSources(scope);
  return sources.map((s) => s.id);
}

function toSelectOption(block: AbilityBlock): ObjectWithUUID {
  return {
    ...block,
    _select_uuid: `${block.id}`,
    _content_type: 'ability-block',
  };
}

function LevelColumnHeader(props: {
  level: number;
  total: number | null;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const needsPager = (props.total ?? 0) > LEVEL_COLUMN_PAGE_SIZE;
  const start = props.page * LEVEL_COLUMN_PAGE_SIZE;
  return (
    <Group justify='space-between' align='center' gap={4} mb={6} wrap='nowrap'>
      <Text fz='sm' fw={700} c='gray.2' style={{ minWidth: 0, flex: 1 }} truncate>
        Level {props.level}
        {props.total != null ? (
          <Text span fz='xs' c='dimmed' fw={500}>
            {' '}
            ({props.total})
          </Text>
        ) : null}
      </Text>
      <Group
        gap={2}
        wrap='nowrap'
        w={LEVEL_COLUMN_PAGER_WIDTH}
        justify='flex-end'
        style={{ visibility: needsPager ? 'visible' : 'hidden' }}
      >
        <ActionIcon
          size='xs'
          variant='subtle'
          color='gray'
          aria-label={`Previous feats for level ${props.level}`}
          disabled={props.page <= 0}
          onClick={() => props.onPageChange(Math.max(0, props.page - 1))}
        >
          <IconChevronLeft size={14} />
        </ActionIcon>
        <Text fz={10} c='dimmed' style={{ whiteSpace: 'nowrap' }}>
          {props.total == null
            ? '…'
            : `${start + 1}–${Math.min(start + LEVEL_COLUMN_PAGE_SIZE, props.total)}`}
        </Text>
        <ActionIcon
          size='xs'
          variant='subtle'
          color='gray'
          aria-label={`Next feats for level ${props.level}`}
          disabled={props.page >= props.pageCount - 1}
          onClick={() => props.onPageChange(Math.min(props.pageCount - 1, props.page + 1))}
        >
          <IconChevronRight size={14} />
        </ActionIcon>
      </Group>
    </Group>
  );
}

/** In-memory page slice (fallback when search-data paging isn't available). */
function LevelFeatColumn(props: {
  level: number;
  items: ObjectWithUUID[];
  onOpen: (option: ObjectWithUUID) => void;
  selectedSuffix: (option: ObjectWithUUID) => string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(props.items.length / LEVEL_COLUMN_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * LEVEL_COLUMN_PAGE_SIZE;
  const visible = props.items.slice(start, start + LEVEL_COLUMN_PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [props.items.length, props.level]);

  return (
    <Box w={LEVEL_COLUMN_WIDTH} style={{ flexShrink: 0 }}>
      <LevelColumnHeader
        level={props.level}
        total={props.items.length}
        page={safePage}
        pageCount={pageCount}
        onPageChange={setPage}
      />
      <Stack gap={4}>
        {visible.map((option) => (
          <Anchor
            key={option.id}
            fz='sm'
            onClick={() => props.onOpen(option)}
            style={{ lineHeight: 1.35 }}
          >
            {optionLabel(option)}
            {props.selectedSuffix(option)}
          </Anchor>
        ))}
      </Stack>
    </Box>
  );
}

type LevelPageResult = { items: ObjectWithUUID[]; total: number };

function selectionLevelPageKey(
  traitIds: number[],
  abType: AbilityBlockType,
  level: number,
  page: number,
  sourceIds: number[]
) {
  return ['selection-level-page', traitIds, abType, level, page, sourceIds] as const;
}

async function fetchSelectionLevelPage(args: {
  traitIds: number[];
  abType: AbilityBlockType;
  level: number;
  page: number;
  sourceIds: number[];
}): Promise<LevelPageResult> {
  const result = await makeRequest<Record<string, unknown>>('search-data', {
    is_advanced: true,
    type: 'ability-block',
    ab_type: args.abType,
    traits: args.traitIds,
    level_min: args.level,
    level_max: args.level,
    // Omit when empty so the local studio searches the full corpus.
    content_sources: args.sourceIds.length > 0 ? args.sourceIds : undefined,
    limit: LEVEL_COLUMN_PAGE_SIZE,
    offset: args.page * LEVEL_COLUMN_PAGE_SIZE,
  });
  if (!result) {
    throw new Error('search-data returned no data for selection level page');
  }
  const rows = ((result.ability_blocks ?? []) as AbilityBlock[])
    .filter((b) => isAbilityBlockVisible('CHARACTER', b))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map(toSelectOption);
  const total = typeof result.total === 'number' ? result.total : rows.length;
  return { items: rows, total };
}

/**
 * Lazy level column: only fetches the current page of 10 via search-data.
 * Page 0 is usually prefetched; further pages load when the user hits the arrows.
 */
function LazyLevelFeatColumn(props: {
  level: number;
  traitIds: number[];
  abType: AbilityBlockType;
  sourceIds: number[];
  onOpen: (option: ObjectWithUUID) => void;
  selectedSuffix: (option: ObjectWithUUID) => string;
}) {
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: selectionLevelPageKey(
      props.traitIds,
      props.abType,
      props.level,
      page,
      props.sourceIds
    ),
    enabled: props.sourceIds.length > 0 && props.traitIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: () =>
      fetchSelectionLevelPage({
        traitIds: props.traitIds,
        abType: props.abType,
        level: props.level,
        page,
        sourceIds: props.sourceIds,
      }),
  });

  const total = query.data?.total ?? null;
  const pageCount = Math.max(1, Math.ceil((total ?? 1) / LEVEL_COLUMN_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const items = query.data?.items ?? [];

  return (
    <Box w={LEVEL_COLUMN_WIDTH} style={{ flexShrink: 0 }}>
      <LevelColumnHeader
        level={props.level}
        total={total}
        page={safePage}
        pageCount={pageCount}
        onPageChange={setPage}
      />
      {query.isLoading && items.length === 0 ? (
        <Group justify='center' py='sm'>
          <Loader size='xs' type='dots' />
        </Group>
      ) : (
        <Stack gap={4} style={{ opacity: query.isFetching ? 0.65 : 1 }}>
          {items.map((option) => (
            <Anchor
              key={option.id}
              fz='sm'
              onClick={() => props.onOpen(option)}
              style={{ lineHeight: 1.35 }}
            >
              {optionLabel(option)}
              {props.selectedSuffix(option)}
            </Anchor>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Group ability-block options by feat/feature level for column layout. */
function groupAbilityBlocksByLevel(
  options: ObjectWithUUID[]
): { level: number; items: ObjectWithUUID[] }[] | null {
  const leveled = options.filter(
    (o) => o._content_type === 'ability-block' && typeof (o as AbilityBlock).level === 'number'
  );
  if (leveled.length === 0 || leveled.length < options.length) return null;

  const byLevel = new Map<number, ObjectWithUUID[]>();
  for (const option of leveled) {
    const level = (option as AbilityBlock).level as number;
    const bucket = byLevel.get(level);
    if (bucket) bucket.push(option);
    else byLevel.set(level, [option]);
  }
  if (byLevel.size < 2) return null;

  return [...byLevel.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([level, items]) => ({
      level,
      items: items.toSorted(sortObjectByName),
    }));
}

export function DisplayOperationSelection(props: { op: OperationSelect }) {
  const op = props.op;
  const [_drawer, openDrawer] = useAtom(drawerState);
  const character = useAtomValue(characterState);

  const filters = op.data.optionsFilters as OperationSelectFilters | undefined;
  const useLazyColumns =
    op.data.modeType === 'FILTERED' &&
    op.data.optionType === 'ABILITY_BLOCK' &&
    canLazyPageAbilityBlockFilters(filters);

  const queryClient = useQueryClient();

  /** Resolve traits + prefetch page 0 for each candidate level (skip empty levels). */
  const lazyBootstrapQuery = useQuery({
    queryKey: ['selection-lazy-bootstrap', op.id, filters],
    enabled: useLazyColumns,
    staleTime: 60_000,
    queryFn: async () => {
      const f = filters as OperationSelectFiltersAbilityBlock;
      const [traitIds, sourceIds] = await Promise.all([resolveTraitIds(f.traits), resolveSourceIds()]);
      const abType = (f.abilityBlockType ?? 'feat') as AbilityBlockType;
      const maxLevel = f.level.max as number;
      const minLevel = typeof f.level.min === 'number' ? f.level.min : 1;
      const candidates: number[] = [];
      for (let i = Math.max(1, minLevel); i <= maxLevel; i++) candidates.push(i);

      const pages = await Promise.all(
        candidates.map((level) =>
          fetchSelectionLevelPage({
            traitIds,
            abType,
            level,
            page: 0,
            sourceIds,
          }).then((page) => ({ level, page }))
        )
      );

      const levelsWithItems: number[] = [];
      for (const { level, page } of pages) {
        if (page.total <= 0) continue;
        levelsWithItems.push(level);
        queryClient.setQueryData(
          selectionLevelPageKey(traitIds, abType, level, 0, sourceIds),
          page
        );
      }

      return { traitIds, abType, sourceIds, levels: levelsWithItems };
    },
  });

  const [options, setOptions] = useState([] as OperationSelectOptionCustom[] | ObjectWithUUID[]);
  const [more, setMore] = useState(null as string | null);
  const [listLoading, setListLoading] = useState(!useLazyColumns);

  // Full-list path: used when lazy columns aren't applicable, or lazy bootstrap failed.
  const needsFullList = !useLazyColumns || lazyBootstrapQuery.isError;

  useEffect(() => {
    if (!needsFullList) {
      setListLoading(false);
      return;
    }

    let current = true;
    async function getOptions() {
      setListLoading(true);
      if (op.data.modeType === 'PREDEFINED') {
        if (!current) return;
        setOptions((op.data.optionsPredefined ?? []) as OperationSelectOptionCustom[]);
        setMore(null);
        setListLoading(false);
      } else {
        const ops = await determineFilteredSelectionList(
          op.data.optionType,
          op.id,
          (op.data.optionsFilters ?? []) as OperationSelectFilters
        );
        if (!current) return;
        ops.sort(sortObjectByName);

        const canColumnize =
          op.data.optionType === 'ABILITY_BLOCK' &&
          ops.some((o) => typeof (o as AbilityBlock).level === 'number') &&
          new Set(
            ops
              .map((o) => (o as AbilityBlock).level)
              .filter((level): level is number => typeof level === 'number')
          ).size > 1;

        if (!canColumnize && ops.length > SELECTION_DISPLAY_LIMIT) {
          setMore(`and ${ops.length - SELECTION_DISPLAY_LIMIT} more...`);
          ops.length = SELECTION_DISPLAY_LIMIT;
        } else {
          setMore(null);
        }
        setOptions(ops);
        setListLoading(false);
      }
    }
    void getOptions();
    return () => {
      current = false;
    };
  }, [op, needsFullList]);

  const [selectedOptions, setSelectedOptions] = useState<ObjectWithUUID[]>([]);
  useEffect(() => {
    let current = true;
    async function getSelection() {
      const selected = await getSelectedOptions(character, op);
      if (current) setSelectedOptions(selected);
    }
    void getSelection();
    return () => {
      current = false;
    };
  }, [character, op]);

  const levelColumns = useMemo(() => {
    if (useLazyColumns) return null;
    if (op.data.optionType !== 'ABILITY_BLOCK') return null;
    if (options.length === 0 || instanceOfOperationSelectOptionCustom(options[0])) return null;
    return groupAbilityBlocksByLevel(options as ObjectWithUUID[]);
  }, [op.data.optionType, options, useLazyColumns]);

  const openOption = (option: OperationSelectOptionCustom | ObjectWithUUID) => {
    openDrawer({
      type: instanceOfOperationSelectOptionCustom(option)
        ? 'generic'
        : option._content_type === 'ability-block'
          ? option.type
          : option._content_type,
      data: instanceOfOperationSelectOptionCustom(option)
        ? {
            title: option.title,
            description: option.description,
            operations: option.operations,
          }
        : { id: option?.id, action: option },
      extra: { addToHistory: true },
    });
  };

  const selectedSuffix = (option: OperationSelectOptionCustom | ObjectWithUUID) =>
    selectedOptions.some((selected) => selected.id === option.id) ? ' (Selected)' : '';

  // Lazy path failed → drop through to the full-list fallback below.
  const lazyReady = useLazyColumns && lazyBootstrapQuery.isSuccess && lazyBootstrapQuery.data;
  const lazyFailed = useLazyColumns && lazyBootstrapQuery.isError;

  if (useLazyColumns && !lazyFailed && !lazyReady) {
    return (
      <Box pt={5}>
        <Text fz='md' fw={600}>
          {op.data.title ?? 'Select an Option'}
        </Text>
        <Group justify='center' py='md'>
          <Loader size='sm' type='dots' />
        </Group>
      </Box>
    );
  }

  if (lazyReady) {
    const { traitIds, abType, sourceIds, levels } = lazyBootstrapQuery.data;
    if (traitIds.length === 0 || levels.length === 0) {
      // Nothing matched — still show the heading so the feature doesn't look broken.
      return (
        <Box pt={5}>
          <Text fz='md' fw={600}>
            {op.data.title ?? 'Select an Option'}
          </Text>
          <Text c='dimmed' size='sm'>
            No feats found for this selection.
          </Text>
        </Box>
      );
    }

    return (
      <Box pt={5}>
        <Text fz='md' fw={600}>
          {op.data.title ?? 'Select an Option'}
        </Text>
        <ScrollArea type='hover' offsetScrollbars scrollbarSize={6} mt={4}>
          <Group align='flex-start' gap='md' wrap='nowrap' pb={4}>
            {levels.map((level) => (
              <LazyLevelFeatColumn
                key={level}
                level={level}
                traitIds={traitIds}
                abType={abType}
                sourceIds={sourceIds}
                onOpen={openOption}
                selectedSuffix={selectedSuffix}
              />
            ))}
          </Group>
        </ScrollArea>
      </Box>
    );
  }

  if (listLoading) {
    return (
      <Box pt={5}>
        <Text fz='md' fw={600}>
          {op.data.title ?? 'Select an Option'}
        </Text>
        <Group justify='center' py='md'>
          <Loader size='sm' type='dots' />
        </Group>
      </Box>
    );
  }

  if (options.length === 0) {
    return null;
  }

  return (
    <Box pt={5}>
      <Text fz='md' fw={600}>
        {op.data.title ?? 'Select an Option'}
      </Text>
      {levelColumns ? (
        <ScrollArea type='hover' offsetScrollbars scrollbarSize={6} mt={4}>
          <Group align='flex-start' gap='md' wrap='nowrap' pb={4}>
            {levelColumns.map(({ level, items }) => (
              <LevelFeatColumn
                key={level}
                level={level}
                items={items}
                onOpen={openOption}
                selectedSuffix={selectedSuffix}
              />
            ))}
          </Group>
        </ScrollArea>
      ) : (
        <List>
          {options.map((option) => (
            <List.Item key={option.id}>
              <Anchor onClick={() => openOption(option)}>
                {optionLabel(option)}
                {selectedSuffix(option)}
              </Anchor>
            </List.Item>
          ))}
          {more === null ? null : <List.Item key='more'>{more}</List.Item>}
        </List>
      )}
    </Box>
  );
}
