import { EmptyState } from '../components/EmptyState';
import { ScanIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { fr } from '../textes/fr';

/** Screen 1. Lot 0: placeholder; burst scanning comes with lot 1. */
export function ScanScreen() {
  return (
    <Screen title={fr.scan.title}>
      <EmptyState icon={<ScanIcon size={40} />} title={fr.scan.unavailableTitle} text={fr.scan.unavailableText} />
    </Screen>
  );
}
