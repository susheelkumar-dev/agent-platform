import { defineDisplays } from '../display/registry';

/**
 * Template displays configured purely by metadata (display.config). Add them to an app's registry to register
 * simple screens without writing a component; modules that need code use createSummaryDisplay /
 * createEntryDisplay with their own keys instead.
 */
export const builtinDisplays = defineDisplays({
  SummaryDisplay: { load: () => import('./SummaryDisplay'), types: ['summary'] },
  EntryForm: { load: () => import('./EntryForm'), types: ['entry-form'] },
  MasterSlave: { load: () => import('./MasterSlave'), types: ['master-slave'] },
});
