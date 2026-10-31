/**
 * Homebrew create / edit wiring — reuses existing Create*Modals + content-creation upserts.
 */

import {
  upsertAbilityBlock,
  upsertClass,
  upsertItem,
  upsertSpell,
} from '@content/content-creation';
import { showNotification } from '@mantine/notifications';
import { CreateAbilityBlockModal } from '@modals/CreateAbilityBlockModal';
import { CreateClassModal } from '@modals/CreateClassModal';
import { CreateItemModal } from '@modals/CreateItemModal';
import { CreateSpellModal } from '@modals/CreateSpellModal';
import type { AbilityBlock, AbilityBlockType, Class, Item, Spell } from '@schemas/content';
import type { ContentStudioTab } from './filters';
import type { ContentStudioResult } from './useContentStudioSearch';

export type EditTarget =
  | { mode: 'closed' }
  | { mode: 'create'; tab: ContentStudioTab; sourceId: number; abilityType?: AbilityBlockType }
  | { mode: 'edit'; tab: ContentStudioTab; sourceId: number; row: ContentStudioResult };

function isAbilityBlock(row: ContentStudioResult): row is AbilityBlock {
  return 'type' in row && typeof (row as AbilityBlock).type === 'string';
}

function abilityTypeForCreate(tab: ContentStudioTab, abilityType?: AbilityBlockType): AbilityBlockType {
  if (abilityType) return abilityType;
  if (tab === 'actions') return 'action';
  if (tab === 'feats') return 'feat';
  return 'feat';
}

export function ContentStudioEditModals(props: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { target, onClose, onSaved } = props;
  if (target.mode === 'closed') return null;

  const editing = target.mode === 'edit';
  const editId = editing ? target.row.id : undefined;
  const sourceId = target.sourceId;
  const tab = target.tab;

  const finish = () => {
    onSaved();
    onClose();
  };

  // Monsters / hazards are browse-only in Content Studio for now.
  if (tab === 'monsters' || tab === 'hazards') {
    return null;
  }

  if (tab === 'spells') {
    return (
      <CreateSpellModal
        opened
        editId={editId}
        onComplete={async (spell: Spell) => {
          spell.content_source_id = sourceId;
          const result = await upsertSpell(spell);
          if (result) {
            showNotification({
              title: editing ? `Updated ${result.name}` : `Created ${result.name}`,
              message: 'Spell saved.',
              autoClose: 3000,
            });
            finish();
          }
        }}
        onCancel={onClose}
      />
    );
  }

  if (tab === 'equipment') {
    return (
      <CreateItemModal
        opened
        editId={editId}
        onComplete={async (item: Item) => {
          item.content_source_id = sourceId;
          const result = await upsertItem(item);
          if (result) {
            showNotification({
              title: editing ? `Updated ${result.name}` : `Created ${result.name}`,
              message: 'Item saved.',
              autoClose: 3000,
            });
            finish();
          }
        }}
        onCancel={onClose}
      />
    );
  }

  const editingAbility = editing && isAbilityBlock(target.row);
  const creatingClass = !editing && tab === 'classes' && !target.abilityType;
  const editingClass = editing && tab === 'classes' && !editingAbility;

  if (creatingClass || editingClass) {
    return (
      <CreateClassModal
        opened
        editId={editId}
        onComplete={async (class_: Class) => {
          class_.content_source_id = sourceId;
          const result = await upsertClass(class_);
          if (result) {
            showNotification({
              title: editing ? `Updated ${result.name}` : `Created ${result.name}`,
              message: 'Class saved.',
              autoClose: 3000,
            });
            finish();
          }
        }}
        onCancel={onClose}
      />
    );
  }

  const abType = editingAbility
    ? target.row.type
    : abilityTypeForCreate(tab, target.mode === 'create' ? target.abilityType : undefined);

  return (
    <CreateAbilityBlockModal
      opened
      type={abType}
      editId={editId}
      onComplete={async (abilityBlock: AbilityBlock) => {
        abilityBlock.content_source_id = sourceId;
        const result = await upsertAbilityBlock(abilityBlock);
        if (result) {
          showNotification({
            title: editing ? `Updated ${result.name}` : `Created ${result.name}`,
            message: `Successfully saved ${result.type}.`,
            autoClose: 3000,
          });
          finish();
        }
      }}
      onCancel={onClose}
    />
  );
}
