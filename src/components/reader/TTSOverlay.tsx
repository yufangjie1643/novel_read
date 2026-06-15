import { useTranslation } from 'react-i18next';

interface TTSOverlayProps {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  currentText: string;
  currentChunkIndex: number;
  totalChunks: number;
  isPlaying: boolean;
  isPaused: boolean;
  rate: number;
  onClose: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onAdjustRate: (delta: number) => void;
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  theme: {
    bg: string;
    text: string;
    border: string;
    button: string;
  };
}

export default function TTSOverlay({
  visible,
  bookTitle,
  chapterTitle,
  currentText,
  currentChunkIndex,
  totalChunks,
  isPlaying,
  isPaused,
  rate,
  onClose,
  onPlayPause,
  onStop,
  onAdjustRate,
  onPrevChapter,
  onNextChapter,
  theme,
}: TTSOverlayProps) {
  const { t } = useTranslation();

  if (!visible) return null;

  const progressPercent = totalChunks > 0 ? ((currentChunkIndex + 1) / totalChunks) * 100 : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: theme.bg,
        display: 'flex',
        flexDirection: 'column',
        animation: 'ttsFadeIn 0.25s ease',
      }}
    >
      <style>{`
        @keyframes ttsFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ttsPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: theme.text,
              opacity: 0.85,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bookTitle}
          </div>
          <div
            style={{
              fontSize: 12,
              color: theme.text,
              opacity: 0.55,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {chapterTitle}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: theme.button,
            color: theme.text,
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginLeft: 12,
          }}
          title={t('common.back')}
        >
          ✕
        </button>
      </div>

      {/* Main text display */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 28px',
          overflow: 'hidden',
          gap: 20,
        }}
      >
        {/* Reading indicator */}
        {isPlaying && !isPaused && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              animation: 'ttsPulse 1.6s ease-in-out infinite',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#1976d2',
              }}
            />
            <span style={{ fontSize: 12, color: theme.text, opacity: 0.6, fontWeight: 500 }}>
              {t('reader.readAloud')}
            </span>
          </div>
        )}

        {/* Current text */}
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.7,
            color: theme.text,
            textAlign: 'center',
            maxWidth: 680,
            fontWeight: 400,
            overflowY: 'auto',
            wordBreak: 'break-word',
          }}
        >
          {currentText || '…'}
        </div>

        {/* Progress */}
        <div
          style={{
            fontSize: 12,
            color: theme.text,
            opacity: 0.5,
            fontWeight: 500,
          }}
        >
          {currentChunkIndex + 1} / {totalChunks}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 20px', flexShrink: 0 }}>
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: theme.border,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: '#1976d2',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          padding: '16px 20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          flexShrink: 0,
        }}
      >
        {/* Rate control */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <button
            onClick={() => onAdjustRate(-0.1)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: `1px solid ${theme.border}`,
              background: theme.button,
              color: theme.text,
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            −
          </button>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: theme.text,
              minWidth: 48,
              textAlign: 'center',
            }}
          >
            {rate.toFixed(1)}x
          </span>
          <button
            onClick={() => onAdjustRate(0.1)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: `1px solid ${theme.border}`,
              background: theme.button,
              color: theme.text,
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            +
          </button>
        </div>

        {/* Playback controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
          }}
        >
          {/* Prev chapter */}
          <button
            onClick={onPrevChapter}
            disabled={!onPrevChapter}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: onPrevChapter ? theme.text : '#888',
              fontSize: 20,
              cursor: onPrevChapter ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: onPrevChapter ? 0.75 : 0.3,
            }}
          >
            ⏮
          </button>

          {/* Play/Pause */}
          <button
            onClick={onPlayPause}
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              border: 'none',
              background: '#1976d2',
              color: '#fff',
              fontSize: 28,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(25, 118, 210, 0.35)',
              transition: 'transform 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isPlaying && !isPaused ? '⏸' : '▶'}
          </button>

          {/* Stop */}
          <button
            onClick={onStop}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: '#f44336',
              fontSize: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.75,
            }}
          >
            ⏹
          </button>

          {/* Next chapter */}
          <button
            onClick={onNextChapter}
            disabled={!onNextChapter}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: onNextChapter ? theme.text : '#888',
              fontSize: 20,
              cursor: onNextChapter ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: onNextChapter ? 0.75 : 0.3,
            }}
          >
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}
