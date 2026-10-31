import BlurBox from '@common/BlurBox';
import { Button, Center, Group, Stack, Title } from '@mantine/core';
import { setPageTitle } from '@utils/document-change';
import { useNavigate } from 'react-router-dom';
import EditContent from './EditContent';
import GenerateEmbeddings from './GenerateEmbeddings';
import ImportLegacyContent from './ImportLegacyContent';
import UploadContent from './UploadContent';
import BackgroundFixer from './BackgroundFixer';
import TraitMerger from './TraitMerger';
import ContentUpdateRetrigger from './ContentUpdateRetrigger';
import ContentCleaning from './ContentCleaning';

function ContentStudioLink() {
  const navigate = useNavigate();
  return (
    <BlurBox p='sm'>
      <Center p='sm'>
        <Group>
          <Title order={3}>Content Studio</Title>
          <Button size='compact-sm' onClick={() => navigate('/admin/content-studio')}>
            Open
          </Button>
        </Group>
      </Center>
    </BlurBox>
  );
}

export function Component() {
  setPageTitle(`Admin Panel`);

  return (
    <Stack>
      <ContentStudioLink />
      <GenerateEmbeddings />
      <UploadContent />
      <EditContent />
      <ImportLegacyContent />
      <BackgroundFixer />
      <ContentUpdateRetrigger />
      <TraitMerger />
      <ContentCleaning />
    </Stack>
  );
}
