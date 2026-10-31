/**
 * Per-tab subtype controls (dropdowns) under Content Studio pill tabs.
 */

import { Group, MultiSelect, NumberInput, Select } from '@mantine/core';
import type { Class, ItemGroup, Trait } from '@schemas/content';
import type { ContentStudioSubtypeState, ContentStudioTab, SpellKind } from './filters';

const ITEM_GROUPS: ItemGroup[] = ['GENERAL', 'WEAPON', 'ARMOR', 'SHIELD', 'RUNE', 'UPGRADE', 'MATERIAL'];

export function SubtypeToolbar(props: {
  tab: ContentStudioTab;
  subtype: ContentStudioSubtypeState;
  onChange: (next: ContentStudioSubtypeState) => void;
  classes: Class[];
  /** Traits with `meta_data.creature_trait` — options for Monsters / Hazards tags. */
  creatureTraits?: Trait[];
}) {
  const { tab, subtype, onChange } = props;
  const set = <K extends keyof ContentStudioSubtypeState>(key: K, value: ContentStudioSubtypeState[K]) => {
    onChange({ ...subtype, [key]: value });
  };

  const classOptions = props.classes.map((c) => ({ value: String(c.id), label: c.name }));

  // Actions: subtype tabs live in ResultsList (with per-bucket counts).
  if (tab === 'actions') {
    return null;
  }

  if (tab === 'spells') {
    return (
      <Group gap='sm' align='flex-end' wrap='wrap'>
        <Select
          label='Spell kind'
          w={160}
          data={[
            { value: 'all', label: 'All' },
            { value: 'normal', label: 'Spells only' },
            { value: 'cantrip', label: 'Cantrips' },
            { value: 'focus', label: 'Focus' },
            { value: 'ritual', label: 'Rituals' },
          ]}
          value={subtype.spellKind}
          onChange={(v) => set('spellKind', (v as SpellKind) || 'all')}
          allowDeselect={false}
        />
        <Select
          label='Tradition'
          w={140}
          clearable
          data={['arcane', 'divine', 'occult', 'primal']}
          value={subtype.tradition}
          onChange={(v) => set('tradition', v)}
        />
        <NumberInput
          label='Rank min'
          w={100}
          min={0}
          max={10}
          value={subtype.rankMin}
          onChange={(v) => set('rankMin', typeof v === 'number' ? v : 0)}
        />
        <NumberInput
          label='Rank max'
          w={100}
          min={0}
          max={10}
          value={subtype.rankMax}
          onChange={(v) => set('rankMax', typeof v === 'number' ? v : 10)}
        />
      </Group>
    );
  }

  if (tab === 'feats') {
    // Feat subtype tabs live in ResultsList; toolbar only keeps level range.
    return (
      <Group gap='sm' align='flex-end' wrap='wrap'>
        <NumberInput
          label='Lvl min'
          w={90}
          min={0}
          max={20}
          value={subtype.featLevelMin}
          onChange={(v) => set('featLevelMin', typeof v === 'number' ? v : 0)}
        />
        <NumberInput
          label='Lvl max'
          w={90}
          min={0}
          max={20}
          value={subtype.featLevelMax}
          onChange={(v) => set('featLevelMax', typeof v === 'number' ? v : 20)}
        />
      </Group>
    );
  }

  if (tab === 'classes') {
    return (
      <Group gap='sm' align='flex-end' wrap='wrap'>
        <Select
          label='Class'
          w={240}
          searchable
          data={classOptions}
          value={subtype.classId ? String(subtype.classId) : null}
          onChange={(v) => set('classId', v ? parseInt(v, 10) : null)}
          allowDeselect={false}
        />
        <NumberInput
          label='Lvl min'
          w={90}
          min={1}
          max={20}
          value={subtype.classLevelMin}
          onChange={(v) => set('classLevelMin', typeof v === 'number' ? v : 1)}
        />
        <NumberInput
          label='Lvl max'
          w={90}
          min={1}
          max={20}
          value={subtype.classLevelMax}
          onChange={(v) => set('classLevelMax', typeof v === 'number' ? v : 20)}
        />
      </Group>
    );
  }

  if (tab === 'monsters' || tab === 'hazards') {
    const tagOptions = (props.creatureTraits ?? []).map((trait) => ({
      value: String(trait.id),
      label: trait.name,
    }));
    return (
      <Group gap='sm' align='flex-end' wrap='wrap'>
        <MultiSelect
          label='Tags'
          w={320}
          searchable
          clearable
          nothingFoundMessage='No creature traits'
          data={tagOptions}
          value={subtype.creatureTraitIds.map(String)}
          onChange={(values) =>
            set(
              'creatureTraitIds',
              values.map((v) => parseInt(v, 10)).filter((id) => Number.isFinite(id) && id > 0)
            )
          }
          placeholder={tab === 'monsters' ? 'Construct, Humanoid…' : 'Trap, Haunt…'}
        />
        <NumberInput
          label='Lvl min'
          w={90}
          min={-100}
          max={30}
          value={subtype.creatureLevelMin}
          onChange={(v) => set('creatureLevelMin', typeof v === 'number' ? v : -1)}
        />
        <NumberInput
          label='Lvl max'
          w={90}
          min={-100}
          max={30}
          value={subtype.creatureLevelMax}
          onChange={(v) => set('creatureLevelMax', typeof v === 'number' ? v : 25)}
        />
      </Group>
    );
  }

  // Equipment
  return (
    <Group gap='sm' align='flex-end' wrap='wrap'>
      <Select
        label='Item group'
        w={160}
        data={[{ value: 'ALL', label: 'All groups' }, ...ITEM_GROUPS.map((g) => ({ value: g, label: g }))]}
        value={subtype.itemGroup}
        onChange={(v) => set('itemGroup', (v as ItemGroup | 'ALL') || 'ALL')}
        allowDeselect={false}
      />
      <MultiSelect
        label='Tags'
        w={280}
        data={['Consumable', 'Invested', 'Magical', 'Bomb', 'Staff', 'Wand']}
        value={subtype.itemTags}
        onChange={(v) => set('itemTags', v)}
        clearable
      />
      <NumberInput
        label='Lvl min'
        w={90}
        min={0}
        max={30}
        value={subtype.itemLevelMin}
        onChange={(v) => set('itemLevelMin', typeof v === 'number' ? v : 0)}
      />
      <NumberInput
        label='Lvl max'
        w={90}
        min={0}
        max={30}
        value={subtype.itemLevelMax}
        onChange={(v) => set('itemLevelMax', typeof v === 'number' ? v : 30)}
      />
    </Group>
  );
}
