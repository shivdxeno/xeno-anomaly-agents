import type { TModuleSpec } from '../types';

import { journeysModule } from '../../modules/journeys/spec';

/** Every module in the repo. Adding a part means adding one line here. */
export const moduleRegistry: Array<TModuleSpec> = [journeysModule];

export const moduleById = (id: string): TModuleSpec => {
  const found = moduleRegistry.find((m) => m.id === id);

  if (found === undefined) {
    const known = moduleRegistry.map((m) => m.id).join(', ');

    throw new Error(`BLOCKED: unknown module "${id}" — known modules: ${known}`);
  }

  return found;
};
