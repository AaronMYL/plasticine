import type { AskSeed } from './fake-asks.ts';

export const OFFER_ASK: AskSeed = {
  id: 'ask-loop-offer', kind: 'confirm', question: '「排日程」这类事，以后我直接做？',
  detail: '你最近连续 5 次都原样同意了我推荐的做法。答应以后，这类事我按推荐直接做，做完告诉你；'
    + '你随时说一句「这类还是先问我」就收回。花钱、对外发出、删除这些照样每次问你。',
  basis: 'hard_line', lineId: null, channel: 'popup',
  options: [{ id: 'yes', label: '以后直接做', recommended: true, description: null },
    { id: 'no', label: '还是先问我', recommended: false, description: null }],
};

export function seedOfferScene(raiseAsk: (seed: AskSeed) => void): void {
  raiseAsk(OFFER_ASK);
}
