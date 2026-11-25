import { createHash } from 'node:crypto';
import { rulesDocSection } from '../memory/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { StateService } from '../state/index.ts';

type SoulState = Pick<StateService, 'memoryDocs'>;

export function withMainSoul(models: TextModels, state: SoulState): TextModels {
  return {
    ask(request, signal, onText) {
      if (request.purpose === 'network_reply') return models.ask(request, signal, onText);
      return models.ask({ ...request, system: `${rulesDocSection(state)}\n\n${request.system}` }, signal, onText);
    },
    ...(models.snapshot === undefined ? {} : { snapshot(purpose) {
      const fixed = models.snapshot!(purpose);
      if (purpose === 'network_reply') return fixed;
      const revision = createHash('sha256').update(rulesDocSection(state)).digest('hex');
      return { identity: `${fixed.identity}:soul:${revision}`, models: withMainSoul(fixed.models, state) };
    } }),
  };
}
