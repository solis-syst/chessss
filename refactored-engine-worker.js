const ENGINE_WORKER_VERSION = "webview2-1";

let engineName = null;
let engineHandler = null;
let engineBlobUrl = null;
let assetBase = "";
let currentFen = "";
let currentOptions = {};
let maia = null;
let stopped = false;

const ENGINE_FILES = {
  komodo: { script: "lib/komodo.js", wasm: "lib/komodo.wasm", book: "book/book.bin" },
  stockfish6: { script: "lib/stockfish6.js" },
  stockfish11: { script: "lib/stockfish11.js" },
  lozza: { script: "lib/lozza.js" },
  wukong: { script: "lib/wukong.js" },
  torch: { script: "lib/torch.js", wasm: "lib/torch.wasm" },
};

function send(type, data = null, requestId = null) {
  self.postMessage({ type, data, requestId });
}

function resolveAsset(path) {
  const base = String(assetBase || "").trim();
  if (base) return new URL(path, base.endsWith("/") ? base : `${base}/`).href;
  return new URL(path, self.location.href).href;
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response.text();
}

function patchEngineSource(source, name) {
  let code = source;
  if (name === "komodo") {
    const wasmUrl = resolveAsset("lib/komodo.wasm");
    const bookUrl = resolveAsset("book/book.bin");
    code = code.replace(/var wasmBinaryFile = [^;]+;/, `var wasmBinaryFile = ${JSON.stringify(wasmUrl)};`);
    code = code.replace(/var bookUrl = [\s\S]*?fetch\(bookUrl\)/, `var bookUrl = ${JSON.stringify(bookUrl)};\n          fetch(bookUrl)`);
  }
  if (name === "torch") {
    const wasmUrl = resolveAsset("lib/torch.wasm");
    code = code.replace(/var wasmBinaryFile = [^;]+;/, `var wasmBinaryFile = ${JSON.stringify(wasmUrl)};`);
  }
  return code;
}

async function loadClassicEngine(name) {
  const definition = ENGINE_FILES[name];
  if (!definition) throw new Error(`Unsupported engine: ${name}`);
  const source = await fetchText(resolveAsset(definition.script));
  const patched = patchEngineSource(source, name);
  engineBlobUrl && URL.revokeObjectURL(engineBlobUrl);
  engineBlobUrl = URL.createObjectURL(new Blob([patched], { type: "application/javascript" }));
  self.onmessage = null;
  importScripts(engineBlobUrl);
  engineHandler = self.onmessage;
  if (typeof engineHandler !== "function") throw new Error(`Engine ${name} did not register a worker message handler`);
  self.onmessage = hostMessageHandler;
  send("ready", { engine: name, version: ENGINE_WORKER_VERSION });
}

function engineCommand(command) {
  if (!engineHandler) throw new Error("Engine is not initialized");
  if (engineName === "wukong") {
    if (typeof command === "string") return engineHandler.call(self, { data: { command } });
    return engineHandler.call(self, { data: command });
  }
  return engineHandler.call(self, { data: command });
}

