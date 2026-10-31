import { characterState } from '@atoms/characterAtoms';
import { drawerState } from '@atoms/navAtoms';
import { ActionSymbol } from '@common/Actions';
import IndentedText from '@common/IndentedText';
import RichText from '@common/RichText';
import TraitsDisplay from '@common/TraitsDisplay';
import { isAbilityBlockVisible } from '@content/content-hidden';
import { fetchContent, fetchContentById, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import ShowOperationsButton from '@drawers/ShowOperationsButton';
import { getMetadataOpenedDict } from '@drawers/drawer-utils';
import { ClassFeatureDrawerContent } from '@drawers/types/ClassFeatureDrawer';
import { FeatDrawerContent } from '@drawers/types/FeatDrawer';
import {
  Accordion,
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  HoverCard,
  Image,
  Loader,
  Stack,
  Text,
  Title,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core';
import { IMPRINT_BG_COLOR, IMPRINT_BORDER_COLOR } from '@constants/data';
import {
  getClassOperations,
  getClassSkillTrainings,
  getClassSkillTrainingsNum,
} from '@operations/operation-controller';
import { OperationResult } from '@schemas/operations';
import {
  IconBadgesFilled,
  IconChevronDown,
  IconEyeFilled,
  IconFlare,
  IconHeartHandshake,
  IconHelpCircle,
  IconShieldCheckeredFilled,
  IconSword,
  IconVocabulary,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import DrawerLoadState from '@drawers/DrawerLoadState';
import { AbilityBlock, Character, Class } from '@schemas/content';
import { OperationSelect } from '@schemas/operations';
import { getDisplay, getStatBlockDisplay, getStatDisplay } from '@variables/initial-stats-display';
import { getAllAttributeVariables, getAllSaveVariables, getAllSkillVariables } from '@variables/variable-manager';
import { groupBy } from 'lodash-es';
import { useState } from 'react';
import { useAtom } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';

/** Multi-class placeholder features that stamp every participating class trait on one row. */
const SHARED_CLASS_FEATURE_NAMES = new Set([
  'Skill Feat',
  'Skill Increase',
  'General Feat',
  'Attribute Boosts',
]);

/**
 * Shared placeholders (Skill Feat, Attribute Boosts, …) list every class trait on one row.
 * When browsing a single class, keep that class trait and drop the other class chips.
 */
export function traitsForClassContext(
  traits: number[] | undefined,
  focusTraitId: number | null | undefined,
  classTraitIds: ReadonlySet<number> | undefined,
  featureName?: string
): number[] {
  const list = traits ?? [];
  if (focusTraitId == null || !list.includes(focusTraitId)) return list;

  // Skill Feat / Attribute Boosts / etc. — show only the class being browsed.
  if (featureName && SHARED_CLASS_FEATURE_NAMES.has(featureName)) {
    return [focusTraitId];
  }

  if (!classTraitIds?.size) return list;
  return list.filter((t) => t === focusTraitId || !classTraitIds.has(t));
}

/**
 * Compact ability-block row that expands in-place (no nested drawer).
 * Full body loads only after expand.
 */
export function ExpandableAbilityBlockRow(props: {
  block: AbilityBlock;
  kind: 'feat' | 'class-feature';
  /** Controlled expand; omit for local toggle state. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  showLevel?: boolean;
  /** When set with classTraitIds, hide other classes' chips on shared features. */
  focusTraitId?: number | null;
  classTraitIds?: ReadonlySet<number>;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = props.expanded ?? localExpanded;
  const setExpanded = props.onExpandedChange ?? setLocalExpanded;
  const block = props.block;
  const traitIds = traitsForClassContext(
    block.traits,
    props.focusTraitId,
    props.classTraitIds,
    block.name
  );

  return (
    <Box
      style={{
        borderBottom: `1px solid ${IMPRINT_BORDER_COLOR}`,
        backgroundColor: expanded ? 'rgba(0,0,0,0.12)' : undefined,
        borderRadius: expanded ? 8 : undefined,
      }}
    >
      <UnstyledButton
        onClick={() => setExpanded(!expanded)}
        w='100%'
        px='sm'
        py='sm'
        style={{ display: 'block' }}
        aria-expanded={expanded}
      >
        <Group wrap='nowrap' justify='space-between' gap='sm'>
          <Group wrap='nowrap' gap={8} style={{ minWidth: 0, flex: 1 }}>
            <IconChevronDown
              size={16}
              style={{
                flexShrink: 0,
                opacity: 0.7,
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 150ms ease',
              }}
            />
            <Text fz='sm' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {block.name}
            </Text>
            <ActionSymbol cost={block.actions} gap={5} />
          </Group>
          <Group gap={6} wrap='nowrap'>
            {props.showLevel && block.level != null ? (
              <Badge size='sm' variant='light' color='gray'>
                Level {block.level}
              </Badge>
            ) : null}
            <TraitsDisplay
              justify='flex-end'
              size='xs'
              traitIds={traitIds}
              rarity={block.rarity}
              availability={block.availability ?? undefined}
            />
          </Group>
        </Group>
      </UnstyledButton>
      {expanded ? (
        <Box px='md' pb='md'>
          <Divider mb='sm' color='dark.5' />
          {props.kind === 'feat' ? (
            <FeatDrawerContent data={{ id: block.id }} />
          ) : (
            <ClassFeatureDrawerContent data={{ id: block.id }} />
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export function ClassDrawerTitle(props: { data: { id?: number; class_?: Class; onSelect?: () => void } }) {
  const id = props.data.id;

  const [_drawer, openDrawer] = useAtom(drawerState);

  const {
    data: _class_,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [`find-class-${id}`, { id }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore

      const [_key, { id }] = queryKey;
      return await fetchContentById<Class>('class', id);
    },
    enabled: !!id,
  });
  // Prefer network result so a slim list-row placeholder can upgrade to full record.
  const class_ = _class_ ?? props.data.class_;

  return (
    <>
      {class_ && (
        <Group justify='space-between' wrap='nowrap'>
          <Group wrap='nowrap' gap={10}>
            <Box>
              <Title order={3}>{class_.name}</Title>
            </Box>
          </Group>
          <TraitsDisplay traitIds={[]} rarity={class_.rarity} />
          {props.data.onSelect && (
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
              Select Class
            </Button>
          )}
        </Group>
      )}
    </>
  );
}

export function ClassDrawerContent(props: {
  data: { id?: number; class_?: Class; showOperations?: boolean };
  onMetadataChange?: (openedDict?: Record<string, string>) => void;
}) {
  const id = props.data.id;
  const placeholderTraitId = props.data.class_?.trait_id;

  const {
    data: fetchedClass,
    isFetching: classFetching,
    refetch: refetchClass,
  } = useQuery({
    queryKey: [`find-class-${id}`, { id }],
    queryFn: async () => (id === undefined ? null : await fetchContentById<Class>('class', id)),
    enabled: !!id,
  });
  // Overview needs description/operations — only use placeholder if it already has them.
  const class_ =
    fetchedClass ?? (props.data.class_?.description ? props.data.class_ : undefined);
  const traitId = fetchedClass?.trait_id ?? placeholderTraitId;

  const {
    data: abilityBlocks,
    isFetching: blocksFetching,
    refetch: refetchBlocks,
  } = useQuery({
    queryKey: [`find-class-ability-blocks-${id}`, { id, traitId, sources: getDefaultSourcesKey('INFO') }],
    queryFn: async () => {
      const sources = getDefaultSources('INFO');
      return fetchContent<AbilityBlock>('ability-block', {
        content_sources: sources,
        traits: [traitId!],
      });
    },
    enabled: traitId != null,
  });

  const classFeatures = groupBy(
    (abilityBlocks ?? []).filter(
      (block) => block.type === 'class-feature' && block.traits?.includes(traitId ?? -1)
    ),
    'level'
  );
  const feats = groupBy(
    (abilityBlocks ?? []).filter(
      (block) => block.type === 'feat' && block.traits?.includes(traitId ?? -1)
    ),
    'level'
  );

  const levelAccordionItems = (byLevel: Record<string, AbilityBlock[]>, kind: 'feat' | 'class-feature') =>
    Object.keys(byLevel)
      .toSorted((a, b) => Number(a) - Number(b))
      .map((level) => (
        <Accordion.Item key={`${kind}-${level}`} value={`${kind}-${level}`}>
          <Accordion.Control>
            <Group wrap='nowrap' justify='space-between' gap={0}>
              <Text c='gray.2' fw={700} fz='md'>
                Level {level}
              </Text>
              <Badge mr='sm' variant='outline' color='gray.5' size='sm'>
                <Text c='gray.2' span inherit>
                  {byLevel[level].filter((block) => isAbilityBlockVisible('CHARACTER', block)).length}
                </Text>
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel
            styles={{
              content: {
                padding: 0,
              },
            }}
          >
            <Stack gap={0}>
              <Divider color='dark.6' />
              {byLevel[level]
                .filter((block) => isAbilityBlockVisible('CHARACTER', block))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((block) => (
                  <ExpandableAbilityBlockRow
                    key={block.id}
                    block={block}
                    kind={kind}
                    focusTraitId={traitId}
                  />
                ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ));

  if (!class_) {
    return (
      <DrawerLoadState
        loading={classFetching || blocksFetching}
        onRetry={() => {
          void refetchClass();
          void refetchBlocks();
        }}
      />
    );
  }

  return (
    <Stack>
      <ClassInitialOverview class_={class_} mode='READ' />
      {abilityBlocks == null ? (
        <Group justify='center' py='md'>
          <Loader size='sm' type='dots' />
        </Group>
      ) : (
        <>
          <Box>
            <Title order={3}>Class Features</Title>
            <Accordion
              variant='separated'
              mt='xs'
              defaultValue={getMetadataOpenedDict().feature_section}
              onChange={(value) => {
                props.onMetadataChange?.({
                  feature_section: value ?? '',
                });
              }}
            >
              {levelAccordionItems(classFeatures, 'class-feature')}
            </Accordion>
          </Box>

          <Box>
            <Title order={3}>Feats</Title>
            <Accordion
              variant='separated'
              mt='xs'
              // Save opened state so it persists when opening links and going back
              defaultValue={getMetadataOpenedDict().feat_section}
              onChange={(value) => {
                props.onMetadataChange?.({
                  feat_section: value ?? '',
                });
              }}
            >
              {levelAccordionItems(feats, 'feat')}
            </Accordion>
          </Box>
        </>
      )}
      {props.data.showOperations && (
        <ShowOperationsButton name={class_.name} operations={class_.operations ?? undefined} />
      )}
    </Stack>
  );
}

export function ClassInitialOverview(props: {
  class_: Class;
  mode: 'READ' | 'READ/WRITE';
  operationResults?: OperationResult[];
  isClass2?: boolean;
}) {
  const theme = useMantineTheme();
  const [descHidden, setDescHidden] = useState(true);
  const charState = useAtom(characterState);

  // Reading thru operations to get display UI
  const MODE = props.mode;
  const display = convertClassOperationsIntoUI(
    props.class_,
    props.mode,
    props.operationResults ?? [],
    charState,
    props.isClass2
  );

  return (
    <>
      <Box
        style={{
          position: 'relative',
        }}
      >
        <Box
          mah={descHidden ? 400 : undefined}
          style={{
            WebkitMaskImage: descHidden ? 'linear-gradient(to bottom, black 60%, transparent 100%)' : undefined,
            maskImage: descHidden ? 'linear-gradient(to bottom, black 60%, transparent 100%)' : undefined,
            overflowY: descHidden ? 'hidden' : undefined,
          }}
        >
          {props.class_.artwork_url && (
            <Image
              style={{
                float: 'right',
                maxWidth: 150,
                height: 'auto',
              }}
              ml='sm'
              radius='md'
              fit='contain'
              src={props.class_.artwork_url}
            />
          )}
          <RichText ta='justify'>{props.class_.description}</RichText>
        </Box>
        <Anchor
          size='sm'
          style={{
            position: 'absolute',
            bottom: 5,
            right: 20,
          }}
          onClick={() => setDescHidden(!descHidden)}
        >
          {descHidden ? 'Show more' : 'Show less'}
        </Anchor>
      </Box>
      <Group align='flex-start' grow>
        <Box
          p='sm'
          style={{
            backgroundColor: IMPRINT_BG_COLOR,
            border: `1px solid ${IMPRINT_BORDER_COLOR}`,
            borderRadius: theme.radius.md,
            position: 'relative',
          }}
        >
          <HoverCard shadow='md' openDelay={250} width={200} zIndex={1000} position='top' withinPortal>
            <HoverCard.Target>
              <ActionIcon
                variant='subtle'
                aria-label='Help'
                radius='xl'
                size='sm'
                style={{
                  position: 'absolute',
                  top: 5,
                  right: 5,
                }}
              >
                <IconHelpCircle style={{ width: '80%', height: '80%' }} stroke={1.5} />
              </ActionIcon>
            </HoverCard.Target>
            <HoverCard.Dropdown py={5} px={10}>
              <Text fz='xs'>At 1st level, your class gives you an attribute boost in the key attribute.</Text>
            </HoverCard.Dropdown>
          </HoverCard>
          <Text c='gray.2' ta='center'>
            Key Attribute
          </Text>
          <Text c='gray.4' fw={700} ta='center' style={{ display: 'flex', justifyContent: 'center' }}>
            {display.keyAttribute.ui ?? 'Varies'}
          </Text>
        </Box>
        <Box
          p='sm'
          style={{
            backgroundColor: IMPRINT_BG_COLOR,
            border: `1px solid ${IMPRINT_BORDER_COLOR}`,
            borderRadius: theme.radius.md,
            position: 'relative',
          }}
        >
          <HoverCard shadow='md' openDelay={250} width={200} zIndex={1000} position='top' withinPortal>
            <HoverCard.Target>
              <ActionIcon
                variant='subtle'
                aria-label='Help'
                radius='xl'
                size='sm'
                style={{
                  position: 'absolute',
                  top: 5,
                  right: 5,
                }}
              >
                <IconHelpCircle style={{ width: '80%', height: '80%' }} stroke={1.5} />
              </ActionIcon>
            </HoverCard.Target>
            <HoverCard.Dropdown py={5} px={10}>
              <Text fz='xs'>
                You increase your maximum number of HP by this number at 1st level and every level thereafter.
              </Text>
            </HoverCard.Dropdown>
          </HoverCard>
          <Text c='gray.2' ta='center'>
            Hit Points
          </Text>
          <Text c='gray.4' fw={700} ta='center'>
            {display.classHp.ui ?? 'Varies'}
          </Text>
        </Box>
      </Group>
      <Box>
        <Divider
          px='xs'
          label={
            <Text fz='xs' c='gray.6'>
              <Group gap={5}>
                <IconEyeFilled size='0.8rem' />
                <Box>Perception</Box>
              </Group>
            </Text>
          }
          labelPosition='left'
        />
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.perception.ui}
        </IndentedText>
      </Box>
      <Box>
        <Divider
          px='xs'
          label={
            <Text fz='xs' c='gray.6'>
              <Group gap={5}>
                <IconBadgesFilled size='0.8rem' />
                <Box>Skills</Box>
              </Group>
            </Text>
          }
          labelPosition='left'
        />
        {display.skills.map((skill, index) => (
          <IndentedText key={index} disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
            {skill.ui}
          </IndentedText>
        ))}
        {display.additionalSkillTrainings.map((record, index) => (
          <IndentedText key={index} disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
            {record.ui}
          </IndentedText>
        ))}
      </Box>
      <Box>
        <Divider
          px='xs'
          label={
            <Text fz='xs' c='gray.6'>
              <Group gap={5}>
                <IconHeartHandshake size='0.8rem' />
                <Box>Saving Throws</Box>
              </Group>
            </Text>
          }
          labelPosition='left'
        />
        {display.saves.map((save, index) => (
          <IndentedText key={index} disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
            {save.ui}
          </IndentedText>
        ))}
      </Box>
      <Box>
        <Divider
          px='xs'
          label={
            <Text fz='xs' c='gray.6'>
              <Group gap={5}>
                <IconSword size='0.8rem' />
                <Box>Attacks</Box>
              </Group>
            </Text>
          }
          labelPosition='left'
        />
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.simpleWeapons.ui}
        </IndentedText>
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.martialWeapons.ui}
        </IndentedText>
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.advancedWeapons.ui}
        </IndentedText>
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.unarmedAttacks.ui}
        </IndentedText>
      </Box>
      <Box>
        <Divider
          px='xs'
          label={
            <Text fz='xs' c='gray.6'>
              <Group gap={5}>
                <IconShieldCheckeredFilled size='0.8rem' />
                <Box>Defenses</Box>
              </Group>
            </Text>
          }
          labelPosition='left'
        />
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.lightArmor.ui}
        </IndentedText>
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.mediumArmor.ui}
        </IndentedText>
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.heavyArmor.ui}
        </IndentedText>
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.unarmoredDefense.ui}
        </IndentedText>
      </Box>
      {(display.spellAttack.ui || display.spellDC.ui) && (
        <Box>
          <Divider
            px='xs'
            label={
              <Text fz='xs' c='gray.6'>
                <Group gap={5}>
                  <IconFlare size='0.8rem' />
                  <Box>Spells</Box>
                </Group>
              </Text>
            }
            labelPosition='left'
          />
          <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
            {display.spellAttack.ui}
          </IndentedText>
          <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
            {display.spellDC.ui}
          </IndentedText>
        </Box>
      )}
      <Box>
        <Divider
          px='xs'
          label={
            <Text fz='xs' c='gray.6'>
              <Group gap={5}>
                <IconVocabulary size='0.8rem' />
                <Box>Class DC</Box>
              </Group>
            </Text>
          }
          labelPosition='left'
        />
        <IndentedText disabled={MODE !== 'READ'} px='xs' c='gray.2' fz='sm'>
          {display.classDC.ui}
        </IndentedText>
      </Box>
    </>
  );
}

export function convertClassOperationsIntoUI(
  class_: Class,
  mode: 'READ' | 'READ/WRITE',
  operationResults: OperationResult[],
  charState: [Character | null, SetterOrUpdater<Character | null>],
  isClass2?: boolean
) {
  const classOperations = getClassOperations(
    class_,
    isClass2 ? charState[0]?.details?.class_archetype_2 : charState[0]?.details?.class_archetype
  );
  const baseTrainings = getClassSkillTrainingsNum(
    class_,
    isClass2 ? charState[0]?.details?.class_archetype_2 : charState[0]?.details?.class_archetype
  );

  const MODE = mode;
  const writeDetails =
    MODE === 'READ/WRITE'
      ? {
          operationResults: operationResults,
          characterState: charState,
          primarySource: isClass2 ? 'class-2' : 'class',
        }
      : undefined;

  const attributes = getStatBlockDisplay(
    'CHARACTER',
    getAllAttributeVariables('CHARACTER').map((v) => v.name),
    classOperations,
    MODE,
    writeDetails,
    { fullNames: true }
  );
  const keyAttribute =
    attributes.length > 0
      ? attributes[0]
      : {
          ui: null,
          operation: null,
        };

  const classHp = getStatDisplay('CHARACTER', 'MAX_HEALTH_CLASS_PER_LEVEL', classOperations, MODE, writeDetails);

  const perception = getStatDisplay('CHARACTER', 'PERCEPTION', classOperations, MODE, writeDetails);
  const skills = getStatBlockDisplay(
    'CHARACTER',
    getAllSkillVariables('CHARACTER').map((v) => v.name),
    classOperations,
    MODE,
    writeDetails
  );

  let additionalSkillTrainings: { ui: React.ReactNode; operation: OperationSelect | null }[] = [];
  if (!isClass2) {
    if (MODE === 'READ') {
      additionalSkillTrainings = [
        {
          ui: <>Trained in a number of additional skills equal to {baseTrainings} plus your Intelligence modifier</>,
          operation: null,
        },
      ];
    } else if (MODE === 'READ/WRITE') {
      const skillTrainingOps = getClassSkillTrainings('CHARACTER', baseTrainings);
      for (const op of skillTrainingOps) {
        const result = getDisplay('CHARACTER', { value: 'T', increases: 0 }, op, undefined, 'READ/WRITE', writeDetails);
        additionalSkillTrainings.push({
          ui: result,
          operation: op,
        });
      }
    }
  }

  const saves = getStatBlockDisplay(
    'CHARACTER',
    getAllSaveVariables('CHARACTER').map((v) => v.name),
    classOperations,
    MODE,
    writeDetails
  );
  const simpleWeapons = getStatDisplay('CHARACTER', 'SIMPLE_WEAPONS', classOperations, MODE, writeDetails);
  const martialWeapons = getStatDisplay('CHARACTER', 'MARTIAL_WEAPONS', classOperations, MODE, writeDetails);
  const advancedWeapons = getStatDisplay('CHARACTER', 'ADVANCED_WEAPONS', classOperations, MODE, writeDetails);
  const unarmedAttacks = getStatDisplay('CHARACTER', 'UNARMED_ATTACKS', classOperations, MODE, writeDetails);
  const lightArmor = getStatDisplay('CHARACTER', 'LIGHT_ARMOR', classOperations, MODE, writeDetails);
  const mediumArmor = getStatDisplay('CHARACTER', 'MEDIUM_ARMOR', classOperations, MODE, writeDetails);
  const heavyArmor = getStatDisplay('CHARACTER', 'HEAVY_ARMOR', classOperations, MODE, writeDetails);
  const unarmoredDefense = getStatDisplay('CHARACTER', 'UNARMORED_DEFENSE', classOperations, MODE, writeDetails);
  const classDC = getStatDisplay('CHARACTER', 'CLASS_DC', classOperations, 'READ', writeDetails);
  const spellAttack = getStatDisplay('CHARACTER', 'SPELL_ATTACK', classOperations, 'READ', writeDetails);
  const spellDC = getStatDisplay('CHARACTER', 'SPELL_DC', classOperations, 'READ', writeDetails);

  return {
    keyAttribute,
    classHp,
    perception,
    skills,
    additionalSkillTrainings,
    saves,
    simpleWeapons,
    martialWeapons,
    advancedWeapons,
    unarmedAttacks,
    lightArmor,
    mediumArmor,
    heavyArmor,
    unarmoredDefense,
    classDC,
    spellAttack,
    spellDC,
  };
}
