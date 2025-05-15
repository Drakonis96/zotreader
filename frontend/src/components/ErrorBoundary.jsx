import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      // Usando las clases específicas para el contenedor de PDF
      return (
        <div className="pdf-error-container">
          <button className="error-close-button" type="button" onClick={this.props.onClose}>❌</button>
          <div className="error-message">
            Algo fue mal: {String(this.state.error)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