function configureUci() {
  if (!engineHandler) return;
  const cfg = currentOptions || {};
  if (engineName === "komodo") {
    engineCommand("uci");
    engineCommand(`setoption name Personality value ${cfg.style || "Default"}`);
    engineCommand("setoption name UCI LimitStrength value true");
    engineCommand(`setoption name UCI Elo value ${Number(cfg.elo || 3500)}`);
    engineCommand(`setoption name MultiPV value ${Number(cfg.lines || 5)}`);
  } else if (engineName === "stockfish6") {
    engineCommand("uci");
    engineCommand(`setoption name Mobility (Midgame) value ${Number(cfg.st6_mobilityMid ?? 100)}`);
    engineCommand(`setoption name Mobility (Endgame) value ${Number(cfg.st6_mobilityEnd ?? 100)}`);
    engineCommand(`setoption name Pawn Structure (Midgame) value ${Number(cfg.st6_pawnStructureMid ?? 100)}`);
    engineCommand(`setoption name Pawn Structure (Endgame) value ${Number(cfg.st6_pawnStructureEnd ?? 100)}`);
    engineCommand(`setoption name Passed Pawns (Midgame) value ${Number(cfg.st6_passedPawnsMid ?? 100)}`);
    engineCommand(`setoption name Passed Pawns (Endgame) value ${Number(cfg.st6_passedPawnsEnd ?? 100)}`);
    engineCommand(`setoption name King Safety value ${Number(cfg.st6_kingSafety ?? 100)}`);
    engineCommand(`setoption name MultiPV value ${Number(cfg.lines || 5)}`);
  } else if (engineName === "stockfish11") {
    engineCommand("uci");
    engineCommand(`setoption name MultiPV value ${Number(cfg.lines || 5)}`);
    engineCommand("setoption name Ponder value false");
  } else if (engineName === "torch") {
    engineCommand("uci");
    engineCommand("setoption name UseDeclarativePositionCommand value true");
    engineCommand("setoption name BlackElo value 3200");
    engineCommand("setoption name WhiteElo value 3200");
    engineCommand("setoption name HandleContinuations value true");
    engineCommand(`setoption name HandleContinuationsDepth value ${Number(cfg.depth2 || 10)}`);
    engineCommand("setoption name UserColor value white");
    engineCommand("setoption name BotChatPrioritizePlayerMove value true");
    engineCommand("setoption name SerializeSpeechDetails value true");
    engineCommand("setoption name AllowBoardEventsWithoutSpeech value true");
    engineCommand("setoption name ServeCommandV2 value true");
    engineCommand("setoption name SpeechV3 value true");
    engineCommand("setoption name ClassificationV3 value true");
    engineCommand("setoption name UCI_Chess960 value false");
    engineCommand("setoption name UseRatingRanges value true");
  }
}

function issuePosition(fen) {
  currentFen = fen;
  if (!engineHandler) return;
  if (engineName === "wukong") {
    engineCommand({ command: `position fen ${fen}` });
    return;
  }
  engineCommand(`position fen ${fen}`);
}

function issueGo(depth, movetime) {
  stopped = false;
  if (!engineHandler) throw new Error("Engine is not initialized");
  if (engineName === "wukong") {
    if (movetime != null) engineCommand({ command: `go movetime ${Math.max(1, Number(movetime))}` });
    else engineCommand({ command: `go depth ${Math.max(1, Number(depth || 10))}` });
    return;
  }
  const command = movetime != null
    ? `go movetime ${Math.max(1, Number(movetime))}`
    : `go depth ${Math.max(1, Number(depth || 10))}`;
  engineCommand(command);
}

function stopEngine() {
  stopped = true;
  try {
    if (engineName === "wukong") engineCommand({ command: "stop" });
    else engineCommand("stop");
  } catch {}
}

async function loadMaia(options) {
  const ortRuntimeUrl = options.ortRuntimeUrl || resolveAsset("lib/ort/ort.min.js");
  const ortBaseUrl = options.ortBaseUrl || resolveAsset("lib/ort/");
  const modelUrl = options.modelUrl || resolveAsset("lib/maia3/maia3-5m.onnx");
  const movesUrl = options.movesUrl || resolveAsset("lib/maia3/all_moves.json");
  const chessUrl = options.chessUrl || resolveAsset("lib/chess_min.js");
  send("status", { engine: "maia3", status: "loading" });
  if (typeof Chess !== "function") importScripts(chessUrl);
  if (typeof ort === "undefined") importScripts(ortRuntimeUrl);
  ort.env.wasm.wasmPaths = ortBaseUrl;
  const [modelResponse, movesResponse] = await Promise.all([fetch(modelUrl), fetch(movesUrl)]);
  if (!modelResponse.ok) throw new Error(`Failed to load Maia model: HTTP ${modelResponse.status}`);
  if (!movesResponse.ok) throw new Error(`Failed to load Maia move map: HTTP ${movesResponse.status}`);
  const modelBuffer = await modelResponse.arrayBuffer();
  const allMoves = await movesResponse.json();
  const session = await ort.InferenceSession.create(modelBuffer, { executionProviders: ["wasm"] });
  const allMovesDict = Object.create(null);
  allMoves.forEach((move, index) => { allMovesDict[move] = index; });
  maia = { session, allMoves, allMovesDict };
  send("ready", { engine: "maia3", version: ENGINE_WORKER_VERSION });
}

