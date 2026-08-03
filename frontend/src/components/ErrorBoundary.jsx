import React, { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Allow custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ padding: 40, color: "red", background: "#fff", textAlign: "center" }}>
          <h2>Something went wrong.</h2>
          <p>Please refresh the page or contact support if the issue persists.</p>

          <details
            style={{
              marginTop: 20,
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <summary>Error Details</summary>
            <pre>
              {this.state.error?.toString()}
              {"\n"}
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;