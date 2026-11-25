export type AskChange = 'created' | 'answered' | 'updated';

export class Changes {
  readonly asks: { askId: string; change: AskChange }[] = [];

  ask(askId: string, change: AskChange): void {
    this.asks.push({ askId, change });
  }

  readonly followUps: (() => void)[] = [];

  afterCommit(action: () => void): void {
    this.followUps.push(action);
  }
}