const PIECE_MAP = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

function mirrorSquare(square) {
  return square[0] + (9 - Number(square[1]));
}

function mirrorMove(uci) {
  const promo = uci.length > 4 ? uci.slice(4) : "";
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}

function tokenizeBoard(fen) {
  const tokens = new Float32Array(64 * 12);
  const parts = String(fen).split(/\s+/);
  const turn = parts[1] === "b" ? "b" : "w";
  const ranks = parts[0].split("/");
  const boardRanks = turn === "w" ? ranks : [...ranks].reverse();
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    const rank = boardRanks[7 - rankIdx] || "8";
    let fileIdx = 0;
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        fileIdx += Number(ch);
        continue;
      }
      if (fileIdx >= 8) continue;
      const square = rankIdx * 8 + fileIdx;
      const isWhite = ch === ch.toUpperCase();
      const isOurPiece = turn === "w" ? isWhite : !isWhite;
      const pieceType = PIECE_MAP[ch.toLowerCase()];
      if (!pieceType) {
        fileIdx++;
        continue;
      }
      const tokenIdx = isOurPiece ? pieceType - 1 : pieceType + 5;
      tokens[square * 12 + tokenIdx] = 1;
      fileIdx++;
    }
  }
  return tokens;
}

function getHistoricalTokens(history) {
  const H = 8;
  const feats = H * 12 + 1;
  const out = new Float32Array(64 * feats);
  const padded = [];
  while (padded.length < H) padded.push(history[0]);
  for (const entry of history) padded.push(entry);
  const sliced = padded.slice(padded.length - H);
  for (let sq = 0; sq < 64; sq++) {
    for (let h = 0; h < H; h++) {
      const src = sliced[h];
      for (let f = 0; f < 12; f++) out[sq * feats + h * 12 + f] = src[sq * 12 + f];
    }
    out[sq * feats + H * 12] = 0;
  }
  return out;
}

function getLegalMovesMask(fen, allMovesDict, turn) {
  const mask = new Uint8Array(4352);
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return mask;
  }
  const legal = chess.moves({ verbose: true });
  for (const move of legal) {
    let uci = `${move.from}${move.to}${move.promotion || ""}`;
    if (turn === "b") uci = mirrorMove(uci);
    const index = allMovesDict[uci];
    if (index !== undefined) mask[index] = 1;
  }
  return mask;
}

