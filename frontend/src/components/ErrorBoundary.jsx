import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="wrap page" role="alert">
      <h1>This view couldn’t load</h1>
      <p className="sub">Reload to try again, or use the navigation to open another view.</p>
      <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
    </div>;
  }
}
