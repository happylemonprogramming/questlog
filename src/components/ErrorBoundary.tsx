import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Contains a render failure to the part of the page that broke, so one bad
 * record (often written by the assistant) can't blank the whole app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.compact ? 'grid h-full place-items-center p-3 text-center text-[11px] text-danger' : 'rounded-2xl border border-danger/30 bg-danger/5 p-6 text-[13.5px]'}>
        {this.props.compact ? (
          'Can’t render'
        ) : (
          <>
            <p className="flex items-center gap-2 font-medium text-danger"><AlertTriangle className="size-4" /> This couldn’t be displayed.</p>
            <p className="mt-1 text-muted-foreground">{this.state.error.message}. Open the Data view or ask the assistant to fix it.</p>
          </>
        )}
      </div>
    );
  }
}
