import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AbrovaTrace } from '../index';

/**
 * Error Boundary props
 */
export interface ErrorBoundaryProps {
  /**
   * Fallback UI to show when an error occurs
   */
  fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo, resetError: () => void) => ReactNode);

  /**
   * Callback when error occurs
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;

  /**
   * Children components
   */
  children: ReactNode;

  /**
   * Whether to show default fallback UI
   * @default true
   */
  showDefaultFallback?: boolean;

  /**
   * Custom error message for fallback UI
   */
  fallbackMessage?: string;

  /**
   * Whether the default fallback UI shows the error message and stack trace.
   * @default true in development, false in production
   */
  showErrorDetails?: boolean;
}

/**
 * Error Boundary state
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * AbrovaTrace Error Boundary Component
 * Catches React component errors and reports them to AbrovaTrace
 */
export class AbrovaTraceErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Store error info in state
    this.setState({ errorInfo });

    // Capture error in AbrovaTrace
    const sdk = AbrovaTrace.getInstance();
    if (sdk) {
      sdk.captureException(error, 'React Error Boundary', {
        componentStack: errorInfo.componentStack,
        errorBoundary: true,
      });
    } else if (process.env.NODE_ENV !== 'production') {
      console.warn('[AbrovaTrace] ErrorBoundary caught an error before AbrovaTrace.init() was called; it was not reported.');
    }

    // Call custom error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const {
        fallback,
        showDefaultFallback = true,
        fallbackMessage,
        showErrorDetails = process.env.NODE_ENV !== 'production',
      } = this.props;
      const { error, errorInfo } = this.state;

      // Custom fallback function
      if (typeof fallback === 'function' && error && errorInfo) {
        return fallback(error, errorInfo, this.resetError);
      }

      // Custom fallback element
      if (fallback !== undefined && fallback !== null && typeof fallback !== 'function') {
        return fallback;
      }

      // Default fallback UI
      if (showDefaultFallback) {
        return (
          <DefaultErrorFallback
            error={error}
            errorInfo={errorInfo}
            message={fallbackMessage}
            showDetails={showErrorDetails}
            onReset={this.resetError}
          />
        );
      }

      // No fallback - render nothing
      return null;
    }

    return this.props.children;
  }
}

/**
 * Default error fallback UI
 */
interface DefaultErrorFallbackProps {
  error?: Error;
  errorInfo?: ErrorInfo;
  message?: string;
  showDetails: boolean;
  onReset: () => void;
}

function DefaultErrorFallback({ error, errorInfo, message, showDetails, onReset }: DefaultErrorFallbackProps) {
  return (
    <div
      style={{
        padding: '20px',
        margin: '20px',
        border: '1px solid #ff6b6b',
        borderRadius: '8px',
        backgroundColor: '#fff5f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h2 style={{ margin: '0 0 10px 0', color: '#c92a2a', fontSize: '20px' }}>
        Something went wrong
      </h2>
      <p style={{ margin: '0 0 15px 0', color: '#495057' }}>
        {message || 'An unexpected error occurred. Our team has been notified.'}
      </p>
      {showDetails && error && (
        <details style={{ marginBottom: '15px' }}>
          <summary style={{ cursor: 'pointer', color: '#495057', marginBottom: '10px' }}>
            Error details
          </summary>
          <pre
            style={{
              padding: '10px',
              backgroundColor: '#f8f9fa',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              fontSize: '12px',
              overflow: 'auto',
              color: '#212529',
            }}
          >
            {error.toString()}
            {'\n\n'}
            {error.stack}
            {errorInfo?.componentStack && '\n\nComponent Stack:' + errorInfo.componentStack}
          </pre>
        </details>
      )}
      <button
        onClick={onReset}
        style={{
          padding: '8px 16px',
          backgroundColor: '#228be6',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
        }}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#1c7ed6')}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#228be6')}
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Convenience export
 */
export const ErrorBoundary = AbrovaTraceErrorBoundary;
