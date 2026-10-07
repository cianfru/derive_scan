import { Component } from "react";
import { isChunkError, reloadOnce } from "../lib/staleBuild.js";
import { recordProductEvent } from "../lib/diagnostics.js";

export default class ErrorBoundary extends Component {
  state = { failed: false, reloading: false };
  static getDerivedStateFromError(error) { return { failed: true, reloading: isChunkError(error) }; }
  componentDidCatch(error) {
    recordProductEvent(isChunkError(error) ? "view_update_required" : "view_failed");
    // A view from an older build: reload onto the current one, once.
    if (isChunkError(error) && !reloadOnce()) this.setState({ reloading: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.reloading) return <div className="wrap page" role="status"><p className="sub">Updating to the latest version…</p></div>;
    return <div className="wrap page" role="alert">
      <h1>This view couldn’t load</h1>
      <p className="sub">Reload to try again, or use the navigation to open another view.</p>
      <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
    </div>;
  }
}
