(() => {
  if (window.__SOLIS_BOOK_LOADED__) return;
  window.__SOLIS_BOOK_LOADED__ = true;

  const webview = window.chrome?.webview;
  let requestSequence = 0;
  const pending = new Map();

  function nextRequestId() {
    requestSequence += 1;
    return `book-${Date.now()}-${requestSequence}`;
  }

  function sendHost(type, data = null, requestId = null) {
    webview?.postMessage?.({ type, data, requestId });
  }

  function normalizeMoves(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.moves)) return data.moves;
    if (Array.isArray(data?.entries)) return data.entries;
    return [];
  }

  function settle(requestId, data, error = null) {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(data);
  }

  function onMessage(event) {
    const message = event?.data;
    if (!message?.type) return;
    if (message.type === "BOOK_RESULT") {
      settle(message.requestId, normalizeMoves(message.data));
      return;
    }
    if (message.type === "BOOK_ERROR") {
      settle(message.requestId, null, new Error(message.data?.message || "Book lookup failed"));
    }
  }

  webview?.addEventListener?.("message", onMessage);

  async function lookup(fen, options = {}) {
    const provider = window.__SOLIS_BOOK_LOOKUP__;
    if (typeof provider === "function") {
      const result = await provider(String(fen || ""), options || {});
      return normalizeMoves(result);
    }

    if (!webview?.postMessage) return [];

    const requestId = nextRequestId();
    const timeoutMs = Math.max(1000, Number(options.timeout || 8000));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("BOOK_TIMEOUT"));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      sendHost("BOOK_LOOKUP", {
        fen: String(fen || ""),
        limit: Math.max(1, Number(options.limit || 5)),
        minWeight: Number(options.minWeight || 0),
      }, requestId);
    });
  }

  function cancel(requestId) {
    if (!requestId) return false;
    const request = pending.get(requestId);
    if (!request) return false;
    pending.delete(requestId);
    clearTimeout(request.timer);
    request.reject(new Error("BOOK_CANCELLED"));
    sendHost("BOOK_CANCEL", null, requestId);
    return true;
  }

  window.SolisBook = {
    lookup,
    cancel,
    onMessage,
    sendHost,
    get pendingRequests() {
      return pending.size;
    },
  };
})();