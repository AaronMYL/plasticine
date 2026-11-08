// What one operation changed, collected while its transaction runs and presented only after it commits
// (review-followups e4cef52: 入队和发事件放提交之后). A rolled-back operation is dropped with its collector, so no
// device ever sees a card the library does not hold.

export type AskChange = 'created' | 'answered' | 'updated';

export class Changes {
  readonly asks: { askId: string; change: AskChange }[] = [];

  ask(askId: string, change: AskChange): void {
    this.asks.push({ askId, change });
  }

  readonly followUps: (() => void)[] = [];

  /**
   * Something to do only once the operation (and any outer transaction holding it) has committed — handing an answer
   * to a line, starting one: a rolled-back answer must not have set anything off (5a80a22 审查 P2).
   */
  afterCommit(action: () => void): void {
    this.followUps.push(action);
  }
}
