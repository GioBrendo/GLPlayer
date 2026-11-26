import React, { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { clearSavedLibrary } from './utils/storage'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('GL Music React Crash:', error, errorInfo);
  }

  handleReset = () => {
    // Antes só apagava as chaves "soundwave_", mas o app lia "glmusic_" primeiro: o reset não fazia nada
    clearSavedLibrary();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#0a0b0e',
          color: '#f8fafc',
          padding: '24px',
          fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '16px'
          }}>⚡</div>
          <h2 style={{ fontSize: '22px', marginBottom: '8px', color: '#ef4444' }}>
            Ops! Ocorreu um problema ao carregar o GL Music.
          </h2>
          <p style={{ color: '#94a3b8', maxWidth: '500px', fontSize: '14px', marginBottom: '24px' }}>
            {this.state.error?.message || 'Erro desconhecido durante a renderização.'}
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#6366f1',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Recarregar Página
            </button>
            <button
              onClick={this.handleReset}
              style={{
                backgroundColor: '#334155',
                color: '#f8fafc',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Resetar Dados Salvos
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
