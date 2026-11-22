import { Component, useEffect, useState, type ReactNode } from 'react';
import GradientASCII from './GradientASCII';

class AsciiErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function GradientAsciiBackground() {
  const [useStatic, setUseStatic] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setUseStatic(true);
      return;
    }

    try {
      const probe = document.createElement('canvas');
      const gl2 = probe.getContext('webgl2');
      if (!gl2) {
        setUseStatic(true);
      }
    } catch {
      setUseStatic(true);
    }
  }, []);

  const staticFallback = <div className="ascii-static-fallback absolute inset-0" />;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      {useStatic ? (
        staticFallback
      ) : (
        <AsciiErrorBoundary fallback={staticFallback}>
          <div className="absolute inset-0">
            <GradientASCII
              colors={['#E0F2FE', '#7DD3FC', '#38BDF8', '#2563EB']}
              shape="horizon"
              characters=" .:-=+*#%@"
              cellSize={18}
              density={0.62}
              glyphOpacity={0.58}
              gradientOpacity={0.32}
              glow={0}
              flicker={0.1}
              softness={0.6}
              scale={1.08}
              flow={0.38}
              speed={0.42}
              grain={0.03}
              lightMode={true}
              mouseInteraction={false}
              clickEffect="none"
              intro={false}
              fontFamily='"JetBrains Mono", ui-monospace, monospace'
            />
          </div>
        </AsciiErrorBoundary>
      )}

      {/* Soft frosted sky-ice readability veil over left copy zone */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(242,246,252,0.94) 0%, rgba(242,246,252,0.86) 46%, rgba(242,246,252,0.45) 100%)',
        }}
      />
    </div>
  );
}
