const DEFAULTS={
  engine:"komodo",
  hideArrow:false,
  showEval:false,
  moveClassification:false,
  autoMove:false
};

const $=id=>document.getElementById(id);

function loadConfig(){
  chrome.storage.local.get(["chessConfig"],result=>{
    const cfg={...DEFAULTS,...(result.chessConfig||{})};
    $("engine").value=cfg.engine;
    $("showArrows").checked=!cfg.hideArrow;
    $("showEval").checked=!!cfg.showEval;
    $("moveClassification").checked=!!cfg.moveClassification;
    $("autoMove").checked=!!cfg.autoMove;
    updateEnginePill(cfg.engine);
  });
}

function saveConfig(changes){
  chrome.storage.local.get(["chessConfig"],result=>{
    const cfg={...DEFAULTS,...(result.chessConfig||{}),...changes};
    chrome.storage.local.set({chessConfig:cfg});
  });
}

function updateEnginePill(engine){
  const labels={
    komodo:"Komodo",
    maia3:"Maia 3",
    stockfish11:"Stockfish 11",
    stockfish6:"Stockfish 6",
    lozza:"Lozza",
    wukong:"Wukong JS",
    None:"None"
  };
  $("enginePill").textContent=labels[engine]||"Engine";
}

function updateSiteStatus(){
  chrome.tabs.query({active:true,currentWindow:true},tabs=>{
    const tab=tabs[0];
    let supported=false;
    try{
      supported=!!tab?.url && ["chess.com","www.chess.com","lichess.org","www.lichess.org","worldchess.com","www.worldchess.com"].some(host=>new URL(tab.url).hostname===host||new URL(tab.url).hostname.endsWith("."+host));
    }catch{}
    const status=$("siteStatus");
    $("statusText").textContent=supported?"Supported chess site":"Open a chess site";
    status.classList.toggle("supported",supported);
  });
}

$("engine").addEventListener("change",e=>{
  saveConfig({engine:e.target.value});
  updateEnginePill(e.target.value);
});
$("showArrows").addEventListener("change",e=>saveConfig({hideArrow:!e.target.checked}));
$("showEval").addEventListener("change",e=>saveConfig({showEval:e.target.checked}));
$("moveClassification").addEventListener("change",e=>saveConfig({moveClassification:e.target.checked}));
$("autoMove").addEventListener("change",e=>saveConfig({autoMove:e.target.checked}));

$("openDashboard").addEventListener("click",()=>{
  chrome.tabs.create({url:chrome.runtime.getURL("popup/index.html")});
});
$("reset").addEventListener("click",()=>{
  chrome.storage.local.clear(()=>{
    loadConfig();
    $("reset").textContent="Reset complete";
    setTimeout(()=>$("reset").textContent="Reset settings",1200);
  });
});

loadConfig();
updateSiteStatus();
