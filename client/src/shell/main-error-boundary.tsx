import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; onHome: () => void }
interface State { error: Error | null }

/** 只包当前页面，聊天、导航与草稿留在错误边界外。 */
export class MainErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('主区页面渲染失败', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) { return this.props.children; }
    return <section className="page" role="alert">
      <h1>这一页出错了</h1><p>{this.state.error.message}</p>
      <div className="ask-options">
        <button type="button" className="chip-button" onClick={this.props.onHome}>回到今日</button>
        <button type="button" className="text-button" onClick={() => this.setState({ error: null })}>再试一次</button>
      </div>
    </section>;
  }
}
