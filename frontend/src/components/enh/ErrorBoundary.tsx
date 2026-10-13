import { Component, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/** Catches a crash on one page so the sidebar stays usable and the person sees what to do next. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  componentDidCatch(error: Error) { console.error('Page crashed:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="max-w-md mx-auto mt-24 text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4"><AlertTriangle className="w-6 h-6" /></div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">This page hit a problem</h2>
        <p className="text-sm text-gray-500 mb-5">Nothing was lost. Try again, or open another page from the sidebar. If it keeps happening, send the message below to Manu.</p>
        <div className="flex justify-center gap-2 mb-4">
          <button type="button" onClick={() => this.setState({ error: null })} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">Try again</button>
          <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Reload</button>
        </div>
        <code className="block text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 break-words">{this.state.error.message}</code>
      </div>
    )
  }
}
