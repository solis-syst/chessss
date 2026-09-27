(() => {
  if (window.__SOLIS_CONTENT_LOADED__) return;
  window.__SOLIS_CONTENT_LOADED__ = true;

  const DEFAULT_CONFIG = {
    engine: "komodo",
    elo: 3500,
    depth: 10,
    lines: 5,
    colors: ["#0000ff", "#00ff00", "#FFFF00", "#f97316", "#ff0000"],
    hideArrow: false,
    onlyShowEval: false,
    useBook: true,
    useLocalEngine: true,
    autoMove: false,
    autoMoveBalanced: false,
    delay0: 0,
    delay: 5000,
    floatingBtn: false,
    key: "a",
    key2: "z"
  };

  const SITE = detectSite();
  const webview = window.chrome && window.chrome.webview;
  let config = loadConfig();
  let lastState = null;
  let lastFen = "";
  let lastDomSignature = "";
  let lastLichessFen = "";
  let lastLichessGameOver = false;
  let lichessWrapped = null;
  let engineMoves = [];
  let bookMoves = [];
  let bestMove = null;
  let overlayRoot = null;
  let resizeObserver = null;
  let mutationObserver = null;
  let scanTimer = null;

  function detectSite() {
    const host = window.location.hostname.toLowerCase();
    if (host === "chess.com" || host === "www.chess.com" || host.endsWith(".chess.com")) return "chess.com";
    if (host === "lichess.org" || host.endsWith(".lichess.org")) return "lichess.org";
    return null;
  }

  function sendHost(type, data, requestId) {
    if (!webview || typeof webview.postMessage !== "function") return false;
    webview.postMessage({
      type: type,
      data: data == null ? null : data,
      requestId: requestId == null ? null : requestId
    });
    return true;
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem("chessConfig");
      if (!raw) return Object.assign({}, DEFAULT_CONFIG);
      return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw) || {});
    } catch {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig(nextConfig) {
    config = Object.assign({}, DEFAULT_CONFIG, nextConfig || {});
    try {
      localStorage.setItem("chessConfig", JSON.stringify(config));
    } catch {}
  }

  function getChessComGame() {
    try {
      if (window.game) return window.game;
    } catch {}
    const board = document.querySelector(".board");
    try {
      if (board && board.game) return board.game;
    } catch {}
    return null;
  }

  function getChessComColor(game) {
    try {
      const side = game && typeof game.getPlayingAs === "function" ? game.getPlayingAs() : null;
      if (side === 2 || side === "black" || side === "b") return "black";
      if (side === 1 || side === "white" || side === "w") return "white";
    } catch {}
    const board = document.querySelector("wc-chess-board");
    return board && board.classList.contains("flipped") ? "black" : "white";
  }

  function chessComState() {
    const game = getChessComGame();
    const board = document.querySelector("wc-chess-board");
    let fen = "";
    try {
      fen = game && typeof game.getFEN === "function" ? game.getFEN() : "";
    } catch {}
    let fenHistory = [];
    try {
      const history = game && typeof game.getHistoryFENs === "function" ? game.getHistoryFENs(1) : [];
      if (Array.isArray(history)) fenHistory = history.slice();
    } catch {}
    let uciHistory = null;
    try {
      const line = game && typeof game.getCurrentFullLine === "function" ? game.getCurrentFullLine() : null;
      if (Array.isArray(line) && line.length) {
        const start = line[0].beforeFen || null;
        const moves = line.map(function(move) {
          return String(move.from || "") + String(move.to || "") + String(move.promotion || "");
        }).filter(function(move) {
          return move.length >= 4;
        }).join(" ");
        if (start) uciHistory = "position fen " + start + " moves " + moves;
      }
    } catch {}
    let username = null;
    try {
      username = window.context && window.context.user ? window.context.user.username || null : null;
    } catch {}
    let isGameOver = false;
    try {
      isGameOver = !!(game && typeof game.isGameOver === "function" && game.isGameOver());
    } catch {}
    return {
      site: "chess.com",
      fen: fen,
      turn: fen.split(/\s+/)[1] === "b" ? "b" : "w",
      playerColor: getChessComColor(game),
      isGameOver: isGameOver,
      fenHistory: fenHistory,
      uciHistory: uciHistory,
      username: username,
      board: board
    };
  }

  function normalizeLichessFen(raw, turn) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const parts = text.split(/\s+/);
    if (parts.length >= 6) return text;
    if (parts.length === 4) return parts[0] + " " + (parts[1] || turn) + " " + (parts[2] || "-") + " " + (parts[3] || "-") + " 0 1";
    return parts[0] + " " + turn + " - - 0 1";
  }

  function wrapLichessMoveSource() {
    try {
      const sound = window.site && window.site.sound;
      const current = sound && sound.move;
      if (!sound || typeof current !== "function" || current.__solisWrapped) return;
      const original = current;
      const wrapped = function(moveData) {
        try {
          if (moveData && moveData.fen) {
            const turn = Number(moveData.ply || 0) % 2 === 0 ? "w" : "b";
            lastLichessFen = normalizeLichessFen(moveData.fen, turn);
            lastLichessGameOver = moveData.status && (moveData.status.name === "draw" || moveData.status.name === "mate");
            sendHost("MOVE_EVENT", {
              site: "lichess.org",
              fen: lastLichessFen,
              turn: turn,
              isGameOver: lastLichessGameOver
            });
          }
        } catch {}
        return original.apply(this, arguments);
      };
      wrapped.__solisWrapped = true;
      wrapped.__solisOriginal = original;
      sound.move = wrapped;
      lichessWrapped = wrapped;
    } catch {}
  }

  function lichessState() {
    wrapLichessMoveSource();
    const wrap = document.querySelector(".cg-wrap");
    const board = document.querySelector("cg-board");
    const turn = lastLichessFen.split(/\s+/)[1] === "b" ? "b" : "w";
    const playerColor = wrap && wrap.classList.contains("orientation-black") ? "black" : "white";
    return {
      site: "lichess.org",
      fen: normalizeLichessFen(lastLichessFen, turn),
      turn: turn,
      playerColor: playerColor,
      isGameOver: lastLichessGameOver,
      fenHistory: lastState && lastState.site === "lichess.org" ? lastState.fenHistory || [] : [],
      uciHistory: null,
      username: (document.querySelector("#user_tag") || {}).textContent || null,
      board: board || wrap
    };
  }

  function getState() {
    if (SITE === "chess.com") return chessComState();
    if (SITE === "lichess.org") return lichessState();
    return null;
  }

  function getBoardElement() {
    if (SITE === "chess.com") return document.querySelector("wc-chess-board");
    if (SITE === "lichess.org") return document.querySelector("cg-board") || document.querySelector(".cg-wrap");
    return null;
  }

  function getBoardRect() {
    const board = getBoardElement();
    if (!board || typeof board.getBoundingClientRect !== "function") return null;
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return rect;
  }

  function getOrientation(state) {
    return state && state.playerColor === "black" ? "black" : "white";
  }

  function readDomStatus(state) {
    const board = getBoardElement();
    const rect = board && board.getBoundingClientRect ? board.getBoundingClientRect() : null;
    const legalCount = SITE === "chess.com"
      ? document.querySelectorAll("wc-chess-board .legal-move, wc-chess-board [class*='legal-move'], wc-chess-board .highlight[class*='square-']").length
      : document.querySelectorAll("cg-board .move-dest, cg-board [class*='move-dest']").length;
    const signature = [
      SITE,
      !!board,
      rect ? rect.width : 0,
      rect ? rect.height : 0,
      legalCount,
      state ? state.turn : "",
      state ? state.playerColor : "",
      state && state.isGameOver ? 1 : 0
    ].join("|");
    if (signature === lastDomSignature) return;
    lastDomSignature = signature;
    sendHost("DOM_STATUS", {
      site: SITE,
      board: rect ? {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      } : null,
      turn: state ? state.turn : null,
      playerColor: state ? state.playerColor : null,
      legalMoveCount: legalCount,
      gameOver: !!(state && state.isGameOver)
    });
  }

  function normalizeMove(move) {
    if (!move) return null;
    const uci = String(move.uci || ((move.from || "") + (move.to || "") + (move.promotion || ""))).trim();
    if (uci.length < 4) return null;
    return Object.assign({}, move, {
      uci: uci,
      from: move.from || uci.slice(0, 2),
      to: move.to || uci.slice(2, 4),
      eval: move.eval == null ? (move.score == null ? null : move.score) : move.eval
    });
  }

  function clearOverlay() {
    if (overlayRoot) overlayRoot.replaceChildren();
  }

  function ensureOverlay() {
    if (overlayRoot && document.documentElement.contains(overlayRoot)) return overlayRoot;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "solis-webview-overlay";
    overlayRoot.style.position = "fixed";
    overlayRoot.style.inset = "0";
    overlayRoot.style.pointerEvents = "none";
    overlayRoot.style.zIndex = "2147483646";
    overlayRoot.style.overflow = "visible";
    document.documentElement.appendChild(overlayRoot);
    return overlayRoot;
  }

  function center(square, rect, orientation) {
    if (!square || square.length < 2) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    const size = rect.width / 8;
    if (orientation === "black") {
      return {
        x: (7 - file) * size + size / 2,
        y: rank * size + size / 2
      };
    }
    return {
      x: file * size + size / 2,
      y: (7 - rank) * size + size / 2
    };
  }

  function drawArrow(move, rect, orientation, color, width, label) {
    const normalized = normalizeMove(move);
    if (!normalized) return;
    const from = center(normalized.from, rect, orientation);
    const to = center(normalized.to, rect, orientation);
    if (!from || !to) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(rect.width));
    svg.setAttribute("height", String(rect.height));
    svg.setAttribute("viewBox", "0 0 " + rect.width + " " + rect.height);
    svg.style.position = "fixed";
    svg.style.left = rect.left + "px";
    svg.style.top = rect.top + "px";
    svg.style.width = rect.width + "px";
    svg.style.height = rect.height + "px";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(width));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.75");
    svg.appendChild(line);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const px = -uy;
    const py = ux;
    const tipX = to.x - ux * 4;
    const tipY = to.y - uy * 4;
    const baseX = tipX - ux * Math.max(12, width * 2.4);
    const baseY = tipY - uy * Math.max(12, width * 2.4);
    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const headWidth = Math.max(8, width * 1.8);
    head.setAttribute("points",
      tipX + "," + tipY + " " +
      (baseX + px * headWidth / 2) + "," + (baseY + py * headWidth / 2) + " " +
      (baseX - px * headWidth / 2) + "," + (baseY - py * headWidth / 2)
    );
    head.setAttribute("fill", color);
    head.setAttribute("opacity", "0.85");
    svg.appendChild(head);

    if (label != null) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(to.x + rect.width / 40));
      text.setAttribute("y", String(to.y - rect.height / 50));
      text.setAttribute("fill", color);
      text.setAttribute("font-size", String(Math.max(11, rect.width / 42)));
      text.setAttribute("font-family", "system-ui, sans-serif");
      text.setAttribute("font-weight", "700");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("paint-order", "stroke");
      text.setAttribute("stroke", "rgba(0,0,0,.8)");
      text.setAttribute("stroke-width", "2");
      text.textContent = String(label);
      svg.appendChild(text);
    }

    ensureOverlay().appendChild(svg);
  }

  function renderOverlays() {
    clearOverlay();
    const rect = getBoardRect();
    const state = lastState;
    if (!rect || !state) return;
    const orientation = getOrientation(state);
    const limit = Math.max(1, Number(config.lines) || 5);
    if (!config.hideArrow && !config.onlyShowEval) {
      const colors = Array.isArray(config.colors) ? config.colors : DEFAULT_CONFIG.colors;
      engineMoves.slice(0, limit).forEach(function(move, index) {
        drawArrow(move, rect, orientation, colors[index] || "#ef4444", Math.max(4, rect.width / 110), move.eval);
      });
      bookMoves.slice(0, limit).forEach(function(move, index) {
        drawArrow(move, rect, orientation, index === 0 ? "#26c2a3" : "#7aa2f7", Math.max(4, rect.width / 120), "BOOK");
      });
      if (bestMove) drawArrow(bestMove, rect, orientation, "#9fce3f", Math.max(5, rect.width / 92), null);
    }
  }

  function isPlayerTurn(state) {
    if (!state || !state.fen) return false;
    return state.turn === (state.playerColor === "black" ? "b" : "w");
  }

  function randomDelay() {
    const min = Math.max(0, Number(config.delay0 || 0));
    const max = Math.max(min, Number(config.delay || min));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function playMove(move, source) {
    const normalized = normalizeMove(move);
    if (!normalized) return false;
    const delay = normalized.moveDelay == null ? randomDelay() : Math.max(0, Number(normalized.moveDelay));
    if (delay) await new Promise(function(resolve) { setTimeout(resolve, delay); });

    if (SITE === "chess.com") {
      const game = getChessComGame();
      if (!game || typeof game.getLegalMoves !== "function") return false;
      try {
        const legal = game.getLegalMoves() || [];
        const target = legal.find(function(item) {
          return item.from === normalized.from && item.to === normalized.to;
        });
        if (!target) return false;
        if (normalized.promotion && target.promotionTypes) target.promotionType = normalized.promotion;
        game.move(Object.assign({}, target, { animate: true, userGenerated: true }));
        sendHost("MOVE_EVENT", {
          site: SITE,
          from: normalized.from,
          to: normalized.to,
          promotion: normalized.promotion || null,
          source: source || "content"
        });
        return true;
      } catch {
        return false;
      }
    }

    if (SITE === "lichess.org") {
      if (typeof window.playMove === "function") {
        try {
          window.playMove(normalized.uci);
          sendHost("MOVE_EVENT", {
            site: SITE,
            from: normalized.from,
            to: normalized.to,
            promotion: normalized.promotion || null,
            source: source || "content"
          });
          return true;
        } catch {}
      }
      const rect = getBoardRect();
      if (rect) {
        const orientation = getOrientation(lastState);
        const from = center(normalized.from, rect, orientation);
        const to = center(normalized.to, rect, orientation);
        if (from && to) {
          sendHost("DRAG_MOVE", {
            fromX: rect.left + from.x,
            fromY: rect.top + from.y,
            toX: rect.left + to.x,
            toY: rect.top + to.y
          });
          return true;
        }
      }
    }

    return false;
  }

  async function requestAnalysis(state) {
    if (!state || !state.fen || state.isGameOver || !isPlayerTurn(state)) return;
    if (config.engine === "None") return;

    const localController = window.SolisEngineController;
    if (config.useBook !== false && window.SolisBook && typeof window.SolisBook.lookup === "function") {
      try {
        const book = await window.SolisBook.lookup(state.fen, { limit: Number(config.lines || 5) });
        if (book && book.length) {
          bookMoves = book.map(normalizeMove).filter(Boolean);
          renderOverlays();
          if (config.autoMove) {
            await playMove(bookMoves[0], "book");
            return;
          }
        }
      } catch {}
    }

    if (config.useLocalEngine !== false && localController && typeof localController.analyze === "function") {
      try {
        const result = await localController.analyze({
          engine: config.engine,
          fen: state.fen,
          side: state.playerColor,
          depth: Number(config.depth || 10),
          lines: Number(config.lines || 5),
          elo: Number(config.elo || 3500),
          style: config.style || "Default",
          options: config
        });
        const moves = result && result.moves ? result.moves : result || [];
        engineMoves = Array.isArray(moves) ? moves.map(normalizeMove).filter(Boolean) : [];
        bestMove = engineMoves.length ? engineMoves[0] : null;
        renderOverlays();
        sendHost("ENGINE_RESULT", {
          source: "local",
          site: SITE,
          fen: state.fen,
          side: state.playerColor,
          moves: engineMoves
        });
        if (config.autoMove && engineMoves.length) {
          const selected = config.autoMoveBalanced ? chooseBalanced(engineMoves, state.playerColor) : engineMoves[0];
          if (selected) await playMove(selected, "engine");
        }
        return;
      } catch (error) {
        sendHost("ENGINE_ERROR", {
          site: SITE,
          fen: state.fen,
          message: error && error.message ? error.message : String(error)
        });
      }
    }

    sendHost("ENGINE_REQUEST", {
      fen: state.fen,
      side: state.playerColor,
      config: {
        engine: config.engine,
        elo: config.elo,
        depth: config.depth,
        lines: config.lines,
        style: config.style || "Default"
      },
      site: SITE
    });
  }

  function chooseBalanced(moves, side) {
    const factor = side === "white" ? 1 : -1;
    const normal = moves.filter(function(move) {
      return typeof move.eval === "string" && move.eval.indexOf("#") === -1;
    }).map(function(move) {
      return Object.assign({}, move, { score: parseFloat(move.eval) * factor });
    }).filter(function(move) {
      return Number.isFinite(move.score);
    });
    if (!normal.length) return moves[0] || null;
    const zone = normal.filter(function(move) {
      return Math.abs(move.score - 1) <= 0.4;
    });
    if (zone.length) return zone[Math.floor(Math.random() * zone.length)];
    const quiet = normal.filter(function(move) {
      return Math.abs(move.score) <= 0.5;
    });
    if (quiet.length) return quiet[Math.floor(Math.random() * quiet.length)];
    return normal.sort(function(a, b) { return b.score - a.score; })[0];
  }

  function handleHostMessage(event) {
    const message = event && event.data ? event.data : {};
    if (!message.type) return;
    if (message.type === "SETTINGS" || message.type === "SETTINGS_CHANGED" || message.type === "APPLY_SETTINGS") {
      saveConfig(message.data || {});
      engineMoves = [];
      bookMoves = [];
      bestMove = null;
      renderOverlays();
      return;
    }
    if (message.type === "ENGINE_RESULT" || message.type === "ENGINE_EVALUATION") {
      const data = message.data || {};
      engineMoves = Array.isArray(data.moves) ? data.moves.map(normalizeMove).filter(Boolean) : [];
      bestMove = normalizeMove(data.bestMove || engineMoves[0]);
      renderOverlays();
      return;
    }
    if (message.type === "BEST_MOVE") {
      bestMove = normalizeMove((message.data || {}).move || message.data);
      renderOverlays();
      return;
    }
    if (message.type === "BOOK_MOVES" || message.type === "BOOK_RESULT") {
      const data = message.data;
      bookMoves = Array.isArray(data) ? data.map(normalizeMove).filter(Boolean) : (Array.isArray(data && data.moves) ? data.moves.map(normalizeMove).filter(Boolean) : []);
      renderOverlays();
      return;
    }
    if (message.type === "CLEAR_OVERLAYS") {
      engineMoves = [];
      bookMoves = [];
      bestMove = null;
      clearOverlay();
      return;
    }
    if (message.type === "PLAY_MOVE") {
      void playMove(message.data && message.data.move ? message.data.move : message.data, "host");
      return;
    }
    if (message.type === "GET_STATE") {
      const state = getState();
      if (state) {
        sendHost("STATE_RESPONSE", {
          site: state.site,
          fen: state.fen,
          turn: state.turn,
          playerColor: state.playerColor,
          isGameOver: state.isGameOver,
          fenHistory: state.fenHistory || [],
          uciHistory: state.uciHistory || null,
          username: state.username || null
        }, message.requestId);
      }
      return;
    }
    if (message.type === "ENGINE_STOP") {
      if (window.SolisEngineController && typeof window.SolisEngineController.stop === "function") window.SolisEngineController.stop();
      return;
    }
  }

  async function checkState() {
    if (!SITE) return;
    if (SITE === "lichess.org") wrapLichessMoveSource();
    const state = getState();
    if (!state) return;
    readDomStatus(state);

    if (state.fen && state.fen !== lastFen) {
      const previousFen = lastFen;
      lastFen = state.fen;
      lastState = state;
      sendHost("FEN_UPDATE", {
        site: SITE,
        fen: state.fen,
        previousFen: previousFen,
        turn: state.turn,
        playerColor: state.playerColor,
        isGameOver: state.isGameOver,
        fenHistory: state.fenHistory || [],
        uciHistory: state.uciHistory || null,
        username: state.username || null
      });
      engineMoves = [];
      bookMoves = [];
      bestMove = null;
      clearOverlay();
      void requestAnalysis(state);
    } else {
      lastState = state;
      renderOverlays();
    }
  }

  function installObservers() {
    mutationObserver = new MutationObserver(function() {
      if (scanTimer) return;
      scanTimer = setTimeout(function() {
        scanTimer = null;
        void checkState();
      }, 40);
    });
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true
    });

    resizeObserver = new ResizeObserver(function() {
      renderOverlays();
    });
    const board = getBoardElement();
    if (board) resizeObserver.observe(board);
    window.addEventListener("resize", renderOverlays, { passive: true });
    window.addEventListener("scroll", renderOverlays, { passive: true, capture: true });
  }

  function installKeyboard() {
    window.addEventListener("keyup", async function(event) {
      if (!engineMoves.length && !bookMoves.length && !bestMove) return;
      if (event.key === config.key) {
        const move = bestMove || engineMoves[0] || bookMoves[0];
        if (move) await playMove(move, "keyboard");
      } else if (event.key === config.key2) {
        const source = engineMoves.length ? engineMoves : bookMoves;
        const move = chooseBalanced(source, lastState && lastState.playerColor ? lastState.playerColor : "white");
        if (move) await playMove(move, "keyboard-balanced");
      }
    });
  }

  function init() {
    if (!SITE) {
      sendHost("BRIDGE_STATUS", { status: "unsupported-site", hostname: window.location.hostname });
      return;
    }
    if (webview && typeof webview.addEventListener === "function") webview.addEventListener("message", handleHostMessage);
    sendHost("BRIDGE_STATUS", {
      status: "content-ready",
      site: SITE,
      url: window.location.href
    });
    installObservers();
    installKeyboard();
    void checkState();
    setInterval(function() {
      if (SITE === "lichess.org") wrapLichessMoveSource();
      void checkState();
    }, 120);
  }

  init();
})();