async function runMaia(fen, options = {}) {
  if (!maia) throw new Error("Maia 3 is not initialized");
  const turn = String(fen).split(/\s+/)[1] === "b" ? "b" : "w";
  const boardTokens = tokenizeBoard(fen);
  const tokenFlat = getHistoricalTokens([boardTokens]);
  const tokens = tokenFlat;
  const eloSelf = Number(options.elo || 1500);
  const eloOppo = Number(options.oppoElo || options.elo || 1500);
  const input = {
    tokens: new ort.Tensor("float32", tokens, [1, 64, 97]),
    self_elo: new ort.Tensor("int64", BigInt64Array.from([BigInt(eloSelf)]), [1]),
    oppo_elo: new ort.Tensor("int64", BigInt64Array.from([BigInt(eloOppo)]), [1]),
  };
  let result;
  try {
    result = await maia.session.run(input);
  } catch {
    const inputNames = maia.session.inputNames || Object.keys(input);
    const inputMap = Object.create(null);
    inputNames.forEach((name, index) => {
      inputMap[name] = Object.values(input)[index] || Object.values(input)[0];
    });
    result = await maia.session.run(inputMap);
  }
  const candidate = result.logits_move || result.logits || result.move || Object.values(result)[0];
  const logits = candidate?.data || candidate;
  if (!logits) throw new Error("Maia 3 returned no move logits");
  const mask = getLegalMovesMask(fen, maia.allMovesDict, turn);
  const count = Math.min(4352, logits.length);
  let maxLogit = -Infinity;
  for (let i = 0; i < count; i++) if (mask[i] && Number.isFinite(logits[i]) && logits[i] > maxLogit) maxLogit = logits[i];
  if (!Number.isFinite(maxLogit)) return [];
  const probabilities = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (!mask[i] || !Number.isFinite(logits[i])) continue;
    const p = Math.exp(logits[i] - maxLogit);
    probabilities.push({ index: i, prob: p });
    sum += p;
  }
  probabilities.forEach((item) => { item.prob /= sum || 1; });
  probabilities.sort((a, b) => b.prob - a.prob);
  const limit = Math.max(1, Number(options.lines || 5));
  return probabilities.slice(0, limit).map((item, index) => {
    let uci = maia.allMoves[item.index] || "0000";
    if (turn === "b") uci = mirrorMove(uci);
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      uci,
      eval: `${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}`,
      probability: item.prob,
      rank: index + 1,
      fen,
    };
  });
}

async function initialize(message) {
  engineName = message.engine;
  assetBase = message.assetBase || assetBase;
  currentOptions = message.options || {};
  maia = null;
  engineHandler = null;
  stopped = false;
  if (engineName === "maia3") {
    await loadMaia(message);
    return;
  }
  await loadClassicEngine(engineName);
  await new Promise((resolve) => setTimeout(resolve, 0));
  configureUci();
}

async function handleStructuredMessage(message) {
  if (message.type === "init") {
    try {
      await initialize(message);
    } catch (error) {
      send("error", { message: error?.message || String(error) }, message.requestId || null);
    }
    return;
  }
  if (message.type === "set-options") {
    currentOptions = { ...currentOptions, ...(message.options || {}) };
    configureUci();
    return;
  }
  if (message.type === "stop") {
    stopEngine();
    return;
  }
  if (message.type === "quit") {
    stopEngine();
    try { engineCommand(engineName === "wukong" ? { command: "quit" } : "quit"); } catch {}
    engineHandler = null;
    return;
  }
  if (message.type === "position") {
    issuePosition(message.fen);
    return;
  }
  if (message.type === "go") {
    if (engineName === "maia3") {
      try {
        const moves = await runMaia(message.fen || currentFen, message.options || currentOptions);
        send("analysis", { engine: "maia3", fen: message.fen || currentFen, moves }, message.requestId || null);
      } catch (error) {
        send("error", { message: error?.message || String(error) }, message.requestId || null);
      }
      return;
    }
    issueGo(message.depth, message.movetime);
    return;
  }
  if (message.type === "command") {
    if (message.command === "position") {
      issuePosition(message.fen);
      return;
    }
    if (message.command === "go") {
      issueGo(message.depth, message.movetime);
      return;
    }
    if (message.command === "stop") {
      stopEngine();
      return;
    }
    engineCommand(message.value);
    return;
  }
}

async function hostMessageHandler(event) {
  const message = event?.data;
  try {
    if (typeof message === "string") {
      if (engineName === "maia3") {
        const parts = message.trim().split(/\s+/);
        if (parts[0] === "position" && parts[1] === "fen") currentFen = parts.slice(2).join(" ");
        else if (parts[0] === "go") await handleStructuredMessage({ type: "go", fen: currentFen, depth: Number(parts[2] === "depth" ? parts[3] : 10) });
        return;
      }
      engineCommand(message);
      return;
    }
    await handleStructuredMessage(message || {});
  } catch (error) {
    send("error", { message: error?.message || String(error) }, message?.requestId || null);
  }
}

self.onmessage = hostMessageHandler;