const FLASH_CLASS = 'reader-flash-highlight';
const FLASH_DURATION_MS = 1500;

function ensureStyleInjected() {
  if (document.getElementById('reader-flash-style')) return;
  const style = document.createElement('style');
  style.id = 'reader-flash-style';
  style.textContent = `
    @keyframes reader-flash {
      0%, 100% { background-color: transparent; }
      30%, 70% { background-color: rgba(255, 220, 0, 0.5); }
    }
    .${FLASH_CLASS} {
      animation: reader-flash ${FLASH_DURATION_MS}ms ease-in-out;
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
}

export function flashRange(
  container: HTMLElement | null,
  position: number,
  length: number,
): void {
  if (!container) return;
  ensureStyleInjected();

  // Locate the text node at `position` by walking the container in
  // document order, deducting each text node's length from the offset.
  let remaining = position;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let target: Text | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (remaining <= t.data.length) {
      target = t;
      break;
    }
    remaining -= t.data.length;
  }
  if (!target) return;

  const range = document.createRange();
  try {
    range.setStart(target, Math.max(0, remaining));
    range.setEnd(target, Math.min(target.data.length, remaining + length));
  } catch {
    return;
  }

  const span = document.createElement('span');
  span.className = FLASH_CLASS;
  try {
    range.surroundContents(span);
  } catch {
    // surroundContents throws when the range crosses element
    // boundaries; fall back to extracting the contents into the span.
    span.appendChild(range.extractContents());
  }
  span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }, FLASH_DURATION_MS);
}
