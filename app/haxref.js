// releaseTag: #8 — haxref.js
// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
let state = {
  id:null, redName:"ROJO", blueName:"AZUL",
  origRed:"ROJO", origBlue:"AZUL",
  score:{red:0,blue:0}, origScore:{red:0,blue:0},
  events:[], period:1,
  startTime:null, endTime:null, inProgress:false,
  players:{red:[], blue:[]},
  shieldRed:null, shieldBlue:null, // DMark: base64 de escudos
  liveMessageId:null, // DMark: ID del mensaje Discord del marcador
  matchTimer:0  // DMark: segundos transcurridos (cronómetro)
  // NOTA: timerInterval ya NO vive en state — está en _matchTimerInterval
  // para evitar que JSON.stringify lo serialice y rompa startMatchTimer al cargar historial
};
// Intervalo del cronómetro — fuera de state para que no se serialice al guardar partidos
let _matchTimerInterval = null;
let pendingContext   = null;
let discordConnected = false;
let webhookUrl       = '';

// Caché de nodos Discord — se llena en window load, evita re-query en cada ping/update
const DC_EL = { dot:null, txt:null, btn:null, name:null, info:null, nd:null };
function _initDcEl(){
  DC_EL.dot  = document.getElementById('dc-status-dot');
  DC_EL.txt  = document.getElementById('dc-status-txt');
  DC_EL.btn  = document.getElementById('dc-connect-btn');
  DC_EL.name = document.getElementById('dc-wi-name');
  DC_EL.info = document.getElementById('dc-webhook-info');
  DC_EL.nd   = document.getElementById('dc-dot');
}
let endSnapshot      = null;
let msgHistory       = []; // {uid, dcId, label, timestamp, payload}
let _msgSeq          = 1;  // ID aumentativo local único por sesión
function _nextUid(){return _msgSeq++;}
let _pingInterval    = null; // ping periódico al webhook
let _dmarkActive     = false; // true desde que se inicia el marcador visual (antes de recibir el ID)

// ══════════════════════════════════════════════════
//  UTILITY FUNCTIONS (DMark)
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
//  DMark: CRONÓMETRO DEL PARTIDO
// ══════════════════════════════════════════════════
// Caché del intervalo de actualización del marcador
// Se recalcula en startMatchTimer y cuando el usuario cambia el input
let _cachedDmarkInterval = parseInt(localStorage.getItem('dmark_interval') || '15') || 15;

function startMatchTimer() {
  if (_matchTimerInterval) return;
  // Leer el intervalo una vez al arrancar, no en cada tick
  _cachedDmarkInterval = parseInt(localStorage.getItem('dmark_interval') || '15') || 15;
  _matchTimerInterval = setInterval(() => {
    if (state.inProgress && !state.endTime && !state.paused) {
      state.matchTimer++;
      if (state.matchTimer % _cachedDmarkInterval === 0) updateLiveScoreboard();
      updatePeriodUI();
    }
  }, 1000);
}

function toggleQuickPause(){
  if(!state.inProgress || state.endTime) return;
  state.paused = !state.paused;
  updatePeriodUI();
  updateLiveScoreboard();
  autoSave();
}

function stopMatchTimer() {
  if (_matchTimerInterval) {
    clearInterval(_matchTimerInterval);
    _matchTimerInterval = null;
  }
}

function resetMatchTimer() {
  state.matchTimer = 0;
  stopMatchTimer();
}

function getMatchMinute() {
  return Math.floor(state.matchTimer / 60);
}

function getMatchMinuteRounded() {
  const totalMinutes = Math.floor(state.matchTimer / 60);
  const seconds = state.matchTimer % 60;
  // Redondear segundos a la decena más cercana
  const roundedSeconds = Math.floor(seconds / 10) * 10;
  return `${totalMinutes}:${roundedSeconds.toString().padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════
//  MODAL Y SANCIONES
// ══════════════════════════════════════════════════
const modal={
  el:document.getElementById('modal-overlay'),
  input:document.getElementById('modal-input'),
  reason:document.getElementById('modal-reason'),
  suggestions:document.getElementById('suggestions'),
  callback:null,needsReason:false
};
modal.el.addEventListener('click', (e) => { if (e.target === modal.el) cancelModal(); });

// ── Helpers de apertura/cierre fluidos (120hz) ────────────────────
const _MODAL_DUR = 260;
let _lastClickOrigin = null; // coordenadas del último click

// Rastrear origen de cada click para animar desde ahí
document.addEventListener('mousedown', e => {
  _lastClickOrigin = { x: e.clientX, y: e.clientY };
}, true);
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  _lastClickOrigin = { x: t.clientX, y: t.clientY };
}, { passive: true, capture: true });

// ── Background zoom al abrir/cerrar modales ───────────────────
let _bgZoomLevel = 0;
function bgZoom(delta) {
  _bgZoomLevel = Math.max(0, _bgZoomLevel + delta);
  document.getElementById('app-bg')?.classList.toggle('zoomed', _bgZoomLevel > 0);
}

function _mOpen(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return;
  el.classList.remove('modal-closing');
  el.style.display = 'flex';

  // Calcular transform-origin desde la posición del click
  if (_lastClickOrigin) {
    const r   = el.getBoundingClientRect();
    const ox  = ((_lastClickOrigin.x - r.left) / r.width  * 100).toFixed(1) + '%';
    const oy  = ((_lastClickOrigin.y - r.top)  / r.height * 100).toFixed(1) + '%';
    // Clampar para que no quede fuera del modal
    const oxN = Math.max(5, Math.min(95, parseFloat(ox)));
    const oyN = Math.max(5, Math.min(95, parseFloat(oy)));
    // Aplicar al card/sheet hijo directo
    const inner = el.querySelector('.modal-card,.modal-sheet,.generic-card,.whp-card,.mh-panel');
    if (inner) inner.style.transformOrigin = `${oxN}% ${oyN}%`;
  }

  void el.offsetWidth;
  el.classList.add('modal-open');
  bgZoom(1);
}
function _mClose(idOrEl, cb) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el || !el.classList.contains('modal-open')) { if (cb) cb(); return; }
  el.classList.remove('modal-open');
  el.classList.add('modal-closing');
  bgZoom(-1);
  setTimeout(() => {
    el.classList.remove('modal-closing');
    el.style.display = 'none';
    if (cb) cb();
  }, _MODAL_DUR);
}

// ══════════════════════════════════════════════════
//  COUNTDOWN QUEUE
// ══════════════════════════════════════════════════
let cdQueue=[], cdRunning=false, cdInterval=null, cdRemaining=0, cdCurrentCb=null;
let cdDelay=parseInt(localStorage.getItem('haxref_delay')||'10');
let pingIntervalSecs=parseInt(localStorage.getItem('haxref_ping_interval')||'30');
let goalAnimEnabled=true; // animación de balón local siempre activa
let goalAnimType='simple';
let goalInitMsg='⚽';
let miniModeEnabled=localStorage.getItem('haxref_mini_mode')==='1';
let zoomScale=parseFloat(localStorage.getItem('haxref_zoom')||'1.0');
let _activeFastPing=false;

// ── ZOOM NATIVO (sin distorsión) ──
function _applyZoom(scale){
  document.body.style.zoom = scale;
  const el = document.getElementById('zoom-val');
  if(el) el.textContent = Math.round(scale*100) + '%';
  const btn = document.getElementById('revert-zoom-btn');
  if(btn) btn.style.display = Math.abs(scale - 1.0) > 0.01 ? 'inline-flex' : 'none';
  localStorage.setItem('haxref_zoom', scale);
}

function changeZoom(delta){
  zoomScale = Math.max(0.5, Math.min(2.0, parseFloat((zoomScale + delta).toFixed(1))));
  _applyZoom(zoomScale);
}

function revertZoom(){
  zoomScale = 1.0;
  _applyZoom(1.0);
}

// Ctrl + rueda del ratón o Ctrl +/- como el navegador
window.addEventListener('wheel', e => {
  if(!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  changeZoom(delta);
}, {passive: false});

// ── TEMA ──
let lightMode = localStorage.getItem('haxref_light_mode') === '1';

function _applyTheme(light){
  document.body.classList.toggle('light-mode', light);
  const btn = document.getElementById('theme-toggle-btn');
  if(btn) btn.textContent = light ? '☀️ CLARO' : '🌙 OSCURO';
}

function toggleTheme(){
  lightMode = !lightMode;
  localStorage.setItem('haxref_light_mode', lightMode ? '1' : '0');
  _applyTheme(lightMode);
}

// ── IDIOMA ──
let currentLang = localStorage.getItem('haxref_lang') || 'es';

// ── Claves de localStorage por dominio (únicas, usadas en export/import) ──
const WEBHOOK_KEYS = [
  'haxref_webhooks','haxref_webhook_url','haxref_v2_webhook',
  'haxref_webhook_active','haxref_webhook_label',
  'dc_emoji_red','dc_emoji_blue',
];
const SETTINGS_KEYS = [
  'half_duration','dmark_interval','scoreboard_league','scoreboard_matchday',
  'haxref_lang','haxref_theme','haxref_zoom','haxref_mini',
  'dmark_colors','dmark_bg','ping_interval',
];

const STRINGS = {
  es: {
    score:'MARCADOR', cards:'SANCIONES', discord:'DISCORD', report:'D-MARK',
    export:'EXPORTAR', settings:'AJUSTES', social:'REDES',
    npScore:'Marcador', npCards:'Sanciones', npDiscord:'Discord', npReport:'D-Mark',
    npExport:'Exportar', npSettings:'Ajustes', npSocial:'Redes', npExit:'Salir',
    red:'ROJO', blue:'AZUL', period1:'1ER TIEMPO', period2:'2DO TIEMPO',
    launchNew:'NUEVO PARTIDO', launchHist:'HISTORIAL',
    start:'INICIAR', playing:'EN JUEGO', halfTime:'MEDIO TIEMPO',
    btnHtPause:'⏸ ½T', btnHtResume:'▶ ½T', btnEnd:'🏁 FIN',
    modalTitle:'DATOS JUGADOR', modalPlaceholder:'Nombre del jugador…',
    modalReason:'Motivo (opcional)…', modalConfirm:'CONFIRMAR',
    waiting:'ESPERANDO INICIO…', noConnection:'Sin conexión',
    histTitle:'HISTORIAL', addSep:'＋ SEPARADOR',
    exitMini:'⊞ SALIR MINI',
    whpTitle:'Seleccionar canal', whpNoHook:'SIN WEBHOOK', whpCancel:'CANCELAR',
    mhTitle:'📨 Mensajes enviados', mhEmpty:'Sin mensajes en esta sesión',
    dcUrlLabel:'URL del Webhook', dcCheck:'COMPROBAR', dcConnect:'CONECTAR',
    dcSavedLabel:'Canales guardados', dcAddBtn:'＋ Añadir',
    sDelayTitle:'Delay de envío', sDelayHint:'Segundos antes de enviar al webhook',
    sPingTitle:'Intervalo de ping', sPingHint:'Verificar conexión cada N segundos',
    sMiniTitle:'Mini modo', sMiniHint:'Marcador compacto',
    sAnimTitle:'Animación de gol', sAnimHint:'Balón flotante al anotar',
    sThemeTitle:'Tema', sThemeHint:'Oscuro / Claro',    sLangTitle:'Idioma', sLangHint:'ES · EN · PT',
    sZoomTitle:'Zoom general', sZoomHint:'Ctrl + / −',
    langBtn:'🇲🇽 ES'
  },
  en: {
    score:'SCOREBOARD', cards:'CARDS', discord:'DISCORD', report:'D-MARK',
    export:'EXPORT', settings:'SETTINGS', social:'LINKS',
    npScore:'Scoreboard', npCards:'Cards', npDiscord:'Discord', npReport:'D-Mark',
    npExport:'Export', npSettings:'Settings', npSocial:'Links', npExit:'Exit',
    red:'RED', blue:'BLUE', period1:'1ST HALF', period2:'2ND HALF',
    launchNew:'NEW MATCH', launchHist:'HISTORY',
    start:'START', playing:'IN PLAY', halfTime:'HALF TIME',
    btnHtPause:'⏸ HT', btnHtResume:'▶ HT', btnEnd:'🏁 END',
    modalTitle:'PLAYER DATA', modalPlaceholder:'Player name…',
    modalReason:'Reason (optional)…', modalConfirm:'CONFIRM',
    waiting:'WAITING TO START…', noConnection:'Not connected',
    histTitle:'HISTORY', addSep:'＋ SEPARATOR',
    exitMini:'⊞ EXIT MINI',
    whpTitle:'Select channel', whpNoHook:'NO WEBHOOK', whpCancel:'CANCEL',
    mhTitle:'📨 Sent messages', mhEmpty:'No messages this session',
    dcUrlLabel:'Webhook URL', dcCheck:'CHECK', dcConnect:'CONNECT',
    dcSavedLabel:'Saved channels', dcAddBtn:'＋ Add',
    sDelayTitle:'Send delay', sDelayHint:'Seconds before sending to webhook',
    sPingTitle:'Ping interval', sPingHint:'Check connection every N seconds',
    sMiniTitle:'Mini mode', sMiniHint:'Compact scoreboard',
    sAnimTitle:'Goal animation', sAnimHint:'Floating ball on goal',
    sThemeTitle:'Theme', sThemeHint:'Dark / Light',
    sLangTitle:'Language', sLangHint:'ES · EN · PT',
    sZoomTitle:'General zoom', sZoomHint:'Ctrl + / −',
    langBtn:'🇺🇸 EN'
  },
  pt: {
    score:'PLACAR', cards:'CARTÕES', discord:'DISCORD', report:'D-MARK',
    export:'EXPORTAR', settings:'CONFIG.', social:'LINKS',
    npScore:'Placar', npCards:'Cartões', npDiscord:'Discord', npReport:'D-Mark',
    npExport:'Exportar', npSettings:'Config.', npSocial:'Links', npExit:'Sair',
    red:'VERMELHO', blue:'AZUL', period1:'1º TEMPO', period2:'2º TEMPO',
    launchNew:'NOVA PARTIDA', launchHist:'HISTÓRICO',
    start:'INICIAR', playing:'EM JOGO', halfTime:'INTERVALO',
    btnHtPause:'⏸ INT.', btnHtResume:'▶ INT.', btnEnd:'🏁 FIM',
    modalTitle:'DADOS JOGADOR', modalPlaceholder:'Nome do jogador…',
    modalReason:'Motivo (opcional)…', modalConfirm:'CONFIRMAR',
    waiting:'AGUARDANDO INÍCIO…', noConnection:'Sem conexão',
    histTitle:'HISTÓRICO', addSep:'＋ SEPARADOR',
    exitMini:'⊞ SAIR MINI',
    whpTitle:'Selecionar canal', whpNoHook:'SEM WEBHOOK', whpCancel:'CANCELAR',
    mhTitle:'📨 Mensagens enviadas', mhEmpty:'Sem mensagens nesta sessão',
    dcUrlLabel:'URL do Webhook', dcCheck:'VERIFICAR', dcConnect:'CONECTAR',
    dcSavedLabel:'Canais salvos', dcAddBtn:'＋ Adicionar',
    sDelayTitle:'Delay de envio', sDelayHint:'Segundos antes de enviar ao webhook',
    sPingTitle:'Intervalo de ping', sPingHint:'Verificar conexão a cada N segundos',
    sMiniTitle:'Modo mini', sMiniHint:'Placar compacto',
    sAnimTitle:'Animação de gol', sAnimHint:'Bola flutuante ao marcar',
    sThemeTitle:'Tema', sThemeHint:'Escuro / Claro',
    sLangTitle:'Idioma', sLangHint:'ES · EN · PT',
    sZoomTitle:'Zoom geral', sZoomHint:'Ctrl + / −',
    langBtn:'🇧🇷 PT'
  }
};

const LANG_CYCLE = ['es','en','pt'];

function _setNodeText(el, txt) {
  if (!el) return;
  el.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = txt + ' '; });
}

function _applyLang(lang){
  const s = STRINGS[lang] || STRINGS['es'];

  // ── Nav desktop (text nodes before <span>) ─────────────────────
  [['nav-1',s.score],['nav-2',s.discord],['nav-3',s.report],['nav-4',s.export]]
    .forEach(([id,txt]) => _setNodeText(document.getElementById(id), txt));

  // ── Nav picker labels ──────────────────────────────────────────
  [['np-1',s.npScore],['np-2',s.npDiscord],['np-3',s.npReport],
   ['np-4',s.npExport],['np-5',s.npSettings],['np-6',s.npSocial],['np-exit',s.npExit]]
    .forEach(([id,txt]) => {
      const lbl = document.getElementById(id)?.querySelector('.nav-picker-label');
      if (lbl) lbl.textContent = txt;
    });

  // ── Period button ──────────────────────────────────────────────
  const pb = document.getElementById('period-btn');
  if (pb && state) pb.textContent = state.period===1 ? s.period1 : s.period2;

  // ── Team labels ────────────────────────────────────────────────
  const rn = state?.redName  || s.red;
  const bn = state?.blueName || s.blue;
  ['lbl-red','cards-lbl-red'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=rn; });
  ['lbl-blue','cards-lbl-blue'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=bn; });

  // ── Launcher ───────────────────────────────────────────────────
  _setNodeText(document.querySelector('.launch-btn-primary'), s.launchNew);
  _setNodeText(document.querySelector('.launch-btn-secondary'), s.launchHist);

  // ── Match control buttons ──────────────────────────────────────
  const bstart = document.getElementById('btn-start');
  if (bstart && !bstart.classList.contains('playing')) bstart.textContent = s.start;
  const bhtP = document.getElementById('btn-ht-pause');   if (bhtP) bhtP.textContent = s.btnHtPause;
  const bhtR = document.getElementById('btn-ht-resume');  if (bhtR) bhtR.textContent = s.btnHtResume;
  const bend  = document.getElementById('btn-end');        if (bend)  bend.textContent  = s.btnEnd;

  // ── Modal de jugador ───────────────────────────────────────────
  const mtl = document.getElementById('modal-title-label'); if (mtl) mtl.textContent = s.modalTitle;
  const mi  = document.getElementById('modal-input');       if (mi)  mi.placeholder   = s.modalPlaceholder;
  const mr  = document.getElementById('modal-reason');      if (mr)  mr.placeholder   = s.modalReason;
  const mc  = document.querySelector('.modal-confirm-btn'); if (mc)  mc.textContent   = s.modalConfirm;

  // ── Historial ──────────────────────────────────────────────────
  const ht  = document.querySelector('.hist-title');   if (ht)  ht.textContent  = s.histTitle;
  const asb = document.querySelector('.add-sep-btn');  if (asb) asb.textContent = s.addSep;

  // ── Mini mode exit ─────────────────────────────────────────────
  const meb = document.getElementById('mini-exit-btn'); if (meb) meb.textContent = s.exitMini;

  // ── WHP modal ──────────────────────────────────────────────────
  const whpH = document.querySelector('.whp-head-title');  if (whpH) whpH.textContent = s.whpTitle;
  const whpN = document.querySelector('.whp-nohook-btn');  if (whpN) whpN.textContent = s.whpNoHook;
  const whpS = document.querySelector('.whp-skip-btn');    if (whpS) whpS.textContent = s.whpCancel;

  // ── Msg history modal ──────────────────────────────────────────
  const mhT = document.querySelector('.mh-title'); if (mhT) mhT.textContent = s.mhTitle;
  const mhE = document.querySelector('.mh-empty'); if (mhE) mhE.textContent = s.mhEmpty;

  // ── Status text (solo si el partido no ha iniciado) ────────────
  const tld = document.getElementById('time-log-display');
  if (tld && state && !state.inProgress && !state.endTime && state.period === 1) tld.textContent = s.waiting;

  // ── Discord: etiquetas ─────────────────────────────────────────
  const dcUL  = document.querySelector('#sec-discord .settings-card > .settings-label');
  if (dcUL) dcUL.textContent = s.dcUrlLabel;
  const dcChk = document.querySelector('.dc-btn-check'); if (dcChk) dcChk.textContent = s.dcCheck;
  const dcSL  = document.querySelector('#sec-discord .settings-card-head .settings-label');
  if (dcSL) dcSL.textContent = s.dcSavedLabel;
  const dcAdd = document.querySelector('#sec-discord .icon-action-btn'); if (dcAdd) dcAdd.textContent = s.dcAddBtn;

  // ── Settings: titles + hints ───────────────────────────────────
  const sTitles = [s.sPingTitle,s.sMiniTitle,s.sThemeTitle,s.sLangTitle,s.sZoomTitle];
  const sHints  = [s.sPingHint, s.sMiniHint, s.sThemeHint, s.sLangHint, s.sZoomHint];
  document.querySelectorAll('#sec-settings .settings-row').forEach((row, i) => {
    const t = row.querySelector('.settings-row-title'); if (t && sTitles[i]) t.textContent = sTitles[i];
    const h = row.querySelector('.settings-row-sub');   if (h && sHints[i])  h.textContent = sHints[i];
  });

  // ── Lang button + html lang ────────────────────────────────────
  const lb = document.getElementById('lang-toggle-btn'); if (lb) lb.textContent = s.langBtn;
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en' : 'es';
}

function toggleLang(){
  const idx = LANG_CYCLE.indexOf(currentLang);
  currentLang = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
  localStorage.setItem('haxref_lang', currentLang);
  _applyLang(currentLang);
}

function _setToggle(trackId, on) {
  const track = document.getElementById(trackId);
  if (track) track.classList.toggle('on', on);
}

function toggleMiniMode(on){
  miniModeEnabled=on;
  localStorage.setItem('haxref_mini_mode',on?'1':'0');
  document.body.classList.toggle('mini-mode',on);
  const chk=document.getElementById('mini-mode-chk');
  if(chk)chk.checked=on;
  _setToggle('mini-mode-track',on);
  if(on)tab('sec-score',document.getElementById('nav-1'));
}

function enqueueCountdown(label,cb){ cdQueue.push({label,cb}); if(!cdRunning) _processQueue(); }

function _processQueue(){
  if(!cdQueue.length){cdRunning=false;_renderStack();return;}
  cdRunning=true; cdRemaining=cdDelay; cdCurrentCb=cdQueue[0].cb; _renderStack();
  cdInterval=setInterval(()=>{
    cdRemaining--; _renderStack();
    if(cdRemaining<=0){
      clearInterval(cdInterval);cdInterval=null;
      const cb=cdCurrentCb;cdCurrentCb=null;cdQueue.shift();
      if(cb)cb(); _processQueue();
    }
  },1000);
}

// changeDelay eliminada — sin UI en la app desde la sesión de limpieza

// Stepper genérico para inputs numéricos sin spinners nativos
function stepInput(id, delta, min, max){
  const el = document.getElementById(id);
  if (!el) return;
  let val = parseInt(el.value) || 0;
  val = Math.min(max, Math.max(min, val + delta));
  el.value = val;
  el.dispatchEvent(new Event('input'));
}

function changePingInterval(delta){
  pingIntervalSecs=Math.max(10,Math.min(120,pingIntervalSecs+delta));
  localStorage.setItem('haxref_ping_interval',pingIntervalSecs);
  const el=document.getElementById('ping-interval-val');
  if(el)el.textContent=pingIntervalSecs+'s';
  // Reiniciar ping con nuevo intervalo si está conectado
  if(discordConnected)_startPing();
}



function cancelCurrent(){
  if(cdInterval){clearInterval(cdInterval);cdInterval=null;}
  cdCurrentCb=null;
  cdQueue.shift();
  cdRunning=false;
  // Resetear flags de resend si el item cancelado era un reenvío
  _resendStartInFlight=false;
  _resendEndInFlight=false;
  _renderStack();
  if(cdQueue.length)_processQueue();
}
function sendNow(){
  if(cdInterval){clearInterval(cdInterval);cdInterval=null;}
  const cb=cdCurrentCb;cdCurrentCb=null;cdQueue.shift();cdRunning=false;
  _resendStartInFlight=false;_resendEndInFlight=false;
  if(cb){
    try{ cb(); } catch(e){ console.error('[HaxRef] sendNow callback error:', e); }
  }
  _processQueue();
}
function _renderStack(){
  const stack=document.getElementById('countdown-stack');
  stack.innerHTML='';
  if(!cdQueue.length)return;
  const item=cdQueue[0];
  const pct=(cdRemaining/cdDelay*100).toFixed(1);
  const extra=cdQueue.length>1?` <span style="color:#2a1d5a">(+${cdQueue.length-1} en cola)</span>`:'';
  const bar=document.createElement('div');
  bar.className='cd-bar';
  bar.innerHTML=`
    <div class="cd-label">${item.label}${extra}</div>
    <div class="cd-track"><div class="cd-fill" style="width:${pct}%;transition:width 1s linear"></div></div>
    <div class="cd-num">${cdRemaining}</div>
    <button class="cd-send" onclick="sendNow()">ENVIAR</button>
    <button class="cd-cancel" onclick="cancelCurrent()">CANCELAR</button>
    <button class="cd-msgs-btn${msgHistory.length?' has-msgs':''}" onclick="openMsgHistory()">📨${msgHistory.length?` ${msgHistory.length}`:''}</button>`;
  stack.appendChild(bar);
}

// ══════════════════════════════════════════════════
//  DISCORD HELPERS
// ══════════════════════════════════════════════════
async function sendEmbed(payload){
  if(!webhookUrl)return null;
  try{
    const r=await fetch(webhookUrl+'?wait=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({embeds:[payload]})});
    if(!r.ok){
      const errText=await r.text().catch(()=>'');
      showAlert(`⚠️ Error al enviar mensaje a Discord.\nCódigo: ${r.status}${errText?'\n'+errText.slice(0,120):''}`);
      return null;
    }
    const d=await r.json().catch(()=>null);
    return d?d.id:null;
  }catch(e){
    showAlert(`⚠️ No se pudo conectar con Discord.\n${e.message||'Error de red'}`);
    return null;
  }
}
async function patchEmbed(id,payload){
  if(!webhookUrl||!id)return;
  try{await fetch(webhookUrl+'/messages/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({embeds:[payload]})});}catch(e){}
}
async function deleteMsg(id){
  if(!webhookUrl||!id)return;
  try{await fetch(webhookUrl+'/messages/'+id,{method:'DELETE'});}catch(e){}
}

// ── MSG HISTORY ──
function _nowHora(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function _updateMsgsBtn(){
  const btn=document.getElementById('msgs-fixed-btn');
  if(!btn)return;
  const n=msgHistory.length;
  btn.textContent=n?`📨 Mensajes (${n})`:'📨 Mensajes enviados';
  btn.classList.toggle('has-msgs',n>0);
}
function _addMsgHistory(dcId,label,payload){
  if(!dcId)return;
  const uid=_nextUid();
  msgHistory.push({uid,dcId,label,timestamp:_nowHora(),payload:payload||null});
  _updateMsgsBtn();
  _renderStack();
  return uid;
}
// Buscar entrada por uid
function _getMsgByUid(uid){return msgHistory.find(m=>m.uid===uid)||null;}
// Eliminar del historial por uid (sin borrar de Discord)
function _removeMsgByUid(uid){
  msgHistory=msgHistory.filter(m=>m.uid!==uid);
  _updateMsgsBtn();_renderStack();_renderMsgHistory();
}
function openMsgHistory(){
  _renderMsgHistory();
  _mOpen('msg-history-modal');
}
function closeMsgHistory(){ _setModalVisible('msg-history-modal', false); }
function _renderMsgHistory(){
  const body=document.getElementById('mh-body');
  if(!msgHistory.length){body.innerHTML='<div class="mh-empty">Sin mensajes en esta sesión</div>';return;}
  body.innerHTML=msgHistory.map(m=>`
    <div class="mh-row" id="mh-row-${m.uid}">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mh-label">${m.label}</span>
          <span class="mh-time">${m.timestamp}</span>
        </div>
        <textarea class="mh-edit-area" id="mh-edit-${m.uid}" rows="2" placeholder="Editar título del embed…" style="width:100%;background:#000;border:1px solid #1a1030;border-radius:6px;padding:6px 8px;color:#aaa;font-size:11px;font-family:monospace;resize:vertical;outline:none;transition:.2s" onfocus="this.style.borderColor='var(--discord)'" onblur="this.style.borderColor='#1a1030'">${m.editTitle||m.label}</textarea>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="mh-del" onclick="confirmMsgEdit(${m.uid})" style="color:var(--discord);border-color:var(--discord-border)">✓ CONFIRMAR</button>
          <button class="mh-del" onclick="deleteMsgRow(${m.uid})" title="Borrar de Discord">✕</button>
        </div>
      </div>
    </div>`).join('');
}

async function confirmMsgEdit(uid){
  const m=_getMsgByUid(uid);
  if(!m)return;
  const ta=document.getElementById(`mh-edit-${uid}`);
  if(!ta)return;
  const newTitle=ta.value.trim();
  if(!newTitle)return;
  m.editTitle=newTitle;
  // Patch en Discord — conservar color del payload original
  const color=m.payload?.color||0x5865f2;
  await patchEmbed(m.dcId,{title:newTitle,color});
  ta.style.borderColor='#1a3a1a';ta.style.color='#4caf50';
  setTimeout(()=>{ta.style.borderColor='#1a1030';ta.style.color='#aaa';},1200);
}
async function deleteMsgRow(uid){
  const m=_getMsgByUid(uid);
  if(!m)return;
  await deleteMsg(m.dcId).catch(()=>{});
  _removeMsgByUid(uid);
}
document.getElementById('msg-history-modal').addEventListener('click',function(e){if(e.target===this)closeMsgHistory();});

async function fetchWebhookInfo(url){
  // GET al webhook sin ?wait devuelve info del webhook
  try{
    const r=await fetch(url);
    if(!r.ok)return null;
    return await r.json();
  }catch(e){return null;}
}

async function checkWebhook(){
  const url=document.getElementById('dc-url-input').value.trim();
  if(!url){showAlert('Ingresa una URL de webhook primero.');return;}
  const btn=document.querySelector('.dc-btn-check');
  btn.textContent='...';
  try{
    const r=await fetch(url+'?wait=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({embeds:[{title:'Comprobando webhook…',description:'Se elimina en 15 s.',color:5793266}]})});
    if(r.ok){
      const d=await r.json();
      btn.textContent='✓ OK';
      if(d?.id)setTimeout(()=>deleteMsg(d.id),15000);
    }else{
      const errText=await r.text().catch(()=>'');
      btn.textContent='✗ ERROR';
      showAlert(`⚠️ No se pudo verificar el webhook.\nCódigo: ${r.status}${errText?'\n'+errText.slice(0,120):''}`);
    }
  }catch(e){
    btn.textContent='✗ ERROR';
    showAlert(`⚠️ Error de conexión al verificar el webhook.\n${e.message||'Error de red'}`);
  }
  setTimeout(()=>btn.textContent='COMPROBAR',2500);
}

async function toggleDiscordConnect(){
  const url=document.getElementById('dc-url-input').value.trim();
  if(!discordConnected){
    if(!url){showAlert('Ingresa una URL de webhook para conectar.');return;}
    if(!url.startsWith('https://discord.com/api/webhooks/')){showAlert('URL no válida. Debe ser un webhook de Discord.');return;}
    const info=await fetchWebhookInfo(url);
    webhookUrl=url;discordConnected=true;
    // Guardar como perfil si no existe ya
    const profiles=_getProfiles();
    let existing=profiles.find(p=>p.url===url);
    if(!existing){
      const name=info?.name||'Canal '+( profiles.length+1);
      existing={id:'p_'+Date.now(),name,url};
      profiles.push(existing);
      _saveProfiles(profiles);
    }
    _setActiveProfileId(existing.id);
    if(info){
      document.getElementById('dc-wi-name').textContent    = info.name    || '—';
      document.getElementById('dc-wi-guild').textContent   = info.guild_id ? `ID ${info.guild_id}` : '—';
      document.getElementById('dc-wi-channel').textContent = info.channel_id || '—';
      document.getElementById('dc-webhook-info').classList.add('visible');
    }
  }else{
    discordConnected=false;webhookUrl='';
    _setActiveProfileId(null);
    document.getElementById('dc-webhook-info').classList.remove('visible');
  }
  updateDiscordUI();
  renderProfilesList();
}

// P3: deshabilita visualmente los botones de reenvío si no hay webhook activo
function updateResendUI(){
  const btns=[document.getElementById('btn-resend-start'),document.getElementById('btn-resend-end')];
  btns.forEach(b=>{
    if(!b)return;
    b.style.opacity=discordConnected?'1':'0.3';
    b.style.pointerEvents=discordConnected?'auto':'none';
    b.title=discordConnected?b.title:'Conecta el webhook para reenviar';
  });
}

function updateDiscordUI(){
  const {dot,txt,btn,nd,name:sub} = DC_EL;
  if(discordConnected){
    if(dot){dot.classList.add('on','connected');dot.style.background='';dot.style.boxShadow='';}
    if(txt){txt.classList.add('on');txt.textContent='Conectado';txt.style.color='';}
    if(btn){btn.textContent='DESCONECTAR';btn.classList.add('connected');}
    if(nd) nd.classList.add('on');
    _startPing();
  }else{
    if(dot)dot.classList.remove('on','connected');
    if(txt){txt.classList.remove('on');txt.textContent='Sin conexión';}
    if(btn){btn.textContent='CONECTAR';btn.classList.remove('connected');}
    if(nd) nd.classList.remove('on');
    if(sub)sub.textContent='—';
    _stopPing();
  }
  updateResendUI();
}

let _pingInFlight=false;
function _startPing(){
  _stopPing();
  // Cachear referencias del DOM fuera del tick para no hacer getElementById cada vez
  const dot = DC_EL.dot;
  const txt = DC_EL.txt;
  _pingInterval=setInterval(async()=>{
    if(!webhookUrl||!discordConnected||_pingInFlight)return;
    _pingInFlight=true;
    try{
      const r=await fetch(webhookUrl,{method:'GET'});
      if(r.ok){
        if(dot){dot.style.background='';dot.style.boxShadow='';dot.classList.add('on');}
        if(txt){txt.textContent='Conectado';txt.classList.add('on');txt.style.color='';}
      }else{
        if(dot){dot.classList.remove('on');dot.style.background='#ff6b2a';dot.style.boxShadow='0 0 8px rgba(255,107,42,.7)';}
        if(txt){txt.textContent=`Error ${r.status}`;txt.classList.remove('on');txt.style.color='#ff6b2a';}
      }
    }catch(e){
      if(dot){dot.classList.remove('on');dot.style.background='#ff2a2a';dot.style.boxShadow='0 0 8px rgba(255,42,42,.6)';}
      if(txt){txt.textContent='Sin conexión';txt.classList.remove('on');txt.style.color='var(--red)';}
    }finally{_pingInFlight=false;}
  },(_activeFastPing?2:pingIntervalSecs)*1000);
}

function _stopPing(){
  if(_pingInterval){clearInterval(_pingInterval);_pingInterval=null;}
  const {dot,txt} = DC_EL;
  if(dot){dot.style.background='';dot.style.boxShadow='';}
  if(txt){txt.style.color='';}
}

// ══════════════════════════════════════════════════
//  WEBHOOK TEMPLATES — variables simplificadas
// ══════════════════════════════════════════════════
const defaultTemplates={
  start:   {title:'¡Inicia el partido! {teamred} 🆚 {teamblue} · {hora}',                                   color:'#57f287'},
  ht_start:{title:'⏸️ Medio tiempo — {teamred} {scorered} - {scoreblue} {teamblue} · {hora}',               color:'#9d00ff'},
  ht_end:  {title:'▶️ ¡Comienza la 2T! {teamred} {scorered} - {scoreblue} {teamblue} · {hora}',             color:'#888888'},
  goal:    {title:'⚽ GOL de {team} · {teamred} {scorered} - {scoreblue} {teamblue} · {hora}',               color:'#2a8cff'},
  ta:      {title:'🟨 Tarjeta amarilla · {player} ({team}) · {hora}',                                        color:'#ffcc00'},
  tr:      {title:'🟥 Tarjeta roja · {player} ({team}) · {hora}',                                            color:'#ff2a2a'},
  end:     {title:'🏁 Fin — {teamred} {scorered} - {scoreblue} {teamblue} · {recuentohora}',                 color:'#e74c3c'}
};

let templates=JSON.parse(localStorage.getItem('haxref_templates')||'null')||JSON.parse(JSON.stringify(defaultTemplates));
// Migrar keys nuevas si faltan
Object.keys(defaultTemplates).forEach(k=>{if(!templates[k])templates[k]=JSON.parse(JSON.stringify(defaultTemplates[k]));});
// Migrar títulos desactualizados
const _oldTitles={
  ht_end:'▶️ ¡Comienza la 2T! {teamred} 🆚 {teamblue}',
  ta:'🟨 Tarjeta amarilla · {player}',
  tr:'🟥 Tarjeta roja · {player}',
  end:'🏁 Fin del partido — {teamred} {scorered} - {scoreblue} {teamblue}',
  start:'¡Inicia el partido! {teamred} 🆚 {teamblue}'
};
Object.entries(_oldTitles).forEach(([k,old])=>{if(templates[k]&&templates[k].title===old)templates[k].title=defaultTemplates[k].title;});
function hexToDec(hex){return parseInt(hex.replace('#',''),16);}
function applyVars(str,vars){return str.replace(/\{(\w+)\}/g,(_,k)=>vars[k]!==undefined?vars[k]:`{${k}}`);}


// buildWeGrid eliminada — era stub puro { return; } sin implementación

// ══════════════════════════════════════════════════
//  PAYLOADS
// ══════════════════════════════════════════════════
function _scoreVars(){
  return {teamred:state.origRed,teamblue:state.origBlue,scorered:state.origScore.red,scoreblue:state.origScore.blue};
}

function buildHtStartPayload(){
  const t=templates.ht_start;
  return {title:applyVars(t.title,{..._scoreVars(),hora:_nowHora()}),color:hexToDec(t.color)};
}
function buildHtEndPayload(){
  const t=templates.ht_end;
  return {title:applyVars(t.title,{..._scoreVars(),hora:_nowHora()}),color:hexToDec(t.color)};
}
function buildCardPayload(type,player,tName,reason){
  const t=templates[type.toLowerCase()];
  const title=applyVars(t.title,{player,team:tName,reason:reason||'',hora:_nowHora()});
  const titleHasTeam=title.includes(tName);
  let desc='';
  if(!titleHasTeam) desc+=`**Equipo:** ${tName}`;
  const titleHasReason=reason&&title.includes(reason);
  if(reason&&!titleHasReason) desc+=(desc?'\n':'')+`**Motivo:** ${reason}`;
  return {title,description:desc||undefined,color:hexToDec(t.color)};
}
function buildEndPayloadFromSnap(snap){
  const t=templates.end;
  const recuentohora=`${snap.startTime||'?'} → ${snap.endTime||'?'}`;
  const title=applyVars(t.title,{
    teamred:snap.origRed,teamblue:snap.origBlue,
    scorered:snap.origScore.red,scoreblue:snap.origScore.blue,
    recuentohora,hora:snap.endTime||_nowHora()
  });
  let desc=`⏱ ${recuentohora}\n`;
  const cards=snap.events.filter(e=>e.type==='TA'||e.type==='TR');
  if(cards.length){
    desc+='\n**Tarjetas:**\n';
    cards.forEach(e=>{
      const icon=e.type==='TA'?'🟨':'🟥';
      const tn=e.teamName||(e.team==='red'?snap.origRed:snap.origBlue);
      desc+=`${icon} ${e.player} (${tn})${e.wasDouble?' (2TA→TR)':''}${e.reason?` — ${e.reason}`:''}\n`;
    });
  }
  return {title,description:desc.trim(),color:hexToDec(t.color)};
}

// ══════════════════════════════════════════════════
//  EVENTOS DISCORD
// ══════════════════════════════════════════════════

// Envía el canvas como PNG a Discord y guarda el message ID para ediciones futuras
async function _sendScoreboardImage() {
  if (!discordConnected || !webhookUrl) return;
  _dmarkActive = true; // activar flag ANTES del fetch para bloquear mensajes individuales
  try {
    const blob = await generateScoreboardImage();
    if (!blob) { _dmarkActive = false; return; }
    const fd = new FormData();
    fd.append('file', blob, 'marcador.png');
    fd.append('payload_json', JSON.stringify({ content: '' }));
    const r = await fetch(webhookUrl + '?wait=true', { method: 'POST', body: fd });
    if (r.ok) {
      const d = await r.json().catch(() => null);
      if (d?.id) {
        state.liveMessageId = d.id;
        localStorage.setItem('haxref_live_message_id', d.id);
      }
    } else {
      _dmarkActive = false; // si falló el envío, desactivar
    }
  } catch (e) {
    _dmarkActive = false;
    console.warn('DMark: error enviando marcador:', e);
  }
}

// Actualiza el marcador: borra el mensaje anterior y sube uno nuevo
// ── Cola de actualizaciones: evita dos fetches simultáneos ────
const _scoreboardQueue = {
  _running: false,
  _pending: false,
  async push() {
    if (this._running) { this._pending = true; return; }
    this._running = true; this._pending = false;
    try { await _patchScoreboardImage_exec(); }
    finally {
      this._running = false;
      if (this._pending) { this._pending = false; setTimeout(() => this.push(), 400); }
    }
  }
};
async function _patchScoreboardImage() {
  if (!discordConnected || !webhookUrl || !state.liveMessageId) return;
  _scoreboardQueue.push();
}
async function _patchScoreboardImage_exec() {
  if (!discordConnected || !webhookUrl || !state.liveMessageId) return;
  try {
    const blob = await generateScoreboardImage();
    if (!blob) return;
    // PATCH edita el mensaje existente — el marcador NUNCA se reenvía en el mismo partido
    const fd = new FormData();
    fd.append('file', blob, 'marcador.png');
    fd.append('payload_json', JSON.stringify({ content: '', attachments: [] }));
    const r = await fetch(
      `${webhookUrl}/messages/${state.liveMessageId}`,
      { method: 'PATCH', body: fd }
    );
    if (!r.ok) {
      // 404 = mensaje borrado externamente — crear uno nuevo
      if (r.status === 404) {
        console.warn('[DMark] Mensaje eliminado externamente — creando nuevo marcador');
        state.liveMessageId = null;
        localStorage.removeItem('haxref_live_message_id');
        await _sendScoreboardImage();
      } else {
        console.warn('[DMark] PATCH falló:', r.status);
      }
    }
  } catch (e) {
    console.warn('[DMark] error actualizando marcador:', e);
  }
}

function queueMatchStart(){
  if (discordConnected) _sendScoreboardImage();
}
// Guard para evitar múltiples reenvíos en cola por pulsaciones rápidas
let _resendStartInFlight = false;
let _resendEndInFlight   = false;

function resendStart(){
  if(!discordConnected){showAlert('Conecta el webhook primero.');return;}
  if(_resendStartInFlight){showAlert('Ya hay un reenvío de inicio en cola.');return;}
  _resendStartInFlight = true;
  // Spin visual en el botón ↺
  const btn=document.getElementById('btn-resend-start');
  if(btn){btn.classList.remove('fw-spinning');void btn.offsetWidth;btn.classList.add('fw-spinning');btn.addEventListener('animationend',()=>btn.classList.remove('fw-spinning'),{once:true});}
  const t=templates.start;
  const p={title:applyVars(t.title,{..._scoreVars(),hora:state.startTime||_nowHora()}),color:hexToDec(t.color)};
  enqueueCountdown('🟢 Reenvío inicio…',async()=>{
    try{ const id=await sendEmbed(p); _addMsgHistory(id,'🟢 Reenvío inicio',p); }
    finally{ _resendStartInFlight=false; }
  });
}
function resendEnd(){
  if(!discordConnected){showAlert('Conecta el webhook primero.');return;}
  if(!endSnapshot){showAlert('Finaliza el partido primero.');return;}
  if(_resendEndInFlight){showAlert('Ya hay un reenvío de final en cola.');return;}
  _resendEndInFlight = true;
  const btn=document.getElementById('btn-resend-end');
  if(btn){btn.classList.remove('fw-spinning');void btn.offsetWidth;btn.classList.add('fw-spinning');btn.addEventListener('animationend',()=>btn.classList.remove('fw-spinning'),{once:true});}
  const p=buildEndPayloadFromSnap(endSnapshot);
  enqueueCountdown('🏁 Reenvío final…',async()=>{
    try{ const id=await sendEmbed(p); _addMsgHistory(id,'🏁 Reenvío final',p); }
    finally{ _resendEndInFlight=false; }
  });
}

function triggerHalfTimeStart(){
  if(!state.inProgress){showAlert('Inicia el partido antes de marcar el medio tiempo.');return;}
  showConfirm(
    '⏸ ¿Iniciar medio tiempo?\nLos equipos se rotarán automáticamente.',
    ()=>{
      const htPayload=buildHtStartPayload();
      state.inProgress=false; // marcar medio tiempo
      state.period='HT'; // DMark: marcar como medio tiempo
      stopMatchTimer(); // DMark: pausar cronómetro
      swapTeams();
      updateTimeUI();updatePeriodUI();
      autoSave();
      _syncOverlayFull(); // mostrar HT en overlay
      // DMark: ACTUALIZAR MARCADOR INMEDIATAMENTE para mostrar HT
      if(discordConnected && _dmarkActive){
        updateLiveScoreboard();
      }
      // DMark: NO enviar mensaje individual si marcador visual está activo
      if(discordConnected && !_dmarkActive){
        enqueueCountdown('⏸️ Inicio ½T — enviando…',async()=>{const id=await sendEmbed(htPayload);_addMsgHistory(id,'⏸️ Inicio ½T',htPayload);});
      }
    },
    ()=>{},
    'CONFIRMAR','CANCELAR'
  );
}

function triggerHalfTimeEnd(){
  state.inProgress=true;
  state.period=2; // DMark: segundo tiempo
  state.matchTimer = 0; // DMark: RESETEAR cronómetro para segundo tiempo
  startMatchTimer(); // DMark: reanudar cronómetro
  updateTimeUI();updatePeriodUI();
  autoSave();
  updateLiveScoreboard(); // DMark: actualizar marcador visual
  _syncOverlayFull(); // mostrar 2T en overlay
  // DMark: NO enviar mensaje individual si marcador visual está activo
  if(discordConnected && !_dmarkActive){
    const htEndPayload=buildHtEndPayload();
    enqueueCountdown('▶️ Fin ½T — enviando…',async()=>{const id=await sendEmbed(htEndPayload);_addMsgHistory(id,'▶️ Fin ½T',htEndPayload);});
  }
}

function triggerMatchEnd(){
  if(!state.startTime){showAlert('El partido no ha iniciado todavía.');return;}
  if(state.endTime){showAlert('El partido ya está finalizado.');return;}
  showConfirm(
    `¿Finalizar el partido?\n${state.origRed} ${state.origScore.red} - ${state.origScore.blue} ${state.origBlue}\n\nEsta acción no se puede deshacer.`,
    ()=>{
      setMatchStatus('end');
      document.getElementById('btn-resend-end').style.display='';
      // DMark: NO enviar mensaje de final - solo actualiza Dynamic-Mark
    },
    ()=>{},
    'FINALIZAR','CANCELAR'
  );
}

// ══════════════════════════════════════════════════
//  TECLADO
// ══════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  // No activar shortcuts si hay un input o textarea enfocado
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA')return;
  if(document.getElementById('modal-overlay').classList.contains('modal-open'))return;
  if(document.getElementById('generic-modal').classList.contains('modal-open'))return;
  // Zoom con teclado (Ctrl + / Ctrl -)
  if(e.ctrlKey && (e.key==='=' || e.key==='+' || e.key==='NumpadAdd')){e.preventDefault();changeZoom(0.1);return;}
  if(e.ctrlKey && (e.key==='-' || e.key==='NumpadSubtract')){e.preventDefault();changeZoom(-0.1);return;}
  if(e.ctrlKey && e.key==='0'){e.preventDefault();zoomScale=1.0;_applyZoom(1.0);return;}
  if(!e.ctrlKey){
    if(e.key==='1')tab('sec-score',   document.getElementById('nav-1'));
    if(e.key==='2')tab('sec-discord', document.getElementById('nav-2'));
    if(e.key==='3')tab('sec-messages',document.getElementById('nav-3'));
    if(e.key==='4')tab('sec-export',  document.getElementById('nav-4'));
  }
});
let ctrlActive=false,ctrlTimeout=null;
const keysBlue=['1','Numpad1','.',','],keysRed=['2','Numpad2','-','0'];
window.addEventListener('keydown',e=>{
  // No activar si hay input enfocado
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA')return;
  if(e.key==='Control'){ctrlActive=true;clearTimeout(ctrlTimeout);ctrlTimeout=setTimeout(()=>ctrlActive=false,1000);return;}
  if(ctrlActive){
    let hit=false;
    if(keysBlue.includes(e.key)){modScore('blue',1);hit=true;}
    else if(keysRed.includes(e.key)){modScore('red',1);hit=true;}
    if(hit){ctrlActive=false;clearTimeout(ctrlTimeout);e.preventDefault();e.stopImmediatePropagation();}
  }
},true);

// ══════════════════════════════════════════════════
//  WEBHOOK PROFILES
// ══════════════════════════════════════════════════
function _getProfiles(){return JSON.parse(localStorage.getItem('haxref_wh_profiles')||'[]');}
function _saveProfiles(p){localStorage.setItem('haxref_wh_profiles',JSON.stringify(p));}
function _getActiveProfileId(){return localStorage.getItem('haxref_wh_active')||null;}
function _setActiveProfileId(id){if(id)localStorage.setItem('haxref_wh_active',id);else localStorage.removeItem('haxref_wh_active');}

// Migración: si existe el webhook legacy, convertirlo en perfil
function _migrateOldWebhook(){
  const old=localStorage.getItem('haxref_webhook');
  if(!old)return;
  const profiles=_getProfiles();
  if(!profiles.find(p=>p.url===old)){
    profiles.unshift({id:'p_'+Date.now(),name:'Canal principal',url:old});
    _saveProfiles(profiles);
    if(!_getActiveProfileId())_setActiveProfileId(profiles[0].id);
  }
  localStorage.removeItem('haxref_webhook');
}

// ── MODAL DE SELECCIÓN AL INICIO ──
let _whpOnSelect=null;

async function showProfileSelector(onSelect){
  _migrateOldWebhook();
  _whpOnSelect=onSelect;
  const profiles=_getProfiles();
  const list=document.getElementById('whp-list');
  const modal=document.getElementById('wh-profiles-modal');

  if(!profiles.length){
    // Sin perfiles guardados — ir directo sin webhook
    onSelect(null,false);
    return;
  }

  // Renderizar items con spinner
  list.innerHTML=profiles.map(p=>`
    <div class="whp-item" id="whp-item-${p.id}" role="button" tabindex="0" onclick="_whpClose('${p.id}',false)" onkeydown="if(event.key==='Enter'||event.key===' ')_whpClose('${p.id}',false)">
      <div class="whp-dot checking" id="whp-dot-${p.id}"></div>
      <div class="whp-info">
        <div class="whp-name">${p.name}</div>
        <div class="whp-url">${p.url.replace('https://discord.com/api/webhooks/','…/webhooks/')}</div>
      </div>
      <button type="button" class="whp-use-btn" onclick="event.stopPropagation();_whpClose('${p.id}',false)">USAR</button>
    </div>`).join('');

  _mOpen(modal);

  // Verificar todos en paralelo
  profiles.forEach(async p=>{
    const dot=document.getElementById(`whp-dot-${p.id}`);
    if(!dot)return;
    try{
      const r=await fetch(p.url,{method:'GET'});
      dot.className='whp-dot '+(r.ok?'ok':'err');
    }catch(e){
      dot.className='whp-dot err';
    }
  });
}

function _whpClose(profileId,noWebhook){
  _mClose('wh-profiles-modal', () => {
    const cb=_whpOnSelect;_whpOnSelect=null;
    if(cb)cb(profileId,noWebhook);
  });
}

// ── CRUD DE PERFILES ──
function addWebhookProfile(){
  showModal('Nombre del canal (ej: #resultados)',(name)=>{
    showModal('URL del webhook',(url)=>{
      if(!url.startsWith('https://discord.com/api/webhooks/')){
        showAlert('URL no válida. Debe ser un webhook de Discord.');return;
      }
      const profiles=_getProfiles();
      if(profiles.length>=8){showAlert('Máximo 8 canales guardados.');return;}
      const id='p_'+Date.now();
      profiles.push({id,name,url});
      _saveProfiles(profiles);
      renderProfilesList();
      showAlert(`✓ Canal "${name}" añadido.`);
    },false);
  },false);
}

function renameProfile(id){
  const profiles=_getProfiles();
  const p=profiles.find(x=>x.id===id);if(!p)return;
  showModal(`Nuevo nombre para "${p.name}"`,(name)=>{
    p.name=name||p.name;
    _saveProfiles(profiles);
    renderProfilesList();
  },false);
}

function deleteProfile(id){
  const profiles=_getProfiles();
  const p=profiles.find(x=>x.id===id);if(!p)return;
  showConfirm(
    `¿Eliminar el canal "${p.name}"?`,
    ()=>{
      _saveProfiles(profiles.filter(x=>x.id!==id));
      if(_getActiveProfileId()===id){
        _setActiveProfileId(null);
        webhookUrl='';discordConnected=false;updateDiscordUI();
        document.getElementById('dc-url-input').value='';
        document.getElementById('dc-webhook-info').classList.remove('visible');
      }
      renderProfilesList();
    },
    ()=>{}, 'ELIMINAR','CANCELAR'
  );
}

async function connectProfile(id){
  const profiles=_getProfiles();
  const p=profiles.find(x=>x.id===id);if(!p)return;
  document.getElementById('dc-url-input').value=p.url;
  const info=await fetchWebhookInfo(p.url);
  webhookUrl=p.url;discordConnected=true;
  _setActiveProfileId(id);
  if(info){
    document.getElementById('dc-wi-name').textContent    = info.name||'—';
    document.getElementById('dc-wi-guild').textContent   = info.guild_id?`ID ${info.guild_id}`:'—';
    document.getElementById('dc-wi-channel').textContent = info.channel_id||'—';
    document.getElementById('dc-webhook-info').classList.add('visible');
  }
  updateDiscordUI();
  renderProfilesList();
}

function renderProfilesList(){
  const list = document.getElementById('dc-profiles-list');
  if(!list) return;
  const profiles  = _getProfiles();
  const activeId  = _getActiveProfileId();
  if(!profiles.length){
    list.innerHTML = `<div style="font-size:11px;color:#252525;text-align:center;padding:14px 0;letter-spacing:.5px">Sin canales guardados</div>`;
    return;
  }
  list.innerHTML = profiles.map((p,i) => `
    <div class="whp-manage-item${p.id===activeId?' is-active':''}" draggable="true" data-id="${p.id}" data-idx="${i}">
      <div class="whp-drag-handle" title="Arrastrar">⠿</div>
      <div class="whp-info">
        <div class="whp-name">${p.name}${p.id===activeId?` <span style="font-size:9px;color:#5865f2;letter-spacing:1px">● ACTIVO</span>`:''}</div>
        <div class="whp-url">${p.url.replace('https://discord.com/api/webhooks/','…/webhooks/')}</div>
      </div>
      <div class="whp-manage-actions">
        <button class="whp-act-btn connect" onclick="connectProfile('${p.id}')">USAR</button>
        <button class="whp-act-btn" onclick="renameProfile('${p.id}')">✎</button>
        <button class="whp-act-btn del" onclick="deleteProfile('${p.id}')">✕</button>
      </div>
    </div>`).join('');

  // Drag & drop para reordenar
  let dragIdx = null;
  list.querySelectorAll('.whp-manage-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragIdx = parseInt(item.dataset.idx);
      item.style.opacity = '.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => { item.style.opacity = ''; });
    item.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      item.style.borderColor = '#333';
    });
    item.addEventListener('dragleave', () => { item.style.borderColor = ''; });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.style.borderColor = '';
      const dropIdx = parseInt(item.dataset.idx);
      if(dragIdx === null || dragIdx === dropIdx) return;
      const profiles = _getProfiles();
      const [moved] = profiles.splice(dragIdx, 1);
      profiles.splice(dropIdx, 0, moved);
      _saveProfiles(profiles);
      renderProfilesList();
    });
  });

  // Actualizar estado de conexión Discord
  updateDiscordUI();
}

// _updateConnectionCard eliminada — era subconjunto redundante de updateDiscordUI

// ══════════════════════════════════════════════════
//  INICIO / INTERFAZ
// ══════════════════════════════════════════════════
function startNewMatch(){
  _migrateOldWebhook();
  showProfileSelector(async(profileId, noWebhook)=>{
    if(noWebhook||!profileId){
      webhookUrl='';discordConnected=false;
      document.getElementById('dc-url-input').value='';
      document.getElementById('dc-webhook-info').classList.remove('visible');
      updateDiscordUI();
      _pickLigaOrAskNames();
      return;
    }
    const profiles=_getProfiles();
    const p=profiles.find(x=>x.id===profileId);
    if(!p){_pickLigaOrAskNames();return;}
    document.getElementById('dc-url-input').value=p.url;
    const info=await fetchWebhookInfo(p.url);
    webhookUrl=p.url;discordConnected=true;
    _setActiveProfileId(profileId);
    if(info){
      document.getElementById('dc-wi-name').textContent    = info.name||'—';
      document.getElementById('dc-wi-guild').textContent   = info.guild_id?`ID ${info.guild_id}`:'—';
      document.getElementById('dc-wi-channel').textContent = info.channel_id||'—';
      document.getElementById('dc-webhook-info').classList.add('visible');
    }
    updateDiscordUI();
    _pickLigaOrAskNames();
  });
}

// ── Selector rápido de liga antes de pedir nombres ─────────────
// Si no hay ligas, salta directo a askTeamNames.
// Si hay ligas, muestra el selector de liga → equipo rojo → equipo azul.
function _pickLigaOrAskNames(){
  let ligas = {};
  try { ligas = JSON.parse(localStorage.getItem('haxref_ligas') || '{}'); } catch{}
  const ligaList = Object.values(ligas).filter(l => l.teams?.length);

  if (!ligaList.length) { askTeamNames(); return; }

  // Mostrar modal de liga
  _showLigaPicker(ligaList, (redName, redLogo, blueName, blueLogo) => {
    // Aplicar nombres y logos directamente sin pedir al árbitro que escriba
    state.redName  = redName  || 'ROJO';
    state.blueName = blueName || 'AZUL';
    state.origRed  = state.redName;
    state.origBlue = state.blueName;

    if (redLogo) {
      state.shieldRed = redLogo;
      localStorage.setItem('haxref_shield_red', redLogo);
    }
    if (blueLogo) {
      state.shieldBlue = blueLogo;
      localStorage.setItem('haxref_shield_blue', blueLogo);
    }
    resetState();
    initInterface();
  }, () => {
    // Cancelar → pedir nombres manual
    askTeamNames();
  });
}

// ── Picker de liga/equipo ──────────────────────────────────────
// Inyecta un modal en el DOM, devuelve los datos vía callback.
function _showLigaPicker(ligaList, onConfirm, onCancel){
  let backdrop = document.getElementById('liga-picker-backdrop');
  if (backdrop) backdrop.remove();

  backdrop = document.createElement('div');
  backdrop.id = 'liga-picker-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);animation:backdropIn .18s ease forwards';

  let selectedLiga = ligaList[0];
  let redTeam  = null;
  let blueTeam = null;

  function close(){ backdrop.remove(); bgZoom(-1); _lpCleanup(); }

  function render(){
    backdrop.innerHTML = `
      <div style="background:#141414;border:1px solid #252525;border-radius:18px;width:340px;height:min(85vh,540px);display:flex;flex-direction:column;overflow:hidden;font-family:var(--font-display);animation:sheetSlideUp .22s cubic-bezier(.16,1,.3,1) both">
        <div style="padding:16px 20px 12px;border-bottom:1px solid #1e1e1e;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div style="font-size:10px;font-weight:600;letter-spacing:2px;color:#444">INICIO RÁPIDO</div>
          <button id="lp-close-btn" style="background:transparent;border:none;color:#444;font-size:16px;cursor:pointer;line-height:1;padding:2px 6px">✕</button>
        </div>
        <div style="padding:10px 20px 8px;border-bottom:1px solid #111;flex-shrink:0">
          <div style="font-size:8px;color:#333;letter-spacing:1.5px;margin-bottom:6px">LIGA</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${ligaList.map(l=>`
              <button data-liga-id="${l.id}" style="padding:5px 11px;border-radius:6px;font-size:10px;font-weight:600;letter-spacing:0.5px;cursor:pointer;border:1px solid ${l.id===selectedLiga.id?'#484848':'#1e1e1e'};background:${l.id===selectedLiga.id?'#222':'transparent'};color:${l.id===selectedLiga.id?'#d0d0d0':'#555'};transition:.12s">${l.name}</button>
            `).join('')}
          </div>
        </div>
        <div style="display:flex;flex:1;overflow:hidden;min-height:0">
          ${_lpRenderTeamCol('🔴 Rojo', selectedLiga.teams, redTeam,  'red')}
          ${_lpRenderTeamCol('🔵 Azul', selectedLiga.teams, blueTeam, 'blue')}
        </div>
        <div style="padding:10px 16px;border-top:1px solid #1e1e1e;display:flex;gap:8px;flex-shrink:0">
          <button id="lp-manual-btn" style="flex:1;padding:9px;background:transparent;border:1px solid #1e1e1e;color:#484848;border-radius:9px;font-size:10px;font-weight:500;letter-spacing:0.5px;cursor:pointer;font-family:var(--font-display)">Manual</button>
          <button id="lp-confirm-btn" style="flex:2;padding:9px;background:${!redTeam||!blueTeam?'#111':'#e0e0e0'};border:1px solid ${!redTeam||!blueTeam?'#1e1e1e':'#e0e0e0'};color:${!redTeam||!blueTeam?'#333':'#111'};border-radius:9px;font-size:10px;font-weight:600;letter-spacing:0.5px;cursor:${!redTeam||!blueTeam?'default':'pointer'};font-family:var(--font-display);transition:.15s;pointer-events:${!redTeam||!blueTeam?'none':'auto'}">Iniciar →</button>
        </div>
      </div>
    `;

    // Eventos via addEventListener — sin funciones serializadas en onclick
    backdrop.querySelector('#lp-close-btn').addEventListener('click', () => { close(); onCancel(); });
    backdrop.querySelector('#lp-manual-btn').addEventListener('click', () => { close(); onCancel(); });
    const confirmBtn = backdrop.querySelector('#lp-confirm-btn');
    if (redTeam && blueTeam) {
      confirmBtn.addEventListener('click', () => {
        close();
        onConfirm(redTeam.name, redTeam.logo||null, blueTeam.name, blueTeam.logo||null);
      });
    }
    // Liga buttons
    backdrop.querySelectorAll('[data-liga-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedLiga = ligaList.find(l=>l.id===btn.dataset.ligaId) || ligaList[0];
        redTeam = null; blueTeam = null;
        render();
      });
    });
    // Team buttons
    backdrop.querySelectorAll('[data-team-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const team = selectedLiga.teams.find(t=>t.id===btn.dataset.teamId);
        if (!team) return;
        if (btn.dataset.side === 'red') redTeam  = team;
        else                            blueTeam = team;
        render();
      });
    });
  }

  document.body.appendChild(backdrop);
  bgZoom(1);
  render();
}

function _lpRenderTeamCol(label, teams, selected, side){
  return `
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;border-right:${side==='red'?'1px solid #1a1a1a':'none'}">
      <div style="padding:8px 12px 4px;font-size:8px;color:#333;letter-spacing:1.5px;flex-shrink:0">${label}</div>
      <div style="overflow-y:auto;flex:1;min-height:0;padding:0 6px 8px;scrollbar-width:thin;scrollbar-color:#222 transparent">
        ${teams.map(t=>`
          <div data-team-id="${t.id}" data-side="${side}" style="display:flex;align-items:center;gap:7px;padding:6px 7px;border-radius:7px;cursor:pointer;border:1px solid ${selected?.id===t.id?'#383838':'transparent'};background:${selected?.id===t.id?'#1e1e1e':'transparent'};margin-bottom:2px;transition:.1s">
            <div style="width:26px;height:26px;border-radius:4px;overflow:hidden;background:#0a0a0a;flex-shrink:0;display:flex;align-items:center;justify-content:center">
              ${t.logo?`<img src="${t.logo}" style="width:100%;height:100%;object-fit:contain">`:'<span style="font-size:11px;opacity:.25">🛡</span>'}
            </div>
            <span style="font-size:10px;font-weight:500;color:${selected?.id===t.id?'#d0d0d0':'#666'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function _lpCleanup(){
  // Limpiar globals temporales (no quedan en window)
  delete window._lpSelectLiga;
  delete window._lpSelectTeam;
  delete window._lpConfirm;
}

function askTeamNames(){
  showModal("NOMBRE EQUIPO ROJO",val=>{
    state.redName=val||"ROJO";
    showModal("NOMBRE EQUIPO AZUL",val2=>{
      state.blueName=val2||"AZUL";
      state.origRed=state.redName;state.origBlue=state.blueName;
      resetState();initInterface();
    },false);
  },false);
}

// ── RENOMBRAR EQUIPOS (mid-match) ──────────────────────────────
// Cambia los nombres visibles y actualiza origRed/origBlue para
// que los eventos futuros usen el nombre correcto. No resetea
// marcador ni historial de eventos.
function renameTeams(){
  const redName  = state.redName  || 'ROJO';
  const blueName = state.blueName || 'AZUL';
  // Modal único con dos botones — elige qué equipo renombrar
  showConfirm(
    `✏️ ¿Qué equipo quieres renombrar?`,
    () => _renamePickTeam('red',  redName,  blueName),
    () => _renamePickTeam('blue', redName,  blueName),
    `🟥 ${redName}`,
    `🟦 ${blueName}`
  );
}
function _renamePickTeam(team, redName, blueName){
  const current = team === 'red' ? redName : blueName;
  const label   = team === 'red'
    ? `NUEVO NOMBRE — ${redName}`
    : `NUEVO NOMBRE — ${blueName}`;
  showModal(label, val => {
    if(val && val.trim()){
      const newName = val.trim();
      const oldName = team === 'red' ? state.redName : state.blueName;
      state.events.forEach(ev=>{ if(ev.teamName===oldName) ev.teamName=newName; });
      if(team==='red'){
        state.redName=newName; state.origRed=newName;
        document.getElementById('lbl-red').textContent=newName;
      } else {
        state.blueName=newName; state.origBlue=newName;
        document.getElementById('lbl-blue').textContent=newName;
      }
      renderEventList(); updateLiveScoreboard(); autoSave(); _syncOverlayFull();
    }
  }, false, false, current, true);
}


function resetState(){
  state.id=Date.now();
  state.score={red:0,blue:0};state.origScore={red:0,blue:0};
  state.events=[];state.period=1;
  state.startTime=null;state.endTime=null;state.inProgress=false;
  state.players={red:[],blue:[]};
  state.liveMessageId=null;
  _dmarkActive=false;
  state.paused=false;
  endSnapshot=null;
}

function initInterface(){
  document.getElementById('launcher').style.display='none';
  document.getElementById('history-panel').style.display='none';
  const mainApp=document.getElementById('main-app');
  mainApp.style.display='flex';
  mainApp.classList.remove('visible');
  void mainApp.offsetWidth;
  mainApp.classList.add('visible');
  document.getElementById('lbl-red').textContent=state.redName;
  document.getElementById('lbl-blue').textContent=state.blueName;
  document.getElementById('btn-resend-start').style.display=state.startTime?'':'none';
  document.getElementById('btn-resend-end').style.display=state.endTime?'':'none';
  updateScoreUI();updateTimeUI();updatePeriodUI();
  renderEventList();updateDiscordUI();_updateMsgsBtn();
  renderProfilesList();
  // Sincronizar overlay con los datos actuales del partido
  setTimeout(_syncOverlayFull, 300); // timeout para dar tiempo al frame de HaxBall
  // Sincronizar ajustes con localStorage
  const pv=document.getElementById('ping-interval-val');if(pv)pv.textContent=pingIntervalSecs+'s';
  // Mini mode
  const mc=document.getElementById('mini-mode-chk');if(mc){mc.checked=miniModeEnabled;toggleMiniMode(miniModeEnabled);}
  // Zoom
  _applyZoom(zoomScale);
  // Tema
  _applyTheme(lightMode);
  // Idioma
  _applyLang(currentLang);
}

function tab(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if(el){
    el.classList.add('active');
  }
  if(id==='sec-export')loadExportUI();
  // Ping 2s en pestaña Discord, restaurar al salir
  if(id==='sec-discord'){
    _activeFastPing=true;
    if(discordConnected)_startPing();
    // Deshabilitar controles de ping interval
    const pMinus=document.querySelector('[onclick="changePingInterval(-10)"]');
    const pPlus=document.querySelector('[onclick="changePingInterval(10)"]');
    const pVal=document.getElementById('ping-interval-val');
    if(pMinus)pMinus.disabled=true;if(pPlus)pPlus.disabled=true;
    if(pVal){pVal.textContent='2s (Discord activo)';pVal.style.color='#5865f2';}
  }else if(_activeFastPing){
    _activeFastPing=false;
    if(discordConnected)_startPing();
    const pMinus=document.querySelector('[onclick="changePingInterval(-10)"]');
    const pPlus=document.querySelector('[onclick="changePingInterval(10)"]');
    const pVal=document.getElementById('ping-interval-val');
    if(pMinus)pMinus.disabled=false;if(pPlus)pPlus.disabled=false;
    if(pVal){pVal.textContent=pingIntervalSecs+'s';pVal.style.color='';}
  }
}

// ══════════════════════════════════════════════════
//  PERÍODO / TIEMPO / SCORE
// ══════════════════════════════════════════════════
function updatePeriodUI(){
  const btn = document.getElementById('period-btn');
  const nav = document.querySelector('nav');
  const prevClass = btn.className; // track for state change detection
  if(!state.startTime){
    btn.textContent='1T'; btn.classList.remove('second','running','overtime','paused-state');
    btn.style.color=''; btn.onclick=null; btn.title='';
    if(nav){nav.style.opacity='';nav.style.pointerEvents='';nav.style.transform='';}
  } else if(state.endTime){
    btn.textContent='FIN'; btn.classList.add('second'); btn.classList.remove('running','overtime','paused-state');
    btn.style.color=''; btn.onclick=null; btn.title='';
    // Nav siempre visible — el árbitro necesita acceso a todas las pestañas al finalizar
    if(nav){nav.style.opacity='';nav.style.pointerEvents='';nav.style.transform='';}
    // FINALIZADO en rojo en btn-start
    const bs=document.getElementById('btn-start');
    if(bs){bs.textContent='FINALIZADO';bs.style.color='#ff4040';bs.style.borderColor='rgba(255,64,64,.35)';}
  } else if(!state.inProgress && state.startTime){
    btn.textContent='½T'; btn.classList.add('second'); btn.classList.remove('running','overtime','paused-state');
    btn.style.color=''; btn.onclick=null; btn.title='';
    if(nav){nav.style.opacity='';nav.style.pointerEvents='';nav.style.transform='';}
  } else {
    const halfDuration = parseInt(localStorage.getItem('half_duration')||'8')*60;
    const halfMins = Math.floor(halfDuration/60);
    const mins = Math.floor(state.matchTimer/60);
    const secs = state.matchTimer%60;
    const period = state.period===1?'1T':'2T';
    const isOvertime = state.matchTimer > halfDuration;
    let timeLabel;
    if(isOvertime){
      const extra = Math.ceil((state.matchTimer-halfDuration)/60);
      timeLabel = `${halfMins}+${extra}'`;
    } else {
      timeLabel = `${mins}:${secs.toString().padStart(2,'0')}`;
    }
    btn.textContent= `${timeLabel} ${period}`;
    btn.classList.toggle('second', state.period!==1);
    // ── Estados de color del botón ──────────────────────────
    btn.classList.remove('running','overtime','paused-state');
    if(state.paused){
      btn.classList.add('paused-state');
      btn.style.color  = ''; // lo maneja CSS
      btn.title        = 'Pausado — toca para reanudar';
    } else if(isOvertime){
      btn.classList.add('overtime');
      btn.style.color  = '';
      btn.title        = 'Tiempo extra — toca para pausar';
    } else {
      btn.classList.add('running');
      btn.style.color  = '';
      btn.title        = 'Toca para pausar';
    }
    btn.onclick      = toggleQuickPause;
    if(nav){nav.style.opacity='';nav.style.pointerEvents='';nav.style.transform='';}
  }
  // fw-state-change si cambió el estado del botón
  if(btn.className !== prevClass){
    btn.classList.remove('fw-state-change');
    void btn.offsetWidth;
    btn.classList.add('fw-state-change');
    btn.addEventListener('animationend',()=>btn.classList.remove('fw-state-change'),{once:true});
  }
  // Sincronizar dynamic pill
  dpUpdateUI();
}

// ── Dynamic Pill — Control de tiempo ─────────────────────────────
(function(){
  const pill  = document.getElementById('dyn-pill');
  const xBtn  = document.getElementById('dyn-pill-x');
  const dot   = document.getElementById('dyn-dot');
  const txt   = document.getElementById('dyn-pill-txt');
  const wrap  = document.getElementById('dyn-pill-wrap');
  const dBtns = {
    start: document.getElementById('dp-start'),
    ht:    document.getElementById('dp-ht'),
    end:   document.getElementById('dp-end'),
  };

  if(!pill) return;

  let isOpen = false;

  // Abrir al hover
  pill.addEventListener('mouseenter', () => { if(!isOpen) dpExpand(); });

  // También abrir al click (mobile)
  pill.addEventListener('click', () => { if(!isOpen) dpExpand(); });

  xBtn.addEventListener('click', e => { e.stopPropagation(); dpClose(e); });

  // Cerrar al salir del wrap completo (pill + X)
  wrap.addEventListener('mouseleave', () => {
    if(isOpen) dpClose();
  });

  function dpExpand() {
    isOpen = true;
    pill.classList.add('dp-open');
    xBtn.classList.add('show');
  }

  window.dpClose = function(e) {
    if(e) e.stopPropagation();
    isOpen = false;
    pill.classList.remove('dp-open');
    xBtn.classList.remove('show');
  };

  window.dpAct = function(action) {
    dpClose();
    // Mapear a las funciones reales de HaxRef Pro
    if(action === 'start'){
      if(!state.startTime || state.endTime) setMatchStatus('start');
      else if(state.period === 'HT') triggerHalfTimeEnd();
    } else if(action === 'ht'){
      triggerHalfTimeStart();
    } else if(action === 'end'){
      triggerMatchEnd();
    }
  };

  window.dpUpdateUI = function() {
    if(!pill) return;
    // Limpiar
    dot.className = 'dyn-dot';
    pill.classList.remove('dp-green','dp-yellow','dp-red');
    Object.values(dBtns).forEach(b => { if(b) b.classList.remove('off'); });
    document.getElementById('dp-ico-start').textContent = '🟢';
    document.getElementById('dp-lbl-start').textContent = 'INICIAR';

    if(!state.startTime){
      txt.textContent = 'CONTROL DE TIEMPO';
      dBtns.ht.classList.add('off');
      dBtns.end.classList.add('off');

    } else if(state.endTime){
      txt.textContent = 'FINALIZADO';
      dot.classList.add('fin');
      pill.classList.add('dp-red');
      Object.values(dBtns).forEach(b => { if(b) b.classList.add('off'); });

    } else if(!state.inProgress && state.period === 'HT'){
      txt.textContent = '½ TIEMPO';
      dot.classList.add('paused');
      pill.classList.add('dp-yellow');
      dBtns.start.classList.remove('off');
      document.getElementById('dp-ico-start').textContent = '▶️';
      document.getElementById('dp-lbl-start').textContent = 'REANUDAR';
      dBtns.ht.classList.add('off');

    } else if(state.inProgress && state.period === 1){
      if(state.paused){
        txt.textContent = '1T · PAUSADO';
        dot.classList.add('paused');
        pill.classList.add('dp-yellow');
      } else {
        txt.textContent = '1T · EN CURSO';
        dot.classList.add('active');
        pill.classList.add('dp-green');
      }
      dBtns.start.classList.add('off');

    } else if(state.inProgress && state.period === 2){
      if(state.paused){
        txt.textContent = '2T · PAUSADO';
        dot.classList.add('paused');
        pill.classList.add('dp-yellow');
      } else {
        txt.textContent = '2T · EN CURSO';
        dot.classList.add('active');
        pill.classList.add('dp-green');
      }
      dBtns.start.classList.add('off');
      dBtns.ht.classList.add('off');
    }
  };

  // Init
  window.dpUpdateUI();
})();

function setMatchStatus(action){
  const ts=_nowHora();
  if(action==='start'){
    if(!state.inProgress){
      if(!state.startTime){
        // Partido NUEVO - limpiar liveMessageId para crear mensaje nuevo
        state.startTime=ts;
        state.liveMessageId=null;
        localStorage.removeItem('haxref_live_message_id');
        resetMatchTimer(); // DMark: resetear cronómetro
        // HaxRef Live: aplicar buffer (timer + roster) si hay partido activo en la extensión
        if (typeof window.__haxlive_applyBuffer === 'function') {
          window.__haxlive_applyBuffer();
        }
      }
      // Si startTime ya existe, es REANUDACIÓN - mantener liveMessageId
      state.endTime=null;state.inProgress=true;
      startMatchTimer(); // DMark: iniciar cronómetro
      // Shimmer único en btn-start al activar
      const bs=document.getElementById('btn-start');
      if(bs){bs.classList.remove('fw-activated');void bs.offsetWidth;bs.classList.add('fw-activated');bs.addEventListener('animationend',()=>bs.classList.remove('fw-activated'),{once:true});}
      queueMatchStart();
      autoSave();
      updateLiveScoreboard(); // DMark: crear/actualizar marcador visual
      _syncOverlayFull();
      if(window.HaxLiveOverlay?.resetCards) window.HaxLiveOverlay.resetCards();
      // También enviar por bridge por si el overlay está en HaxBall
      if(typeof window._bridgeSend==='function') window._bridgeSend('overlay_cmd',{cmd:'resetCards'});
    }
  }else if(action==='end'){
    state.endTime=ts;state.inProgress=false;
    stopMatchTimer(); // DMark: detener cronómetro
    endSnapshot=JSON.parse(JSON.stringify(state));
    saveMatchToHistory();
    _syncOverlayFull(); // marcar FIN en overlay
    // DMark: actualizar marcador final — siempre, no solo si hay mensaje live
    updateLiveScoreboard();
    // DMark: Limpiar liveMessageId DESPUÉS para próximo partido (con timeout para que se envíe la actualización)
    setTimeout(() => {
      state.liveMessageId=null;
      _dmarkActive=false;
      localStorage.removeItem('haxref_live_message_id');
    }, 2000);
  }
  updateTimeUI();updatePeriodUI();
}

function updateTimeUI(){
  const btn=document.getElementById('btn-start'),log=document.getElementById('time-log-display');
  if(state.inProgress){
    btn.textContent='EN JUEGO';btn.classList.add('playing');
    log.textContent=`INICIO: ${state.startTime} (Jugando…)`;
  }else if(state.endTime){
    btn.textContent='REANUDAR';btn.classList.remove('playing');
    log.textContent=`INICIO: ${state.startTime} — FIN: ${state.endTime}`;
  }else if(state.startTime){
    btn.textContent='REANUDAR';btn.classList.remove('playing');
    log.textContent=`INICIO: ${state.startTime} (½T)`;
  }else{
    btn.textContent='INICIAR';btn.classList.remove('playing');
    log.textContent='ESPERANDO INICIO…';
  }
  document.getElementById('btn-resend-start').style.display=state.startTime?'':'none';
}

function modScore(team,delta){
  // Anti-error: no se puede anotar si el partido no está activo
  if(delta>0){
    if(!state.inProgress || state.endTime){showAlert('⚠️ No puedes anotar: el partido no está en curso.');return;}
    if(state.period==='HT'){showAlert('⚠️ No puedes anotar durante el medio tiempo.');return;}
  }
  // Al restar gol: cancelar countdown activo de gol si está en cola, o borrar de DC si ya se envió
  if(delta<0&&state.score[team]>0){
    const goalInQueue=cdQueue.findIndex(q=>q.label.startsWith('⚽'));
    if(goalInQueue>=0){
      // Está en delay — cancelar directamente sin preguntar
      if(goalInQueue===0&&cdInterval){clearInterval(cdInterval);cdInterval=null;cdCurrentCb=null;}
      cdQueue.splice(goalInQueue,1);
      if(goalInQueue===0&&cdQueue.length)_processQueue();
      else _renderStack();
      _applyScoreChange(team,delta);
      return;
    }
    if(discordConnected){
      const goalMsgs=msgHistory.filter(m=>m.label.startsWith('⚽'));
      if(goalMsgs.length){
        const last=goalMsgs[goalMsgs.length-1];
        showConfirm(
          `⚽ Se restará un gol.\n¿Eliminar el último mensaje de gol de Discord?\n\n(ya se había enviado)`,
          ()=>{deleteMsg(last.dcId);_removeMsgByUid(last.uid);_applyScoreChange(team,delta);},
          ()=>{_applyScoreChange(team,delta);},
          'BORRAR MENSAJE','SOLO RESTAR'
        );
        return;
      }
    }
  }
  _applyScoreChange(team,delta);
}

function _applyScoreChange(team,delta){
  state.score[team]+=delta;
  if(state.score[team]<0)state.score[team]=0;
  // Si se resta un gol, eliminar el último GOL registrado de ese equipo
  if(delta<0){
    const idx = [...state.events].map((e,i)=>({e,i})).reverse().find(({e})=>e.team===getOrigTeam(team)&&e.type==='GOL');
    if(idx) state.events.splice(idx.i, 1);
  }
  if(!isSwapped()){state.origScore.red=state.score.red;state.origScore.blue=state.score.blue;}
  else            {state.origScore.red=state.score.blue;state.origScore.blue=state.score.red;}

  if(delta>0&&state.inProgress){
    const minute   = getMatchMinuteRounded();
    const origTeam = getOrigTeam(team);
    state.events.push({
      id: Date.now(),
      team:     origTeam,
      teamName: getOrigName(origTeam),
      type:     'GOL',
      player:   '',
      minute,
      period:   state.period
    });
  }
  
  autoSave();
  updateLiveScoreboard(); // DMark: actualizar marcador visual
  if(delta>0&&state.inProgress){
    triggerGoalBall(team);
    // DMark: Si marcador visual está activo, NO enviar mensajes individuales de gol
    if(discordConnected && !_dmarkActive){
      const t=templates.goal;
      const hora=_nowHora();
      const origTeam=getOrigTeam(team);
      const goalPayload={title:applyVars(t.title,{team:getOrigName(origTeam),teamred:state.origRed,teamblue:state.origBlue,scorered:state.origScore.red,scoreblue:state.origScore.blue,hora}),color:hexToDec(t.color)};
      enqueueCountdown('⚽ Gol — enviando…',async()=>{
        const initTitle=_buildGoalInitFrame();
        const r=await fetch(webhookUrl+'?wait=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({embeds:[{title:initTitle,color:hexToDec(t.color)}]})});
        if(r.ok){
          const d=await r.json().catch(()=>null);
          if(d?.id){
            _addMsgHistory(d.id,'⚽ Gol',goalPayload);
            _animateGoalEmbed(d.id,goalPayload);
          }
        }
      });
    }
  }
  updateScoreUI();
}

function _buildGoalInitFrame(){
  switch(goalAnimType){
    case 'reveal': return 'G';
    case 'bar':    return '▱▱▱▱▱▱▱▱▱▱';
    case 'flash':  return '💥';
    default:       return goalInitMsg||'⚽';
  }
}

async function _animateGoalEmbed(msgId,finalPayload){
  const color=finalPayload.color;
  const delay=ms=>new Promise(r=>setTimeout(r,ms));

  if(goalAnimType==='reveal'){
    const frames=['GO','GOO','GOOO','GOOO⚽','GOOO⚽⚽','GOOO⚽⚽⚽ GOL'];
    for(const f of frames){
      await delay(350);
      await patchEmbed(msgId,{title:f,color});
    }
    await delay(600);
  }else if(goalAnimType==='bar'){
    const filled='▰',empty='▱',total=10;
    for(let i=1;i<=total;i++){
      await delay(200);
      const bar=filled.repeat(i)+empty.repeat(total-i);
      await patchEmbed(msgId,{title:bar,color});
    }
    await delay(400);
  }else if(goalAnimType==='flash'){
    await delay(500);
    await patchEmbed(msgId,{title:'🔥 GOL 🔥',color});
    await delay(600);
  }else{
    await delay(1200);
  }
  await patchEmbed(msgId,finalPayload);
}
function triggerGoalBall(team){
  if(!goalAnimEnabled)return;
  const el=document.getElementById(team==='red'?'score-red':'score-blue');
  const rect=el.getBoundingClientRect();
  const ball=document.getElementById('goal-ball');
  ball.style.left=(rect.left+rect.width/2)+'px';ball.style.top=(rect.top+rect.height/2)+'px';
  ball.classList.remove('animate');void ball.offsetWidth;ball.classList.add('animate');
}
function updateScoreUI(){
  const prevR = document.getElementById('score-red').textContent;
  const prevB = document.getElementById('score-blue').textContent;
  document.getElementById('score-red').textContent=state.score.red;
  document.getElementById('score-blue').textContent=state.score.blue;
  // fw-bump solo si el valor cambió
  if(String(state.score.red)!==prevR) _fwBumpScore('score-red');
  if(String(state.score.blue)!==prevB) _fwBumpScore('score-blue');
  _updateScoreLogos();
}
function _fwBumpScore(id){
  const el=document.getElementById(id);
  if(!el) return;
  el.classList.remove('fw-bump');
  void el.offsetWidth;
  el.classList.add('fw-bump');
  // Ripple
  const rip=document.createElement('div');
  rip.className='score-ripple';
  el.style.position='relative';
  el.appendChild(rip);
  setTimeout(()=>rip.remove(), 550);
  el.addEventListener('animationend',()=>el.classList.remove('fw-bump'),{once:true});
}

// Sincroniza los logos encima de los scores con el equipo visual actual
function _updateScoreLogos(){
  const imgR = document.getElementById('score-logo-red');
  const phR  = document.getElementById('score-logo-red-ph');
  const imgB = document.getElementById('score-logo-blue');
  const phB  = document.getElementById('score-logo-blue-ph');
  const logoL = getVisualShield('red');
  const logoR = getVisualShield('blue');
  if(imgR && phR){
    if(logoL){ imgR.src=logoL; imgR.style.display=''; phR.style.display='none'; imgR.classList.remove('fw-logo-in');void imgR.offsetWidth;imgR.classList.add('fw-logo-in');imgR.addEventListener('animationend',()=>imgR.classList.remove('fw-logo-in'),{once:true}); }
    else     { imgR.style.display='none'; phR.style.display=''; }
  }
  if(imgB && phB){
    if(logoR){ imgB.src=logoR; imgB.style.display=''; phB.style.display='none'; imgB.classList.remove('fw-logo-in');void imgB.offsetWidth;imgB.classList.add('fw-logo-in');imgB.addEventListener('animationend',()=>imgB.classList.remove('fw-logo-in'),{once:true}); }
    else     { imgB.style.display='none'; phB.style.display=''; }
  }
}

// ── Utilidades de swap ────────────────────────────────────────────
// Devuelve true si los equipos están intercambiados respecto al inicio
function isSwapped(){ return state.redName !== state.origRed; }

// Convierte un lado visual ('red'/'blue') al lado ORIGINAL que usa el canvas
function getOrigTeam(visualTeam){
  return (!isSwapped()) ? visualTeam : (visualTeam === 'red' ? 'blue' : 'red');
}

// Devuelve el nombre real del equipo a partir del lado ORIGINAL
function getOrigName(origTeam){
  return origTeam === 'red' ? state.origRed : state.origBlue;
}

// Devuelve el escudo a mostrar en la UI para un lado visual dado
function getVisualShield(visualTeam){
  return isSwapped()
    ? (visualTeam === 'red' ? state.shieldBlue : state.shieldRed)
    : (visualTeam === 'red' ? state.shieldRed  : state.shieldBlue);
}
// ─────────────────────────────────────────────────────────────────
// ── SWAP INTERNO (solo medio tiempo) ──────────────────────────
// Llamado únicamente por triggerHalfTimeStart.
// Solo swapea los datos de juego (nombres, marcador, jugadores).
// NO toca orig* ni shields — esos son coordenadas físicas que
// getVisualShield/isSwapped manejan automáticamente.
function swapTeams(){
  const swapBtn = document.querySelector('.swap-btn');
  if(swapBtn){
    swapBtn.classList.remove('fw-swapping');
    void swapBtn.offsetWidth;
    swapBtn.classList.add('fw-swapping');
    swapBtn.addEventListener('animationend',()=>swapBtn.classList.remove('fw-swapping'),{once:true});
  }
  [state.redName,state.blueName]=[state.blueName,state.redName];
  [state.score.red,state.score.blue]=[state.score.blue,state.score.red];
  [state.players.red,state.players.blue]=[state.players.blue,state.players.red];
  document.getElementById('lbl-red').textContent=state.redName;
  document.getElementById('lbl-blue').textContent=state.blueName;
  _updateScoreLogos();
  updateScoreUI();updatePeriodUI();renderEventList();
  _syncOverlayFull();
}
// Radial hover en status-btns — actualiza --rx/--ry según posición del cursor
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.status-btn').forEach(btn=>{
    btn.addEventListener('mousemove',e=>{
      const r=btn.getBoundingClientRect();
      btn.style.setProperty('--rx',((e.clientX-r.left)/r.width*100)+'%');
      btn.style.setProperty('--ry',((e.clientY-r.top)/r.height*100)+'%');
    });
  });
  // time-log: micro-tick visual cada minuto
  setInterval(()=>{
    const tl=document.querySelector('.time-log');
    if(!tl||!state.inProgress||state.endTime)return;
    tl.classList.remove('fw-tick');void tl.offsetWidth;tl.classList.add('fw-tick');
    tl.addEventListener('animationend',()=>tl.classList.remove('fw-tick'),{once:true});
  }, 60000);
});

// ── ROTAR DISPLAY (botón manual del árbitro) ───────────────────
// Rota absolutamente todo — nombres, logos, marcador, jugadores, orig* —
// para que DMark, overlay, swap de HT y detección de equipo sean consistentes.
// NO toca period, startTime, eventos ya registrados ni lógica de tiempo.
function rotateDisplay(){
  // Todo lo que define "qué equipo es qué lado"
  [state.redName,  state.blueName ]=[state.blueName,  state.redName  ];
  [state.origRed,  state.origBlue ]=[state.origBlue,  state.origRed  ];
  [state.score.red,state.score.blue]=[state.score.blue,state.score.red];
  [state.players.red,state.players.blue]=[state.players.blue,state.players.red];
  [state.shieldRed,state.shieldBlue]=[state.shieldBlue,state.shieldRed];
  // origScore también para que el canvas DMark arranque desde el valor correcto
  if(state.origScore){
    [state.origScore.red,state.origScore.blue]=[state.origScore.blue,state.origScore.red];
  }
  document.getElementById('lbl-red').textContent=state.redName;
  document.getElementById('lbl-blue').textContent=state.blueName;
  _updateScoreLogos();
  updateScoreUI();renderEventList();
  updateLiveScoreboard();
  autoSave();
  _syncOverlayFull();
}

// ══════════════════════════════════════════════════
//  OVERLAY SYNC — empuja nombres, logos y período
//  al overlay de HaxRef Live en el frame de HaxBall.
//
//  ARQUITECTURA:
//  haxref.js (pestaña HaxRef Pro)
//    → bridge WS (type: 'overlay_cmd', data: {cmd, ...args})
//    → content.js en HaxBall (ISOLATED world) lo recibe
//    → content.js llama window.HaxLiveOverlay[cmd](args)
//    → overlay.js (mismo ISOLATED world) actualiza la UI
// ══════════════════════════════════════════════════
function _syncOverlayFull(){
  // Enviar por el bridge WS — el overlay no está en esta pestaña
  function overlayCmd(cmd, args){
    // _bridgeSend vive en window — lo asigna initHaxRefLive al conectar
    if(typeof window._bridgeSend === 'function'){
      window._bridgeSend('overlay_cmd', { cmd, ...args });
    }
  }

  // Nombres (respeta swap visual)
  overlayCmd('setTeamName', { team:'red',  name: state.redName  || 'ROJO' });
  overlayCmd('setTeamName', { team:'blue', name: state.blueName || 'AZUL' });

  // Logos
  const shieldRed  = getVisualShield('red')  || '';
  const shieldBlue = getVisualShield('blue') || '';
  overlayCmd('setShieldUrl', { team:'red',  url: shieldRed  });
  overlayCmd('setShieldUrl', { team:'blue', url: shieldBlue });

  // Período
  const periodLabel =
    state.endTime       ? 'FIN' :
    state.period==='HT' ? 'HT'  :
    state.period===2    ? '2T'  : '1T';
  overlayCmd('setPeriod', { text: periodLabel });

  // Jugadores (coordenadas visuales)
  const swapped    = isSwapped();
  const visualRed  = swapped ? state.players.blue : state.players.red;
  const visualBlue = swapped ? state.players.red  : state.players.blue;
  overlayCmd('setPlayers', { red: [...visualRed], blue: [...visualBlue] });
}
function showModal(placeholder,cb,showSugg=true,needsReason=false,teamFilter=null,allowEmpty=false){
  modal.input.placeholder=placeholder;modal.input.value='';modal.reason.value='';
  modal.callback=cb;modal.needsReason=needsReason;modal._allowEmpty=allowEmpty;
  _mOpen(modal.el);
  modal.reason.style.display=needsReason?'block':'none';
  modal.suggestions.innerHTML='';
  if(showSugg){
    let players=[];
    if(teamFilter&&state.players[teamFilter]?.length)players=[...new Set(state.players[teamFilter])];
    else if(!teamFilter)players=[...new Set(state.events.map(e=>e.player).filter(p=>p!=="Desconocido"))];
    players.forEach(p=>{
      const hasY=state.events.some(e=>e.player===p&&e.team===(teamFilter||e.team)&&e.type==='TA');
      const chip=document.createElement('div');
      chip.className=`chip ${hasY?'has-card':''}`;chip.innerHTML=hasY?`🟨 ${p}`:p;
      chip.onclick=()=>{
        modal.input.value=p;
        if(hasY&&pendingContext?.type==='TA'){pendingContext.type='TR';modal.input.style.color='var(--red)';setTimeout(()=>modal.input.style.color='#fff',500);}
        modal.input.focus();
      };
      modal.suggestions.appendChild(chip);
    });
  }
  modal.input.focus();
}

function confirmModal(){
  const player=modal.input.value.trim(),reason=modal.reason.value.trim();
  if(!player&&!modal._allowEmpty){modal.input.style.borderColor='var(--red)';setTimeout(()=>modal.input.style.borderColor='#2a1a40',700);return;}
  // La razón es siempre opcional — si needsReason solo muestra el campo pero no obliga
  const cb=modal.callback; modal.callback=null;
  _mClose(modal.el,()=>{if(cb)cb(player,reason);});
}
function cancelModal(){modal.callback=null;_mClose(modal.el);}
modal.input.addEventListener('keypress',e=>{if(e.key==='Enter'){if(modal.needsReason)modal.reason.focus();else confirmModal();}});
modal.reason.addEventListener('keypress',e=>{if(e.key==='Enter')confirmModal();});

// Filtrar chips mientras se escribe
modal.input.addEventListener('input', () => {
  const q = modal.input.value.trim().toLowerCase();
  modal.suggestions.querySelectorAll('.chip').forEach(chip => {
    const name = chip.textContent.replace('🟨 ','').toLowerCase();
    chip.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
  // Autoselect si solo queda un chip visible
  const visible = [...modal.suggestions.querySelectorAll('.chip')]
    .filter(c => c.style.display !== 'none');
  if (visible.length === 1 && q.length >= 2) {
    visible[0].style.outline = '1px solid var(--purple)';
  } else {
    modal.suggestions.querySelectorAll('.chip')
      .forEach(c => c.style.outline = '');
  }
});

// B3: detecta doble amarilla por nombre de jugador, ignorando lado visual (cross-swap)
function hasYellowCard(player){
  return state.events.some(e=>e.player===player&&e.type==='TA');
}
// ── Modal rápido de tarjetas ──────────────────────────────────────
let _cardDirectRed = false; // toggle de roja directa

function openCardModal(){
  // Wobble en el botón de tarjetas
  const qb=document.querySelector('.card-quick-btn');
  if(qb){qb.classList.remove('fw-wobble');void qb.offsetWidth;qb.classList.add('fw-wobble');qb.addEventListener('animationend',()=>qb.classList.remove('fw-wobble'),{once:true});}
  // Guard: no se pueden registrar tarjetas si el partido no está activo
  if(!state.inProgress || state.endTime){
    showAlert('⚠️ No puedes registrar tarjetas: el partido no está en curso.');
    return;
  }
  if(state.period==='HT'){
    showAlert('⚠️ No puedes registrar tarjetas durante el medio tiempo.');
    return;
  }
  const rName = state.redName  || 'ROJO';
  const bName = state.blueName || 'AZUL';
  document.getElementById('card-team-name-red').textContent  = rName;
  document.getElementById('card-team-name-blue').textContent = bName;

  // Logos
  const shieldL = getVisualShield('red');
  const shieldR = getVisualShield('blue');
  const rShield = document.getElementById('card-team-shield-red');
  const bShield = document.getElementById('card-team-shield-blue');
  rShield.innerHTML = shieldL ? `<img src="${shieldL}" alt="${rName}">` : '🔴';
  bShield.innerHTML = shieldR ? `<img src="${shieldR}" alt="${bName}">` : '🔵';

  // Resetear siempre a amarilla al abrir
  _cardDirectRed = false;
  _applyCardTypeToggleUI();
  document.getElementById('card-team-modal').classList.contains('modal-open') || _mOpen('card-team-modal');
}

// Alterna entre tarjeta amarilla y roja directa en el modal rápido
function toggleCardDirectRed(){
  _cardDirectRed = !_cardDirectRed;
  _applyCardTypeToggleUI();
}

// Sincroniza el botón de tipo con el estado actual de _cardDirectRed
function _applyCardTypeToggleUI(){
  const btn   = document.getElementById('card-type-toggle');
  const title = document.getElementById('card-team-modal-title');
  if(!btn) return;
  if(_cardDirectRed){
    btn.textContent  = '🟥 ROJA DIRECTA';
    btn.style.color  = '#ff6b6b';
    btn.style.borderColor = 'rgba(255,42,42,.4)';
    if(title) title.textContent = 'TARJETA ROJA';
  } else {
    btn.textContent  = '🟨 AMARILLA';
    btn.style.color  = '#aaa';
    btn.style.borderColor = '#2a1a40';
    if(title) title.textContent = 'AMONESTACIÓN';
  }
}

function closeCardModal(){ _setModalVisible('card-team-modal', false); }

function selectCardTeam(side){
  closeCardModal();
  // Abrir modal de jugador — si hay toggle de roja activo se pasa TR, si no TA
  promptEvent(side, _cardDirectRed ? 'TR' : 'TA');
}

function openCardList(){
  closeCardModal();
  // Sincronizar headers con nombres actuales
  document.getElementById('card-list-lbl-red').textContent  = state.redName  || 'ROJO';
  document.getElementById('card-list-lbl-blue').textContent = state.blueName || 'AZUL';
  renderEventList();
  _mOpen('card-list-modal');
}

function closeCardList(){ _setModalVisible('card-list-modal', false); }
// ─────────────────────────────────────────────────────────────────

// toggleModalRedCard eliminada — modal-red-toggle siempre display:none
// El tipo de tarjeta se elige en el primer modal (card-type-toggle)

function promptEvent(team,type){
  // Guard: no abrir si el modal ya está visible (doble tap)
  const modalEl = document.getElementById('modal-overlay');
  if(modalEl && modalEl.classList.contains('modal-open')) return;

  pendingContext={team,type};
  const titleLabel=document.getElementById('modal-title-label');
  if(titleLabel){
    if(type==='TA')titleLabel.innerHTML='🟨 TARJETA AMARILLA';
    else if(type==='TR')titleLabel.innerHTML='🟥 TARJETA ROJA';
    else titleLabel.innerHTML='DATOS JUGADOR';
  }
  // El toggle de roja directa está en el modal de selección de equipo (card-type-toggle)
  const redToggle = document.getElementById('modal-red-toggle');
  if(redToggle) redToggle.style.display = 'none';

  // Mostrar botón ← volver al modal de selección de equipo
  // Solo cuando la llamada viene de una tarjeta (type TA o TR)
  const backBtn = document.getElementById('modal-back-btn');
  if(backBtn) backBtn.style.display = (type === 'TA' || type === 'TR') ? 'flex' : 'none';
  showModal(`JUGADOR (${type})`,(player,reason)=>{
    player=player||"Desconocido";
    if(!state.players[team].includes(player))state.players[team].push(player);
    let finalType=pendingContext.type,wasDouble=false;
    if(finalType==='TA'){
      // B3: buscar TA por nombre de jugador en cualquier equipo (cubre post-swap)
      if(hasYellowCard(player)){finalType='TR';wasDouble=true;}
    }
    const origTeam = getOrigTeam(team);
    const tName    = getOrigName(origTeam);
    const minute   = getMatchMinuteRounded();
    state.events.push({id:Date.now(),team:origTeam,teamName:tName,type:finalType,player,reason,wasDouble,period:state.period,minute});
    renderEventList();
    autoSave();
    updateLiveScoreboard(); // DMark: actualizar marcador con tarjetas
    // DMark: NO enviar mensaje individual si marcador visual está activo
    if(discordConnected && !_dmarkActive){
      const label=finalType==='TA'?'🟨 Tarjeta amarilla — enviando…':'🟥 Tarjeta roja — enviando…';
      const histLabel=finalType==='TA'?`🟨 TA · ${player}`:`🟥 TR · ${player}`;
      const cardPayload=buildCardPayload(finalType,player,tName,reason);
      enqueueCountdown(label,async()=>{const id=await sendEmbed(cardPayload);_addMsgHistory(id,histLabel,cardPayload);});
    }
  },true,true,team);  // showSugg=true, showReason=true (opcional)
}

// ── Tarjeta desde overlay (sin modal) ────────────────────────────
// Llamada cuando llega un 'card_event' del bridge de HaxRef Live.
// visualTeam: 'red'|'blue' en coordenadas VISUALES (ya resuelto por el overlay).
// type: 'TA'|'TR'. player: nombre del jugador.
function applyCardFromOverlay({ visualTeam, type, player }) {
  if (!state.inProgress || state.endTime) return;
  if (!player || !visualTeam || !type) return;

  // Convertir lado visual → lado físico para operar sobre state.players
  const origTeam = getOrigTeam(visualTeam);
  const tName    = getOrigName(origTeam);

  // Asegurar que el jugador esté en el roster físico correcto
  if (!state.players[origTeam].includes(player)) {
    state.players[origTeam].push(player);
  }
  const minute   = getMatchMinuteRounded();

  // Detectar doble amarilla igual que promptEvent
  let finalType = type;
  let wasDouble = false;
  if (finalType === 'TA' && hasYellowCard(player)) {
    finalType = 'TR';
    wasDouble = true;
  }

  state.events.push({
    id: Date.now(),
    team: origTeam,
    teamName: tName,
    type: finalType,
    player,
    reason: '',
    wasDouble,
    period: state.period,
    minute,
    fromOverlay: true, // marcar origen para debug
  });

  renderEventList();
  autoSave();
  updateLiveScoreboard();

  if (discordConnected && !_dmarkActive) {
    const label     = finalType === 'TA' ? '🟨 Tarjeta amarilla — enviando…' : '🟥 Tarjeta roja — enviando…';
    const histLabel = finalType === 'TA' ? `🟨 TA · ${player}` : `🟥 TR · ${player}`;
    const cardPayload = buildCardPayload(finalType, player, tName, '');
    enqueueCountdown(label, async () => {
      const id = await sendEmbed(cardPayload);
      _addMsgHistory(id, histLabel, cardPayload);
    });
  }

  console.log(`[HaxRef Live] Tarjeta desde overlay: ${finalType} · ${player} · ${tName} · min ${minute}`);
}

function deleteEvent(eventId){
  const ev=state.events.find(e=>e.id===eventId);
  if(!ev)return;
  // Buscar mensaje correlacionado por label con nombre del jugador
  const playerLabel=ev.type==='TA'?`🟨 TA · ${ev.player}`:`🟥 TR · ${ev.player}`;
  const queueIdx=cdQueue.findIndex(q=>q.label.includes(ev.player)&&(q.label.includes('🟨')||q.label.includes('🟥')));
  const histMsg=msgHistory.find(m=>m.label===playerLabel);

  const _doDelete=()=>{
    state.events=state.events.filter(e=>e.id!==eventId);
    state.events.forEach(e=>{
      if(e.type==='TR'&&e.wasDouble){
        const stillHasTA=state.events.some(x=>x.player===e.player&&x.type==='TA'&&x.id!==e.id);
        if(!stillHasTA)e.wasDouble=false;
      }
    });
    renderEventList();autoSave();
    updateLiveScoreboard(); // DMark: actualizar marcador
  };

  if(queueIdx>=0){
    // Está en delay — cancelar sin preguntar
    if(queueIdx===0&&cdInterval){clearInterval(cdInterval);cdInterval=null;cdCurrentCb=null;}
    cdQueue.splice(queueIdx,1);
    if(queueIdx===0&&cdQueue.length)_processQueue();else _renderStack();
    _doDelete();
  }else if(histMsg&&discordConnected){
    showConfirm(
      `¿Eliminar la sanción de ${ev.player}?\n(ya se había enviado a Discord)`,
      ()=>{deleteMsg(histMsg.dcId);_removeMsgByUid(histMsg.uid);_doDelete();},
      ()=>{_doDelete();},
      'BORRAR DE DC','SOLO QUITAR'
    );
  }else{
    _doDelete();
  }
}
function renderEventList(){
  // Determinar qué equipos van en cada columna visual (rojo/azul)
  // Usamos teamName guardado en el evento para seguir al equipo tras swap
  ['red','blue'].forEach(side=>{
    const currentName=side==='red'?state.redName:state.blueName;
    const c=document.getElementById(`list-${side}`);c.innerHTML='';
    // Mostrar eventos cuyo teamName coincide con el equipo actualmente en ese lado
    // Compatibilidad: eventos viejos sin teamName usan e.team
    state.events.filter(e=>(e.type==='TA'||e.type==='TR')&&(e.teamName?e.teamName===currentName:e.team===side)).forEach(e=>{
      const div=document.createElement('div');div.className=`card-item ${e.type}`;
      const icon=e.type==='TA'?'🟨':'🟥';
      const pNum=e.period===1?'1T':e.period===2?'2T':e.period==='HT'?'HT':null;
      const pLbl=pNum?` <span style="color:#3d1a5a;font-size:10px">[${pNum}]</span>`:'';
      const dLbl=e.wasDouble?` <span style="color:#5a2a2a;font-size:10px">(2TA)</span>`:'';
      const rLbl=e.reason?` <span style="color:#444;font-size:10px">— ${e.reason}</span>`:'';
      div.innerHTML=`<div><b>${icon}</b> ${e.player}${pLbl}${dLbl}${rLbl}</div><div class="delete-btn" onclick="deleteEvent(${e.id})">×</div>`;
      c.appendChild(div);
    });
  });
}

// ══════════════════════════════════════════════════
//  HISTORIAL
// ══════════════════════════════════════════════════
let currentWeekFilter='all';

function toggleHistory(show){
  const panel = document.getElementById('history-panel');
  if(show){
    panel.style.display='flex';
    panel.classList.remove('hp-closing');
    requestAnimationFrame(()=> panel.classList.add('hp-open'));
    buildWeekSidebar(); loadHistoryUI('all');
  } else {
    panel.classList.remove('hp-open');
    panel.classList.add('hp-closing');
    setTimeout(()=>{ panel.classList.remove('hp-closing'); panel.style.display='none'; }, 150);
  }
}

function getWeekLabel(savedAt){
  if(!savedAt)return'Sin fecha';
  const d=new Date(savedAt);if(isNaN(d))return'Sin fecha';
  const now=new Date();
  const startOfWeek=dt=>{const d2=new Date(dt);d2.setHours(0,0,0,0);const day=d2.getDay()||7;d2.setDate(d2.getDate()-day+1);return d2;};
  const thisW=startOfWeek(now),prevW=new Date(thisW);prevW.setDate(prevW.getDate()-7);
  const dW=startOfWeek(d);
  if(dW>=thisW)return'Esta semana';
  if(dW>=prevW)return'Sem. anterior';
  const endW=new Date(dW);endW.setDate(endW.getDate()+6);
  const fmt=dt=>`${dt.getDate()}/${dt.getMonth()+1}`;
  return`${fmt(dW)}-${fmt(endW)}`;
}

function buildWeekSidebar(){
  const h=getHistory(),sidebar=document.getElementById('hist-sidebar');
  const weeks=[],seen=new Set();
  h.forEach(m=>{if(!m._sep){const l=getWeekLabel(m.savedAt);if(l&&!seen.has(l)){seen.add(l);weeks.push(l);}}});
  sidebar.innerHTML=`<div class="hist-week-btn ${currentWeekFilter==='all'?'active':''}" onclick="filterWeek('all',this)">TODO</div>`;
  if(weeks.length>1){
    sidebar.innerHTML+='<div class="hist-week-sep"></div>';
    weeks.forEach(w=>{
      const a=currentWeekFilter===w?'active':'';
      const short=w==='Esta semana'?'ESTA SEM.':w==='Sem. anterior'?'SEM. ANT.':w;
      sidebar.innerHTML+=`<div class="hist-week-btn ${a}" onclick="filterWeek('${w.replace(/'/g,"\\'")}',this)">${short}</div>`;
    });
  }
}

function filterWeek(week,el){
  currentWeekFilter=week;
  document.querySelectorAll('.hist-week-btn').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  loadHistoryUI(week);
}

function getHistory(){
  const raw=JSON.parse(localStorage.getItem('haxref_v2_history')||'[]');
  // Mantener partidos con score/eventos siempre; los vacíos (solo startTime)
  // que lleven más de 20 min sin actividad se descartan automáticamente.
  const TWENTY_MIN=20*60*1000;
  const now=Date.now();
  return raw.filter(m=>{
    if(m._sep)return true;
    const hasData=m.score?.red||m.score?.blue||m.events?.length;
    if(hasData)return true;
    // Si no tiene datos y la sesión caducó, descartar
    const age=now-(m.id||0);
    return age<TWENTY_MIN;
  });
}

function loadHistoryUI(weekFilter){
  const list=document.getElementById('match-list');
  const raw=getHistory();
  const items=weekFilter==='all'?raw:raw.filter(m=>m._sep||getWeekLabel(m.savedAt)===weekFilter);
  if(!items.length){list.innerHTML="<div style='text-align:center;padding:20px;color:#444'>No hay partidos</div>";return;}
  list.innerHTML=items.map(m=>{
    if(m._sep)return`<div class="match-sep">
      <div class="match-sep-line"></div>
      <div class="match-sep-label">${m.label||'─────'}</div>
      <div class="match-sep-line"></div>
      <button class="match-sep-del" onclick="deleteSeparator(${m.id})">✕</button>
    </div>`;
    const sr=m.score.red,sb=m.score.blue;
    const badgeColor=sr>sb?'rgba(76,175,80,.15)':sr<sb?'rgba(255,42,42,.12)':'rgba(90,58,122,.15)';
    const badgeBorder=sr>sb?'#1a3a1a':sr<sb?'#3a1111':'#2a1a40';
    const badgeTxt=sr>sb?'#4caf50':sr<sb?'#ff6b6b':'#6a4a8a';
    return`<div class="match-item">
      <div style="flex:1" onclick="loadMatchFromHistory(${m.id})">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="color:#ccc;font-weight:700;font-size:13px">${m.redName} <span style="color:#eee">vs</span> ${m.blueName}</div>
          <div style="background:${badgeColor};border:1px solid ${badgeBorder};color:${badgeTxt};font-size:11px;font-weight:900;padding:1px 8px;border-radius:10px;font-family:monospace;flex-shrink:0">${sr}-${sb}</div>
        </div>
        <div style="font-size:10px;margin-top:3px;color:#3d1a5a">${m.startTime||'?'} — ${m.endTime||'?'} · ${getWeekLabel(m.savedAt)}</div>
      </div>
      <div class="match-actions">
        <span class="view-lnk" onclick="loadMatchFromHistory(${m.id})">VER ➜</span>
        <button class="del-match-btn" onclick="deleteMatchFromHistory(${m.id})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function addSeparator(){
  showModal('Nombre del separador (ej: JORNADA 3)',label=>{
    const h=getHistory();
    h.unshift({_sep:true,id:Date.now(),label:label||'──────'});
    localStorage.setItem('haxref_v2_history',JSON.stringify(h.slice(0,40)));
    buildWeekSidebar();loadHistoryUI(currentWeekFilter);
  },false);
}

function deleteSeparator(id){
  localStorage.setItem('haxref_v2_history',JSON.stringify(getHistory().filter(x=>x.id!==id)));
  buildWeekSidebar();loadHistoryUI(currentWeekFilter);
}

function saveMatchToHistory(){
  let h=getHistory();
  const idx=h.findIndex(x=>x.id===state.id);
  const snap=JSON.parse(JSON.stringify(state));snap.savedAt=new Date().toLocaleString();
  if(idx>=0)h[idx]=snap;else h.unshift(snap);
  localStorage.setItem('haxref_v2_history',JSON.stringify(h.slice(0,40)));
}

function deleteMatchFromHistory(id){
  localStorage.setItem('haxref_v2_history',JSON.stringify(getHistory().filter(x=>x.id!==id)));
  buildWeekSidebar();loadHistoryUI(currentWeekFilter);
}

function loadMatchFromHistory(id){
  const m=getHistory().find(x=>x.id===id);
  if(!m||m._sep)return;

  // Detener cronómetro del partido anterior antes de pisar state
  stopMatchTimer();

  state=JSON.parse(JSON.stringify(m));
  if(!state.origRed)state.origRed=state.redName;
  if(!state.origBlue)state.origBlue=state.blueName;
  if(!state.origScore)state.origScore={...state.score};
  if(!state.players)state.players={red:[],blue:[]};
  // state serializado puede traer timerInterval como número viejo — ya no existe en state,
  // pero por compatibilidad con partidos guardados antes del fix, eliminarlo explícitamente
  delete state.timerInterval;
  state.inProgress=false;

  // Resetear flags de módulo que NO viven en state
  _dmarkActive=false;          // evita bloquear envíos Discord del partido nuevo
  _matchTimerInterval=null;    // ya fue limpiado por stopMatchTimer(), confirmar

  if(state.endTime)endSnapshot=JSON.parse(JSON.stringify(state));
  initInterface();toggleHistory(false);
}

// AUTO-SAVE: persiste el partido 800ms después del ÚLTIMO cambio (debounce real)
// clearTimeout antes de setTimeout garantiza que el estado guardado es siempre el más reciente
let _autoSaveTimer=null;
function autoSave(){
  if(!state.id)return;
  if(!(state.score.red>0||state.score.blue>0||state.events.length>0||state.startTime))return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer=setTimeout(()=>{_autoSaveTimer=null;saveMatchToHistory();},800);
}

window.onbeforeunload=()=>{
  // B6: guardar también si el partido fue iniciado aunque sea 0-0
  if(state.score.red>0||state.score.blue>0||state.events.length>0||state.startTime)saveMatchToHistory();
};

// ══════════════════════════════════════════════════
//  EXPORTAR / IMPORTAR
// ══════════════════════════════════════════════════
function loadExportUI(){
  const list=document.getElementById('exp-list');
  const h=getHistory().filter(m=>!m._sep);
  if(!h.length){list.innerHTML=`<div class="exp-empty">No hay partidos guardados</div>`;return;}
  list.innerHTML=h.map(m=>`
    <label class="exp-item">
      <input type="checkbox" class="exp-check" value="${m.id}">
      <div class="exp-item-info">
        <div class="exp-item-title">${m.redName} ${m.score.red} - ${m.score.blue} ${m.blueName}</div>
        <div class="exp-item-sub">${m.startTime||'?'} — ${m.endTime||'?'} · ${m.savedAt||'?'}</div>
      </div>
    </label>`).join('');
}

function toggleSelectAll(){
  const checks=[...document.querySelectorAll('.exp-check')];
  const all=checks.every(c=>c.checked);checks.forEach(c=>c.checked=!all);
}

function exportSelected(){
  const ids=[...document.querySelectorAll('.exp-check:checked')].map(c=>parseInt(c.value));
  if(!ids.length){showAlert('Selecciona al menos un partido.');return;}
  const matches=getHistory().filter(m=>ids.includes(m.id));
  let txt=`HaxRef Pro 2.4.5 — Exportación\n${'═'.repeat(40)}\nExportado: ${new Date().toLocaleString()}\n\n`;
  matches.forEach((m,i)=>{
    txt+=`PARTIDO ${i+1}\n${'-'.repeat(30)}\n[HAXREF_MATCH_START]\n`;
    txt+=`id:${m.id}\nred:${m.redName}\nblue:${m.blueName}\n`;
    txt+=`score_red:${m.score.red}\nscore_blue:${m.score.blue}\n`;
    txt+=`orig_red:${m.origRed||m.redName}\norig_blue:${m.origBlue||m.blueName}\n`;
    txt+=`orig_score_red:${m.origScore?.red??m.score.red}\norig_score_blue:${m.origScore?.blue??m.score.blue}\n`;
    txt+=`start:${m.startTime||''}\nend:${m.endTime||''}\nsavedAt:${m.savedAt||''}\n`;
    txt+=`[HAXREF_MATCH_END]\n\n`;
  });
  const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`haxref_export_${Date.now()}.txt`;
  a.click();URL.revokeObjectURL(a.href);
}

// ── Exportar webhooks ──────────────────────────────────────────
function exportWebhooks(){
  const data = { _type:'haxref_webhooks', _version:'2.4.5', _date: new Date().toISOString(), webhooks:{} };
  WEBHOOK_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) data.webhooks[k] = v;
  });
  // También guardar el webhook activo detectado por variable JS
  if (typeof webhookUrl !== 'undefined' && webhookUrl) data.webhooks['_active_url'] = webhookUrl;
  if (!Object.keys(data.webhooks).length){ showAlert('No hay webhooks configurados para exportar.'); return; }
  _downloadJSON(data, `haxref_webhooks_${_dateSlug()}.json`);
}

// ── Exportar ajustes ───────────────────────────────────────────
function exportSettings(){
  const data = { _type:'haxref_settings', _version:'2.4.5', _date: new Date().toISOString(), settings:{} };
  SETTINGS_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) data.settings[k] = v;
  });
  if (!Object.keys(data.settings).length){ showAlert('No hay ajustes guardados para exportar.'); return; }
  _downloadJSON(data, `haxref_settings_${_dateSlug()}.json`);
}

// ── Backup completo (partidos + webhooks + ajustes) ────────────
function exportFullBackup(){
  const data = {
    _type: 'haxref_full_backup',
    _version: '2.4.5',
    _date: new Date().toISOString(),
    matches:  getHistory().filter(m=>!m._sep),
    webhooks: {},
    settings: {},
  };
  WEBHOOK_KEYS.forEach(k => { const v=localStorage.getItem(k); if(v!==null) data.webhooks[k]=v; });
  SETTINGS_KEYS.forEach(k => { const v=localStorage.getItem(k); if(v!==null) data.settings[k]=v; });
  _downloadJSON(data, `haxref_backup_${_dateSlug()}.json`);
}

// ── Importar backup completo ───────────────────────────────────
// Enrutador central: lee _type del archivo y llama al handler correcto.
// Usado por importWebhooks, importSettings e importFullBackup.
function _handleImportFile(e, allowedTypes){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let data;
    try { data = JSON.parse(ev.target.result); }
    catch { showAlert('Archivo JSON inválido.'); return; }

    const type = data._type || '';
    if (!type.startsWith('haxref_')){ showAlert('Este archivo no es un backup de HaxRef.'); return; }
    if (allowedTypes?.length && !allowedTypes.includes(type)){
      showAlert(`Archivo incorrecto.\nEsperado: ${allowedTypes.join(' o ')}\nRecibido: ${type}`);
      return;
    }

    let summary = [];

    const doImport = () => {
      // Partidos
      if (data.matches?.length) {
        let h = getHistory(); let added = 0;
        data.matches.forEach(p => { if(!h.find(x=>x.id===p.id)){ h.unshift(p); added++; } });
        localStorage.setItem('haxref_v2_history', JSON.stringify(h.slice(0,40)));
        if (added) summary.push(`${added} partido(s) importado(s)`);
      }
      // Webhooks
      if (data.webhooks && Object.keys(data.webhooks).length) {
        Object.entries(data.webhooks).forEach(([k,v]) => { if(!k.startsWith('_')) localStorage.setItem(k,v); });
        summary.push('webhooks restaurados');
      }
      // Ajustes
      if (data.settings && Object.keys(data.settings).length) {
        Object.entries(data.settings).forEach(([k,v]) => localStorage.setItem(k,v));
        summary.push('ajustes restaurados');
      }
      loadExportUI();
      showAlert(`✓ Importación completa:\n${summary.join('\n') || 'Sin datos nuevos.'}\n\nRecarga la página para aplicar los cambios.`);
    };

    const dateStr = data._date ? new Date(data._date).toLocaleString() : '?';
    showConfirm(
      `Backup HaxRef ${data._version||''} · ${type}\nFecha: ${dateStr}\n\n¿Importar y sobrescribir configuración actual?`,
      doImport, ()=>{}, 'IMPORTAR', 'CANCELAR'
    );
  };
  reader.readAsText(file);
  e.target.value = '';
}

function handleImportJSON(e){
  _handleImportFile(e, ['haxref_full_backup','haxref_webhooks','haxref_settings','haxref_matches']);
}
function handleImportWebhooks(e){
  _handleImportFile(e, ['haxref_webhooks','haxref_full_backup']);
}
function handleImportSettings(e){
  _handleImportFile(e, ['haxref_settings','haxref_full_backup']);
}

// ── Helpers ────────────────────────────────────────────────────
function _downloadJSON(data, filename){
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}
function _dateSlug(){
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}


function handleImport(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const txt=ev.target.result;
    const blocks=txt.split('[HAXREF_MATCH_START]').slice(1);
    if(!blocks.length){showAlert('No se encontraron partidos válidos en el archivo.');return;}
    const parsed=[];
    blocks.forEach(block=>{
      const end=block.indexOf('[HAXREF_MATCH_END]');
      const raw=end>=0?block.substring(0,end):block;
      const obj={};
      raw.trim().split('\n').forEach(l=>{const sep=l.indexOf(':');if(sep<0)return;obj[l.substring(0,sep).trim()]=l.substring(sep+1).trim();});
      if(!obj.red||!obj.blue)return;
      parsed.push({
        id:parseInt(obj.id)||Date.now()+Math.random(),
        redName:obj.red,blueName:obj.blue,
        origRed:obj.orig_red||obj.red,origBlue:obj.orig_blue||obj.blue,
        score:{red:parseInt(obj.score_red)||0,blue:parseInt(obj.score_blue)||0},
        origScore:{red:parseInt(obj.orig_score_red)||0,blue:parseInt(obj.orig_score_blue)||0},
        startTime:obj.start||null,endTime:obj.end||null,savedAt:obj.savedAt||new Date().toLocaleString(),
        events:[],players:{red:[],blue:[]},period:1,inProgress:false
      });
    });
    if(!parsed.length){showAlert('No se pudieron leer partidos del archivo.');return;}
    showConfirm(
      `Se encontraron ${parsed.length} partido(s).\n¿Agregar al historial local?`,
      ()=>{
        let h=getHistory();
        parsed.forEach(p=>{if(!h.find(x=>x.id===p.id))h.unshift(p);});
        localStorage.setItem('haxref_v2_history',JSON.stringify(h.slice(0,40)));
        loadExportUI();showAlert(`✓ ${parsed.length} partido(s) importado(s).`);
      },
      ()=>{},
      'IMPORTAR','CANCELAR'
    );
  };
  reader.readAsText(file);e.target.value='';
}

// ══════════════════════════════════════════════════
//  MODAL GENÉRICO
// ══════════════════════════════════════════════════
// ── Helper genérico de modales — show/hide por ID ──────────────
function _setModalVisible(id, show){
  if(show) _mOpen(id); else _mClose(id);
}

function showAlert(msg){
  const el=document.getElementById('generic-modal');
  document.getElementById('generic-msg-text').textContent=msg;
  document.getElementById('generic-btns').innerHTML=`<button class="gbtn-confirm" style="flex:none;width:100%" onclick="_mClose('generic-modal')">ACEPTAR</button>`;
  _mOpen(el);
}
let _cOk=null,_cCancel=null;
function showConfirm(msg,onOk,onCancel,lblOk='SÍ',lblNo='NO'){
  _cOk=onOk;_cCancel=onCancel;
  const el=document.getElementById('generic-modal');
  document.getElementById('generic-msg-text').textContent=msg;
  document.getElementById('generic-btns').innerHTML=`
    <button class="gbtn-cancel"  onclick="_closeConfirm(false)">${lblNo}</button>
    <button class="gbtn-confirm" onclick="_closeConfirm(true)">${lblOk}</button>`;
  _mOpen(el);
}
function _closeConfirm(ok){
  _mClose('generic-modal',()=>{
    const cb=ok?_cOk:_cCancel;_cOk=null;_cCancel=null;if(cb)cb();
  });
}

function copyDevUser(){
  navigator.clipboard.writeText('tutanka4781').catch(()=>{});
  const lbl=document.getElementById('dev-user-lbl');
  if(!lbl)return;
  const orig=lbl.textContent;
  lbl.textContent='✓ Copiado al portapapeles';lbl.style.color='#4caf50';
  setTimeout(()=>{lbl.textContent=orig;lbl.style.color='';},1800);
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
window.addEventListener('load',()=>{
  _initDcEl(); // cachear nodos Discord antes de cualquier updateDiscordUI
  _migrateOldWebhook();
  loadShields();
  refreshLogosList();
  const liveId = localStorage.getItem('haxref_live_message_id');
  if (liveId) state.liveMessageId = liveId;

  // DMark: Cargar parámetros de marcador visual
  const league = localStorage.getItem('scoreboard_league');
  const matchday = localStorage.getItem('scoreboard_matchday');
  const halfDuration = localStorage.getItem('half_duration');
  const dmarkInterval = localStorage.getItem('dmark_interval');
  const leagueEl = document.getElementById('scoreboard-league');
  const matchdayEl = document.getElementById('scoreboard-matchday');
  const halfEl = document.getElementById('half-duration');
  const intervalEl = document.getElementById('dmark-interval');
  if (league && leagueEl) leagueEl.value = league;
  if (matchday && matchdayEl) matchdayEl.value = matchday;
  if (halfDuration && halfEl) halfEl.value = halfDuration;
  if (dmarkInterval && intervalEl) intervalEl.value = dmarkInterval;

  // ── Detectar partido en curso al recargar ─────────────────────
  // Si hay un partido guardado sin endTime, ofrecer reanudarlo
  _checkResumeMatch();
  // DMark: inicializar pickers de color con valores guardados
  initDmarkColorUI();
});

function _checkResumeMatch() {
  const history = getHistory();
  // Buscar el partido más reciente sin endTime y con startTime (en curso)
  const inProgress = history.find(m =>
    !m._sep && m.startTime && !m.endTime && m.id
  );
  if (!inProgress) return;

  // Calcular cuánto tiempo lleva guardado
  const savedAt    = inProgress.savedAt ? Date.parse(inProgress.savedAt) : inProgress.id;
  const minutesAgo = Math.round((Date.now() - savedAt) / 60000);

  // No ofrecer continuar si han pasado más de 30 minutos
  const MAX_RESUME_MINS = 30;
  if (minutesAgo > MAX_RESUME_MINS) return;
  const timeLabel = minutesAgo < 60
    ? `hace ${minutesAgo} min`
    : `hace ${Math.round(minutesAgo/60)}h`;

  const redName  = inProgress.redName  || 'ROJO';
  const blueName = inProgress.blueName || 'AZUL';
  const score    = `${inProgress.score?.red ?? 0} - ${inProgress.score?.blue ?? 0}`;
  const period   = inProgress.inProgress ? '1T en curso' :
                   (inProgress.startTime && !inProgress.endTime ? '½T' : '');

  // Mostrar botón de reanudar en el launcher
  const launcher = document.getElementById('launcher');
  if (!launcher) return;

  // Crear el bloque de reanudar si no existe
  let resumeBlock = document.getElementById('resume-block');
  if (!resumeBlock) {
    resumeBlock = document.createElement('div');
    resumeBlock.id = 'resume-block';
    resumeBlock.style.cssText = `
      margin: 12px 0 0;
      padding: 12px 16px;
      background: rgba(124,58,237,.08);
      border: 1px solid rgba(124,58,237,.25);
      border-radius: 10px;
      text-align: center;
      cursor: pointer;
      transition: background .15s;
    `;
    resumeBlock.onmouseenter = () => resumeBlock.style.background = 'rgba(124,58,237,.15)';
    resumeBlock.onmouseleave = () => resumeBlock.style.background = 'rgba(124,58,237,.08)';
    // Insertarlo antes del primer botón del launcher
    const firstBtn = launcher.querySelector('.launcher-btn');
    if (firstBtn) launcher.insertBefore(resumeBlock, firstBtn);
    else launcher.appendChild(resumeBlock);
  }

  resumeBlock.innerHTML = `
    <div style="font-size:9px;letter-spacing:2px;color:#888888;margin-bottom:6px">PARTIDO EN CURSO</div>
    <div style="font-size:13px;font-weight:bold;color:#e0e0e0;margin-bottom:2px">${redName} vs ${blueName}</div>
    <div style="font-size:11px;color:#888;margin-bottom:8px">${score} &middot; ${period} &middot; ${timeLabel}</div>
    <div style="font-size:10px;color:#c0c0c0;letter-spacing:1px">▶ CONTINUAR</div>
  `;

  resumeBlock.onclick = () => {
    loadMatchFromHistory(inProgress.id);
    // Restaurar timer del partido guardado antes de arrancar el intervalo
    if (inProgress.matchTimer) state.matchTimer = inProgress.matchTimer;
    // Detener cualquier intervalo previo antes de arrancar el nuevo
    stopMatchTimer();
    if (inProgress.inProgress && !inProgress.endTime) {
      state.inProgress = true;
      startMatchTimer();
      updatePeriodUI();
    }
    console.log('[HaxRef] Partido reanudado:', inProgress.id, '| timer:', state.matchTimer + 's');
  };
}

// ══════════════════════════════════════════════════
//  DMark: SHIELDS MANAGEMENT
// ══════════════════════════════════════════════════
function uploadShield(team, input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const suggested = team === 'red' ? state.redName : state.blueName;
    // Comprimir a WebP 128x128 — reduce ~70% el peso
    const img = new Image();
    img.onload = () => {
      const MAX = 128;
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL('image/webp', 0.85) || canvas.toDataURL('image/png');
      showModal(`NOMBRE DEL LOGO (ej: ${suggested})`, teamName => {
        const key = (teamName || suggested).toLowerCase().trim();
        const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
        savedLogos[key] = base64;
        localStorage.setItem('saved_team_logos', JSON.stringify(savedLogos));
        if (team === 'red') {
          state.shieldRed = base64;
          localStorage.setItem('haxref_shield_red', base64);
          const prevEl = document.getElementById('shield-red-preview');
          if (prevEl) { prevEl.innerHTML = `<img src="${base64}">`; prevEl.classList.remove('empty'); }
        } else {
          state.shieldBlue = base64;
          localStorage.setItem('haxref_shield_blue', base64);
          const prevEl = document.getElementById('shield-blue-preview');
          if (prevEl) { prevEl.innerHTML = `<img src="${base64}">`; prevEl.classList.remove('empty'); }
        }
        refreshLogosList();
        updateLiveScoreboard();
        _updateScoreLogos();
        _syncOverlayFull();
      }, false);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearShield(team) {
  if (team === 'red') {
    state.shieldRed = null;
    localStorage.removeItem('haxref_shield_red');
    document.getElementById('shield-red-preview').innerHTML = '';
    document.getElementById('shield-red-preview').classList.add('empty');
  } else {
    state.shieldBlue = null;
    localStorage.removeItem('haxref_shield_blue');
    document.getElementById('shield-blue-preview').innerHTML = '';
    document.getElementById('shield-blue-preview').classList.add('empty');
  }
  updateLiveScoreboard();
  _updateScoreLogos();
  _syncOverlayFull();
}

function loadShields() {
  const sR = localStorage.getItem('haxref_shield_red');
  const sB = localStorage.getItem('haxref_shield_blue');
  if (sR) {
    state.shieldRed = sR;
    const prevR = document.getElementById('shield-red-preview');
    if (prevR) {
      prevR.innerHTML = `<img src="${sR}">`;
      prevR.classList.remove('empty');
    }
  }
  if (sB) {
    state.shieldBlue = sB;
    const prevB = document.getElementById('shield-blue-preview');
    if (prevB) {
      prevB.innerHTML = `<img src="${sB}">`;
      prevB.classList.remove('empty');
    }
  }
  _updateScoreLogos();
  _syncOverlayFull();
  _renderLogosGrid(); // refrescar biblioteca de logos
}

function refreshLogosList() {
  const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
  const redSelect = document.getElementById('saved-logos-red');
  const blueSelect = document.getElementById('saved-logos-blue');

  if (redSelect) {
    redSelect.innerHTML = '<option value="">-- Seleccionar logo guardado --</option>';
    Object.keys(savedLogos).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      redSelect.appendChild(opt);
    });
  }
  if (blueSelect) {
    blueSelect.innerHTML = '<option value="">-- Seleccionar logo guardado --</option>';
    Object.keys(savedLogos).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      blueSelect.appendChild(opt);
    });
  }
  // Actualizar grid de biblioteca si está visible
  _renderLogosGrid();
}

// Eliminar logo de la biblioteca
function deleteLogoFromLibrary(key) {
  const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
  const name = Object.keys(savedLogos).find(k => k === key);
  if (!name) return;
  if (!confirm(`¿Eliminar el logo "${name}" de la biblioteca?`)) return;
  delete savedLogos[key];
  localStorage.setItem('saved_team_logos', JSON.stringify(savedLogos));
  refreshLogosList();
}

// Grid de logos con previsualización y botón eliminar
function _renderLogosGrid() {
  const grid = document.getElementById('logos-library-grid');
  if (!grid) return;
  const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
  const keys = Object.keys(savedLogos);
  if (!keys.length) {
    grid.innerHTML = '<div style="font-size:10px;color:#333;letter-spacing:1px;padding:8px 0;text-align:center">SIN LOGOS GUARDADOS</div>';
    return;
  }
  grid.innerHTML = '';
  keys.forEach(key => {
    const el = document.createElement('div');
    el.className = 'logo-lib-item';
    el.innerHTML = `
      <img src="${savedLogos[key]}" alt="${key}" loading="lazy">
      <div class="logo-lib-name">${key}</div>
      <button class="logo-lib-del" onclick="deleteLogoFromLibrary('${key.replace(/'/g,"\\'")}')" title="Eliminar">✕</button>`;
    el.addEventListener('click', e => {
      if (e.target.classList.contains('logo-lib-del')) return;
      // Al clic en la card, preguntar a qué equipo asignar
      _assignLogoFromGrid(key, savedLogos[key]);
    });
    grid.appendChild(el);
  });
}

// Asignar logo de la grid a un equipo
function _assignLogoFromGrid(key, base64) {
  // Usar el mismo modal ligero
  const bd = document.createElement('div');
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;display:flex;align-items:center;justify-content:center';
  bd.innerHTML = `
    <div style="background:#161616;border:1px solid #2e2e2e;border-radius:14px;padding:20px;width:260px;font-family:var(--font-display);display:flex;flex-direction:column;gap:12px">
      <div style="font-size:10px;color:#555;letter-spacing:2px">ASIGNAR LOGO: ${key}</div>
      <img src="${base64}" style="width:64px;height:64px;object-fit:contain;margin:0 auto;border-radius:8px;background:#0a0a0a;padding:4px">
      <div style="display:flex;gap:8px">
        <button onclick="applyLogoToTeam('red','${key.replace(/'/g,"\\'")}')" style="flex:1;padding:10px;background:#1a0808;border:1px solid rgba(229,57,53,.3);color:#ff9999;border-radius:8px;font-size:10px;font-weight:900;letter-spacing:1px;cursor:pointer;font-family:var(--font-display)">🔴 ROJO</button>
        <button onclick="applyLogoToTeam('blue','${key.replace(/'/g,"\\'")}')" style="flex:1;padding:10px;background:#080818;border:1px solid rgba(30,136,229,.3);color:#99bbff;border-radius:8px;font-size:10px;font-weight:900;letter-spacing:1px;cursor:pointer;font-family:var(--font-display)">🔵 AZUL</button>
      </div>
      <button onclick="this.closest('[style]').remove()" style="background:transparent;border:1px solid #222;color:#555;padding:8px;border-radius:8px;font-size:10px;cursor:pointer;font-family:var(--font-display)">CANCELAR</button>
    </div>`;
  // Cerrar al tocar fuera
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
  document.body.appendChild(bd);
  // applyLogoToTeam cierra el backdrop
  window._logoGridBackdrop = bd;
}

function applyLogoToTeam(team, key) {
  if (window._logoGridBackdrop) { window._logoGridBackdrop.remove(); window._logoGridBackdrop = null; }
  const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
  const base64 = savedLogos[key];
  if (!base64) return;
  if (team === 'red') {
    state.shieldRed = base64;
    localStorage.setItem('haxref_shield_red', base64);
    const prevEl = document.getElementById('shield-red-preview');
    if (prevEl) { prevEl.innerHTML = `<img src="${base64}">`; prevEl.classList.remove('empty'); }
  } else {
    state.shieldBlue = base64;
    localStorage.setItem('haxref_shield_blue', base64);
    const prevEl = document.getElementById('shield-blue-preview');
    if (prevEl) { prevEl.innerHTML = `<img src="${base64}">`; prevEl.classList.remove('empty'); }
  }
  updateLiveScoreboard();
  _updateScoreLogos();
  _syncOverlayFull();
}

function selectSavedLogo(team, selectEl) {
  const teamName = selectEl.value;
  if (!teamName) return;
  
  const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
  const base64 = savedLogos[teamName];
  if (!base64) return;
  
  if (team === 'red') {
    state.shieldRed = base64;
    localStorage.setItem('haxref_shield_red', base64);
    const prevEl = document.getElementById('shield-red-preview');
    if (prevEl) {
      prevEl.innerHTML = `<img src="${base64}">`;
      prevEl.classList.remove('empty');
    }
  } else {
    state.shieldBlue = base64;
    localStorage.setItem('haxref_shield_blue', base64);
    const prevEl = document.getElementById('shield-blue-preview');
    if (prevEl) {
      prevEl.innerHTML = `<img src="${base64}">`;
      prevEl.classList.remove('empty');
    }
  }
  
  updateLiveScoreboard();
  _updateScoreLogos();
  _syncOverlayFull();
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════

// Debounced wrapper — evita recalcular el canvas en cada keypress / cambio rápido
function updateLiveScoreboard() {
  clearTimeout(updateLiveScoreboard._t);
  updateLiveScoreboard._t = setTimeout(() => {
    if (discordConnected && state.liveMessageId) {
      _patchScoreboardImage().catch(() => {});
    } else {
      generateScoreboardImage().catch(() => {});
    }
  }, 150);
}

async function generateScoreboardImage() {
  const canvas = document.getElementById('scoreboard-canvas');
  const ctx = canvas.getContext('2d');
  const W = 1600, H = 680; // más alto para acomodar más eventos

  // Actualizar dimensiones del canvas si cambiaron
  canvas.width = W; canvas.height = H;

  // ── Fondo ──────────────────────────────────────────
  const _bgData = localStorage.getItem('dmark_bg');
  if (_bgData) {
    await new Promise(resolve => {
      const bgImg = new Image();
      bgImg.onload = () => {
        const scale = Math.max(W / bgImg.width, H / bgImg.height);
        const sw = bgImg.width * scale, sh = bgImg.height * scale;
        const sx = (W - sw) / 2, sy = (H - sh) / 2;
        ctx.drawImage(bgImg, sx, sy, sw, sh);
        // Overlay para legibilidad
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
        resolve();
      };
      bgImg.onerror = () => { ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0,0,W,H); resolve(); };
      bgImg.src = _bgData;
    });
  } else {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);
  }

  // ── Sistema de colores DMark ──────────────────────────────────────
  // Lee de localStorage, usa defaults si no hay valor guardado
  const DC = _getDmarkColors();

  // Liga (arriba izquierda)
  const league = localStorage.getItem('scoreboard_league') || '';
  if (league) {
    ctx.fillStyle = DC.textMeta;
    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
    ctx.textAlign = 'left';
    ctx.fillText(league, 54, 50);
  }
  
  // Jornada (arriba centro)
  const matchday = localStorage.getItem('scoreboard_matchday') || '';
  if (matchday) {
    ctx.fillStyle = DC.textMeta;
    ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
    ctx.textAlign = 'center';
    ctx.fillText(matchday, W/2, 50);
  }
  
  // Estado (arriba derecha)
  let topStatusTxt = '';
  let topStatusColor = DC.textMeta;
  if (state.endTime) {
    topStatusTxt = 'Finalizado';
    topStatusColor = DC.colorFin;
  } else if (state.period === 'HT') {
    topStatusTxt = 'Medio tiempo';
    topStatusColor = DC.colorHT;
  } else if (state.inProgress) {
    topStatusTxt = 'En curso';
    topStatusColor = DC.colorPlay;
  }
  if (topStatusTxt) {
    ctx.fillStyle = topStatusColor;
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
    ctx.textAlign = 'right';
    ctx.fillText(topStatusTxt, W - 54, 50);
  }

  // ── Zonas de equipo: izq=lado visual red, der=lado visual blue ──────
  // Respetar el swap: si hay swap, el lado izq muestra el equipo orig azul y viceversa
  const swapped    = isSwapped();
  const leftName   = swapped ? state.origBlue : state.origRed;
  const rightName  = swapped ? state.origRed  : state.origBlue;
  const leftShield = swapped ? state.shieldBlue : state.shieldRed;
  const rightShield= swapped ? state.shieldRed  : state.shieldBlue;

  // Helper para dibujar un logo en una zona
  async function drawShield(shield, cx, cy, fallbackColor1, fallbackColor2) {
    if (shield) {
      const img = new Image();
      await new Promise(resolve => {
        img.onload = () => {
          const maxW = 200, maxH = 200;
          let w = img.width, h = img.height;
          const ratio = Math.min(maxW / w, maxH / h);
          w *= ratio; h *= ratio;
          const x = (cx - maxW / 2) + (maxW - w) / 2;
          const y = cy - maxH / 2 + (maxH - h) / 2;
          ctx.drawImage(img, x, y, w, h);
          resolve();
        };
        img.onerror = resolve;
        img.src = shield;
      });
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 52, 0, Math.PI * 2);
      ctx.fillStyle = fallbackColor1;
      ctx.fill();
      ctx.strokeStyle = fallbackColor2;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  // EQUIPO IZQUIERDO — nombre
  ctx.fillStyle = DC.textTeam;
  ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(leftName, 267, 127);
  // Logo izquierdo (centrado en x=267, y=237)
  await drawShield(leftShield, 267, 237,
    swapped ? 'rgba(50,80,180,0.18)'  : 'rgba(180,50,50,0.18)',
    swapped ? 'rgba(60,100,200,0.45)' : 'rgba(200,60,60,0.45)'
  );

  // EQUIPO DERECHO — nombre
  ctx.fillStyle = DC.textTeam;
  ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(rightName, 1333, 127);
  // Logo derecho (centrado en x=1333, y=237)
  await drawShield(rightShield, 1333, 237,
    swapped ? 'rgba(180,50,50,0.18)'  : 'rgba(50,80,180,0.18)',
    swapped ? 'rgba(200,60,60,0.45)'  : 'rgba(60,100,200,0.45)'
  );
  
  // MARCADOR CENTRAL
  ctx.fillStyle = DC.textScore;
  ctx.font = '700 100px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(state.score.red.toString(), 653, 270);
  // Separador: línea vertical fina en lugar del guión
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(800, 200); ctx.lineTo(800, 278);
  ctx.stroke();
  ctx.restore();
  ctx.fillText(state.score.blue.toString(), 947, 270);
  
  // MINUTO + PERIODO
  const minute = getMatchMinute();
  let statusTxt = '';
  let statusColor = DC.colorPlay;
  
  if (state.endTime) {
    statusTxt = 'FINALIZADO';
    statusColor = DC.colorFin;
  } else if (state.period === 'HT') {
    statusTxt = 'MEDIO TIEMPO';
    statusColor = DC.colorHT;
  } else if (state.inProgress) {
    const period = state.period === 1 ? '1T' : '2T';
    statusTxt = `${minute}' ${period}`;
  }
  
  if (statusTxt) {
    ctx.fillStyle = statusColor;
    ctx.font = '600 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'center';
    ctx.fillText(statusTxt, W/2, 320);
    ctx.letterSpacing = '0px';
  }
  
  // BARRA DE PROGRESO — redondeada
  const barW = 420;
  const barX = (W - barW) / 2;
  const barY = 342;
  const barH = 4;
  const barR = 2;

  // Función helper para rect redondeado
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  if (state.endTime) {
    ctx.fillStyle = DC.colorFin;
    roundRect(barX, barY, barW, barH, barR);
    ctx.fill();
  } else if (state.period === 'HT') {
    ctx.fillStyle = DC.colorHT;
    roundRect(barX, barY, barW, barH, barR);
    ctx.fill();
  } else if (state.inProgress) {
    const halfDuration = parseInt(localStorage.getItem('half_duration') || '8') * 60;
    const progress = Math.min(state.matchTimer / halfDuration, 1);
    // Fondo track
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(barX, barY, barW, barH, barR);
    ctx.fill();
    // Fill activo
    if (progress > 0) {
      ctx.fillStyle = DC.colorPlay;
      roundRect(barX, barY, Math.max(barW * progress, barR * 2), barH, barR);
      ctx.fill();
    }
  }

  // Separador visual entre área de score y eventos
  const divY = 364;
  const divGrad = ctx.createLinearGradient(0, divY, W, divY);
  divGrad.addColorStop(0,    'rgba(255,255,255,0)');
  divGrad.addColorStop(0.15, 'rgba(255,255,255,0.06)');
  divGrad.addColorStop(0.5,  'rgba(255,255,255,0.08)');
  divGrad.addColorStop(0.85, 'rgba(255,255,255,0.06)');
  divGrad.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.save();
  ctx.strokeStyle = divGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, divY); ctx.lineTo(W, divY);
  ctx.stroke();
  ctx.restore();

  // ── EVENTOS estilo Google Match (texto plano con emoji) ──────────
  // El canvas es estático: izquierda = equipo rojo original, derecha = azul original
  const redEvents  = state.events.filter(e => e.team === 'red');
  const blueEvents = state.events.filter(e => e.team === 'blue');

  const FONT_EV  = '18px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  const FONT_IC  = '18px Arial';
  const FONT_SEP = '900 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  const EV_GAP   = 28;
  const EV_X_L   = 54;
  const EV_X_R   = W - 54;
  const EV_ICON_W = 26;
  const EV_SEP    = 7;
  const EV_AREA_TOP = 384;
  const EV_AREA_H   = H - EV_AREA_TOP - 20;

  // Dividir eventos por periodo
  const ev1L = redEvents.filter(e  => e.period === 1 || e.period === 'HT');
  const ev2L = redEvents.filter(e  => e.period === 2);
  const ev1R = blueEvents.filter(e => e.period === 1 || e.period === 'HT');
  const ev2R = blueEvents.filter(e => e.period === 2);

  const hasTwoHalves = ev2L.length > 0 || ev2R.length > 0;

  // Máx eventos que caben en el área según EV_GAP
  const maxTotal = Math.floor(EV_AREA_H / EV_GAP);
  const maxPer   = Math.max(3, Math.floor(maxTotal / 2) - 1);

  // Helper: dibujar un evento a la izquierda
  function drawEvL(e, y) {
    const icon   = e.type === 'GOL' ? '⚽' : e.type === 'TA' ? '🟨' : '🟥';
    const min    = e.minute ? `${e.minute}'` : '';
    const player = (e.player && e.player !== 'Desconocido') ? e.player : '';
    let x = EV_X_L;
    ctx.font = FONT_IC; ctx.textAlign = 'left'; ctx.fillStyle = DC.textEvent;
    ctx.fillText(icon, x, y); x += EV_ICON_W;
    if (min) {
      ctx.font = FONT_EV; ctx.fillStyle = DC.textEventMin; ctx.textAlign = 'left';
      ctx.fillText(min, x, y); x += ctx.measureText(min).width + EV_SEP;
    }
    if (player) {
      ctx.font = FONT_EV; ctx.fillStyle = DC.textEvent; ctx.textAlign = 'left';
      ctx.fillText(player, x, y);
    }
  }

  // Helper: dibujar un evento a la derecha
  function drawEvR(e, y) {
    const icon   = e.type === 'GOL' ? '⚽' : e.type === 'TA' ? '🟨' : '🟥';
    const min    = e.minute ? `${e.minute}'` : '';
    const player = (e.player && e.player !== 'Desconocido') ? e.player : '';
    let x = EV_X_R;
    ctx.font = FONT_IC; ctx.textAlign = 'right'; ctx.fillStyle = DC.textEvent;
    ctx.fillText(icon, x, y); x -= EV_ICON_W;
    if (min) {
      ctx.font = FONT_EV; ctx.fillStyle = DC.textEventMin; ctx.textAlign = 'right';
      ctx.fillText(min, x, y); x -= ctx.measureText(min).width + EV_SEP;
    }
    if (player) {
      ctx.font = FONT_EV; ctx.fillStyle = DC.textEvent; ctx.textAlign = 'right';
      ctx.fillText(player, x, y);
    }
  }

  // Helper: separador horizontal con degradado a transparente en los bordes
  function drawHalfSep(y) {
    const sepW = W * 0.55;
    const sepX = (W - sepW) / 2;
    const grad = ctx.createLinearGradient(sepX, y, sepX + sepW, y);
    grad.addColorStop(0,    'rgba(180,180,180,0)');
    grad.addColorStop(0.15, 'rgba(180,180,180,0.35)');
    grad.addColorStop(0.5,  'rgba(180,180,180,0.55)');
    grad.addColorStop(0.85, 'rgba(180,180,180,0.35)');
    grad.addColorStop(1,    'rgba(180,180,180,0)');
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sepX, y); ctx.lineTo(sepX + sepW, y);
    ctx.stroke();
    // etiqueta "1T / 2T"
    ctx.font = FONT_SEP; ctx.fillStyle = 'rgba(160,160,160,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('· · ·', W / 2, y - 3);
    ctx.restore();
  }

  if (!hasTwoHalves) {
    // Sin 2T: todo el espacio para el 1T
    let yL = EV_AREA_TOP, yR = EV_AREA_TOP;
    redEvents.slice(0, maxTotal).forEach(e  => { drawEvL(e, yL); yL += EV_GAP; });
    blueEvents.slice(0, maxTotal).forEach(e => { drawEvR(e, yR); yR += EV_GAP; });
  } else {
    // Con 2T: dividir área verticalmente
    const halfH   = EV_AREA_H / 2;
    const sepY    = EV_AREA_TOP + halfH;

    // 1T — arriba, alineados desde abajo hacia el separador
    const rows1   = Math.max(ev1L.length, ev1R.length, 1);
    const block1H = Math.min(rows1, maxPer) * EV_GAP;
    let yL = sepY - 16 - block1H;
    let yR = sepY - 16 - block1H;
    ev1L.slice(0, maxPer).forEach(e => { drawEvL(e, yL); yL += EV_GAP; });
    ev1R.slice(0, maxPer).forEach(e => { drawEvR(e, yR); yR += EV_GAP; });

    // Separador
    drawHalfSep(sepY);

    // 2T — abajo desde el separador
    let yL2 = sepY + 20;
    let yR2 = sepY + 20;
    ev2L.slice(0, maxPer).forEach(e => { drawEvL(e, yL2); yL2 += EV_GAP; });
    ev2R.slice(0, maxPer).forEach(e => { drawEvR(e, yR2); yR2 += EV_GAP; });
  }

  // Convertir a blob
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/png');
  });
}

// ══════════════════════════════════════════════════
//  releaseTag: #4
//  DMARK COLOR SYSTEM
// ══════════════════════════════════════════════════
const DMARK_COLOR_DEFAULTS = {
  colorPlay: '#57f287',   // En juego (barra + estado)
  colorHT:   '#faa61a',   // Medio tiempo
  colorFin:  '#ed4245',   // Finalizado
  textTeam:  '#ffffff',   // Nombres de equipo + marcador
  textScore: '#ffffff',
  textMeta:  '#b9bbbe',   // Liga, jornada
  textEvent: '#ffffff',   // Emoji de gol/tarjeta
  textEventMin: 'rgba(255,255,255,0.55)', // Minuto gris
};

// Luminancia relativa de un hex para modo auto
function _hexLuminance(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const sRGB = v => v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  return 0.2126*sRGB(r) + 0.7152*sRGB(g) + 0.0722*sRGB(b);
}

// Devuelve un color de texto con buen contraste sobre el bg dado
function _autoTextColor(bgHex, light='#ffffff', dark='#1a1a2a') {
  try {
    const lum = _hexLuminance(bgHex);
    return lum > 0.35 ? dark : light;
  } catch { return light; }
}

// Versión semi-transparente para metadatos (liga/jornada)
function _autoMetaColor(bgHex) {
  try {
    const lum = _hexLuminance(bgHex);
    return lum > 0.35 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)';
  } catch { return 'rgba(255,255,255,0.6)'; }
}


function _getDmarkColors() {
  const raw = localStorage.getItem('dmark_colors');
  const saved = raw ? JSON.parse(raw) : {};
  const auto  = (saved.autoMode !== false); // default: true
  const bg    = localStorage.getItem('dmark_bg');     // data URL o null
  // Para auto mode necesitamos el color dominante del bg
  // Lo aproximamos con el color de fondo fallback si no hay imagen
  const bgHex = saved.bgFallback || '#2b2d31';

  if (auto && bg) {
    // Modo auto con imagen: colores de texto adaptados al bg
    const txt   = _autoTextColor(bgHex);
    const meta  = _autoMetaColor(bgHex);
    const minC  = _hexLuminance(bgHex) > 0.35
      ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)';
    return {
      colorPlay: saved.colorPlay || DMARK_COLOR_DEFAULTS.colorPlay,
      colorHT:   saved.colorHT   || DMARK_COLOR_DEFAULTS.colorHT,
      colorFin:  saved.colorFin  || DMARK_COLOR_DEFAULTS.colorFin,
      textTeam:  txt,
      textScore: txt,
      textMeta:  meta,
      textEvent: txt,
      textEventMin: minC,
    };
  }

  // Modo manual o sin imagen: usa valores guardados con fallback a defaults
  return {
    colorPlay:    saved.colorPlay    || DMARK_COLOR_DEFAULTS.colorPlay,
    colorHT:      saved.colorHT      || DMARK_COLOR_DEFAULTS.colorHT,
    colorFin:     saved.colorFin     || DMARK_COLOR_DEFAULTS.colorFin,
    textTeam:     saved.textTeam     || DMARK_COLOR_DEFAULTS.textTeam,
    textScore:    saved.textScore    || DMARK_COLOR_DEFAULTS.textScore,
    textMeta:     saved.textMeta     || DMARK_COLOR_DEFAULTS.textMeta,
    textEvent:    saved.textEvent    || DMARK_COLOR_DEFAULTS.textEvent,
    textEventMin: saved.textEventMin || DMARK_COLOR_DEFAULTS.textEventMin,
  };
}

// Guardar un color individual
function saveDmarkColor(key, value) {
  const raw = localStorage.getItem('dmark_colors');
  const saved = raw ? JSON.parse(raw) : {};
  saved[key] = value;
  localStorage.setItem('dmark_colors', JSON.stringify(saved));
  updateLiveScoreboard();
}

// Toggle auto mode
function toggleDmarkAuto(on) {
  const raw = localStorage.getItem('dmark_colors');
  const saved = raw ? JSON.parse(raw) : {};
  saved.autoMode = on;
  localStorage.setItem('dmark_colors', JSON.stringify(saved));
  // Mostrar/ocultar controles manuales
  const manual = document.getElementById('dmark-manual-colors');
  if (manual) manual.style.display = on ? 'none' : 'grid';
  updateLiveScoreboard();
}

// Inicializar los pickers de color con los valores guardados
function initDmarkColorUI() {
  const raw = localStorage.getItem('dmark_colors');
  const saved = raw ? JSON.parse(raw) : {};
  const auto  = saved.autoMode !== false;

  // Toggle
  const tog = document.getElementById('dmark-auto-toggle');
  if (tog) tog.checked = auto;
  const manual = document.getElementById('dmark-manual-colors');
  if (manual) manual.style.display = auto ? 'none' : 'grid';

  // Pickers
  const keys = ['colorPlay','colorHT','colorFin','textTeam','textScore','textMeta','textEvent'];
  keys.forEach(k => {
    const el = document.getElementById(`dmark-c-${k}`);
    if (el) el.value = saved[k] || DMARK_COLOR_DEFAULTS[k] || '#ffffff';
  });
}

function resetDmarkColors() {
  localStorage.removeItem('dmark_colors');
  initDmarkColorUI();
  // Restaurar swatches
  Object.entries(DMARK_COLOR_DEFAULTS).forEach(([k,v]) => {
    const sw = document.getElementById(`dmark-swatch-${k}`);
    if (sw && v.startsWith('#')) sw.style.background = v;
  });
  updateLiveScoreboard();
}

// Sync visual del toggle dmark-auto con clase .on
document.addEventListener('change', e => {
  if (e.target.id !== 'dmark-auto-toggle') return;
  _setToggle('dmark-auto-track', e.target.checked);
});

document.addEventListener('DOMContentLoaded', () => {
  const tog = document.getElementById('dmark-auto-toggle');
  if (tog) _setToggle('dmark-auto-track', tog.checked);
});
// ══════════════════════════════════════════════════
function loadDmarkBg(event){
  const file = event.target.files[0];
  if(!file) return;

  // Validar tamaño (máx 5MB para no reventar localStorage)
  if(file.size > 5 * 1024 * 1024){
    showAlert('La imagen es demasiado grande (máx 5 MB).');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const data = e.target.result;
    try {
      localStorage.setItem('dmark_bg', data);
    } catch(err) {
      showAlert('No hay espacio suficiente en el almacenamiento local. Prueba con una imagen más pequeña.');
      return;
    }
    _applyDmarkBgPreview(data);
    updateLiveScoreboard();
  };
  reader.readAsDataURL(file);
  // Limpiar input para permitir reseleccionar el mismo archivo
  event.target.value = '';
}

function clearDmarkBg(){
  localStorage.removeItem('dmark_bg');
  _applyDmarkBgPreview(null);
  updateLiveScoreboard();
}

function _applyDmarkBgPreview(data){
  const preview = document.getElementById('dmark-bg-preview');
  const clearBtn = document.getElementById('dmark-bg-clear');
  if(!preview) return;
  if(data){
    preview.style.backgroundImage = `url(${data})`;
    preview.style.backgroundSize = 'cover';
    preview.style.backgroundPosition = 'center';
    preview.innerHTML = '';
    if(clearBtn) clearBtn.style.display = 'block';
  } else {
    preview.style.backgroundImage = '';
    preview.innerHTML = '🖼️';
    if(clearBtn) clearBtn.style.display = 'none';
  }
}

// Restaurar preview al cargar la página
(function(){
  const saved = localStorage.getItem('dmark_bg');
  if(saved) _applyDmarkBgPreview(saved);
})();
// ══════════════════════════════════════════════════
const _npMap = {
  'sec-score':    'np-1',
  'sec-discord':  'np-2',
  'sec-messages': 'np-3',
  'sec-export':   'np-4',
  'sec-settings': 'np-5',
  'sec-social':   'np-6',
};
const _npLabels = {
  'np-1':'MARCADOR','np-2':'DISCORD','np-3':'D-MARK',
  'np-4':'EXPORTAR','np-5':'AJUSTES','np-6':'REDES'
};

function openNavPicker(){
  const p = document.getElementById('nav-picker');
  p.classList.remove('np-closing');
  p.classList.add('open');
  bgZoom(1);
}
function closeNavPicker(){
  const p = document.getElementById('nav-picker');
  if(!p.classList.contains('open')) return;
  p.classList.add('np-closing');
  bgZoom(-1);
  setTimeout(()=>{ p.classList.remove('open','np-closing'); }, 160);
}
function navPickerSelect(sectionId, npId, label){
  // Cambiar sección usando la función tab existente
  // Encontrar el nav-btn desktop equivalente para mantener sync
  const navBtnMap = {
    'sec-score':'nav-1','sec-discord':'nav-2',
    'sec-messages':'nav-3','sec-export':'nav-4','sec-settings':'nav-5','sec-social':'nav-6'
  };
  const desktopBtn = document.getElementById(navBtnMap[sectionId]);
  tab(sectionId, desktopBtn);

  // Actualizar estado visual del picker
  document.querySelectorAll('.nav-picker-item').forEach(i=>i.classList.remove('active'));
  const picked = document.getElementById(npId);
  if(picked) picked.classList.add('active');

  // Actualizar label en nav mobile
  const lbl = document.getElementById('nav-active-label');
  if(lbl) lbl.textContent = label;

  closeNavPicker();
}

// Sincronizar dc-dot del picker con el de la nav
function _syncPickerDcDot(){
  const dot = document.getElementById('np-dc-dot');
  const src = document.getElementById('dc-dot');
  if(!dot||!src) return;
  dot.classList.toggle('on', src.classList.contains('on'));
}

// Patch: cada vez que se enciende/apaga dc-dot, sincronizar picker
(function(){
  // Observar cambios en dc-dot
  const dcDotEl = document.getElementById('dc-dot');
  if(dcDotEl){
    const obs = new MutationObserver(_syncPickerDcDot);
    obs.observe(dcDotEl, {attributes:true, attributeFilter:['class']});
  }
})();

// ══════════════════════════════════════════════════
//  LONG PRESS en marcador (restar gol en móvil)
// ══════════════════════════════════════════════════
(function(){
  const LONG_MS = 500;
  ['score-red','score-blue'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const team = id === 'score-red' ? 'red' : 'blue';
    let timer = null;
    let fired = false;

    el.addEventListener('touchstart', e=>{
      fired = false;
      timer = setTimeout(()=>{
        fired = true;
        modScore(team, -1);
        // Feedback háptico si disponible
        if(navigator.vibrate) navigator.vibrate(40);
        el.style.opacity = '.6';
        setTimeout(()=>el.style.opacity='', 200);
      }, LONG_MS);
    }, {passive:true});

    el.addEventListener('touchend', e=>{
      clearTimeout(timer);
      // Si fue long press, no ejecutar el tap normal
      if(fired) e.preventDefault();
    });

    el.addEventListener('touchmove', ()=>{
      clearTimeout(timer);
    }, {passive:true});
  });
})();

// ══════════════════════════════════════════════════
//  SWIPE horizontal en .content para cambiar tab (móvil)
// ══════════════════════════════════════════════════
(function(){
  const tabOrder = ['sec-score','sec-discord','sec-messages','sec-export'];
  let startX = 0, startY = 0;

  const content = document.querySelector('.content');
  if(!content) return;

  content.addEventListener('touchstart', e=>{
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, {passive:true});

  content.addEventListener('touchend', e=>{
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // Solo swipe horizontal claro (>60px) y no muy vertical
    if(Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;

    const active = document.querySelector('.section.active');
    if(!active) return;
    const idx = tabOrder.indexOf(active.id);
    if(idx === -1) return;

    const next = dx < 0
      ? tabOrder[Math.min(idx+1, tabOrder.length-1)]
      : tabOrder[Math.max(idx-1, 0)];
    if(next === active.id) return;

    const npId = _npMap[next];
    const label = _npLabels[npId] || '';
    navPickerSelect(next, npId, label);
  }, {passive:true});
})();

// ══════════════════════════════════════════════════
//  HAXREF LIVE — Integración WebSocket bridge v1.4
//  Buffer siempre activo. El árbitro decide cuándo
//  aplicar los datos a HaxRef Pro.
// ══════════════════════════════════════════════════
(function initHaxRefLive() {
  const BRIDGE_URL   = 'ws://localhost:7331';
  const RECONNECT_MS = 4000;
  let ws = null;
  let _bridgeSend = null; // se asigna al conectar el bridge

  // ── Indicador visual ──────────────────────────────────────────
  function setLiveIndicator(on) {
    const dot = document.getElementById('haxlive-dot');
    if (!dot) return;
    dot.style.background  = on ? '#22c55e' : '#333';
    dot.style.boxShadow   = on ? '0 0 5px #22c55e' : 'none';
    dot.title = on ? 'HaxRef Live conectado' : 'HaxRef Live desconectado';
    // Heartbeat cuando está vivo
    if(on) dot.classList.add('live'); else dot.classList.remove('live');
  }

  // ══════════════════════════════════════════════════════════════
  //  BUFFER — Estado del partido actual detectado por la extensión
  //  Siempre activo, independiente de si HaxRef tiene partido.
  //  Se resetea en cada "Game stopped" (fin de periodo/partido).
  // ══════════════════════════════════════════════════════════════
  const BUFFER = {
    score:        { red: 0, blue: 0 },
    timerSeconds: 0,
    timerRunning: false,
    players:      [],
    goals:        [],
    matchStartedAt: null,
    period:       1,             // 1 = primer tiempo, 2 = segundo tiempo
    halftimePending: false,
  };

  let _bufferTimerInterval = null;
  function _startBufferTimer() {
    if (_bufferTimerInterval) return;
    BUFFER.timerRunning = true;
    _bufferTimerInterval = setInterval(() => {
      if (BUFFER.timerRunning) BUFFER.timerSeconds++;
    }, 1000);
  }
  function _stopBufferTimer() {
    BUFFER.timerRunning = false;
    if (_bufferTimerInterval) { clearInterval(_bufferTimerInterval); _bufferTimerInterval = null; }
  }
  function _resetBuffer() {
    _stopBufferTimer();
    BUFFER.score          = { red: 0, blue: 0 };
    BUFFER.timerSeconds   = 0;
    BUFFER.timerRunning   = false;
    BUFFER.goals          = [];
    BUFFER.matchStartedAt = null;
    // players y period NO se resetean — persisten entre periodos
  }

  // ══════════════════════════════════════════════════════════════
  //  APLICAR BUFFER A HAXREF
  //  Llamado cuando el árbitro presiona INICIAR o confirma el 2T.
  //  Toma el timer del buffer para no desincronizar el reloj.
  // ══════════════════════════════════════════════════════════════
  function applyBufferToHaxRef() {
    // Solo aplicar si hay un partido activo en el buffer
    if (!BUFFER.matchStartedAt && BUFFER.timerSeconds === 0) return;

    // Sincronizar el timer de HaxRef con el buffer
    state.matchTimer = BUFFER.timerSeconds;
    console.log('[HaxRef Live] Buffer aplicado — timer:', BUFFER.timerSeconds + 's, jugadores:', BUFFER.players.length);

    // Aplicar roster si tiene jugadores con equipo asignado
    const reds  = BUFFER.players.filter(p => p.team === 'red').map(p => p.name);
    const blues = BUFFER.players.filter(p => p.team === 'blue').map(p => p.name);
    if (reds.length || blues.length) {
      reds.forEach(n  => { if (!state.players.red.includes(n))  state.players.red.push(n); });
      blues.forEach(n => { if (!state.players.blue.includes(n)) state.players.blue.push(n); });
    }

    updatePeriodUI();
  }

  // Exponer para que el botón INICIAR pueda llamarlo
  window.__haxlive_applyBuffer = applyBufferToHaxRef;

  // ══════════════════════════════════════════════════════════════
  //  CONFIRMACIÓN DE MEDIO TIEMPO
  //  Aparece cuando la extensión detecta "Game stopped"
  //  El árbitro confirma o ignora desde HaxRef.
  // ══════════════════════════════════════════════════════════════
  function _showHalftimeConfirmation() {
    if (BUFFER.halftimePending) return; // ya está mostrando
    BUFFER.halftimePending = true;

    // Usar el sistema de confirm de HaxRef si existe, si no un toast simple
    if (typeof showConfirm === 'function') {
      showConfirm(
        '¿Iniciar medio tiempo?\n\nLa extensión detectó el fin del primer tiempo.',
        () => {
          // Confirmar → entrar en ½T
          BUFFER.halftimePending = false;
          BUFFER.period = 2;
          _stopBufferTimer();
          // Simular click en botón de ½T si HaxRef no lo hizo ya
          if (state.inProgress && !state.endTime) {
            const htBtn = document.getElementById('btn-ht-pause');
            if (htBtn) htBtn.click();
          }
          console.log('[HaxRef Live] Medio tiempo confirmado');
        },
        () => {
          // Rechazar → el árbitro lo maneja manual
          // Pero period sigue siendo 2 para que el fin del 2T no pida ½T de nuevo
          BUFFER.halftimePending = false;
          BUFFER.period = 2;
          console.log('[HaxRef Live] Medio tiempo ignorado — control manual');
        },
        'MEDIO TIEMPO', 'IGNORAR'
      );
    } else {
      // Fallback sin showConfirm: pulsar dot amarillo como indicador
      const dot = document.getElementById('haxlive-dot');
      if (dot) {
        const prevBg    = dot.style.background;
        const prevShadow = dot.style.boxShadow;
        const prevTitle = dot.title;
        dot.style.background = '#f5c542';
        dot.style.boxShadow  = '0 0 5px #f5c542';
        dot.title = '½T detectado — presioná ½T en HaxRef';
        setTimeout(() => {
          // Restaurar al estado anterior (no asumir que sigue conectado)
          dot.style.background = prevBg;
          dot.style.boxShadow  = prevShadow;
          dot.title = prevTitle;
          BUFFER.halftimePending = false;
        }, 10000);
      } else {
        BUFFER.halftimePending = false;
      }
    }
  }

  // ── Debounce gol automático ───────────────────────────────────
  let _lastAutoGoal = 0;
  const DEBOUNCE_MS = 3000;

  // ══════════════════════════════════════════════════════════════
  //  PROCESAMIENTO DE MENSAJES DEL BRIDGE
  // ══════════════════════════════════════════════════════════════
  function onMessage(msg) {
    switch (msg.type) {

      // ── Nuevo partido detectado ───────────────────────────
      case 'game_started': {
        _resetBuffer();
        BUFFER.matchStartedAt = Date.now();
        _startBufferTimer();
        console.log('[HaxRef Live] Game started — buffer listo (periodo', BUFFER.period + ')');

        if (state.inProgress && !state.endTime) {
          if (state.period === 'HT') {
            // HaxBall reanudó el partido tras el ½T → disparar 2T automático
            console.log('[HaxRef Live] 2T automático — period era HT');
            triggerHalfTimeEnd();
          } else {
            // Reanudación normal (pausa, reconexión) → solo resetear timer
            state.matchTimer = 0;
            updatePeriodUI();
            updateLiveScoreboard();
            console.log('[HaxRef Live] Timer reseteado a 0');
          }
        }
        break;
      }

      // ── Fin de periodo detectado ──────────────────────────
      // _resetBuffer() NO toca BUFFER.period — persiste entre periodos
      case 'game_stopped': {
        const wasFirstHalf = BUFFER.period === 1;
        _resetBuffer();
        console.log('[HaxRef Live] Game stopped — buffer reseteado (period era:', wasFirstHalf ? '1T' : '2T)');
        // El ht_request que content.js envía justo después dispara triggerHalfTimeStart().
        // No llamar _showHalftimeConfirmation() aquí — evita doble disparo.
        break;
      }

      // ── Gol detectado ─────────────────────────────────────
      case 'goal': {
        // Registrar en el buffer siempre
        BUFFER.goals.push({ ...msg.data, ts: Date.now() });

        // Aplicar a HaxRef solo si el partido está activo y no terminó
        // (esto cubre: no iniciado, medio tiempo, finalizado)
        if (!state.inProgress || state.endTime) {
          console.log('[HaxRef Live] Gol en buffer — HaxRef no activo');
          break;
        }

        // Debounce — evitar doble gol si árbitro también lo registra manual
        const now = Date.now();
        if (now - _lastAutoGoal < DEBOUNCE_MS) {
          console.log('[HaxRef Live] Gol ignorado — debounce');
          break;
        }
        _lastAutoGoal = now;

        const team = msg.data.team;
        modScore(team, 1);
        console.log('[HaxRef Live] Gol automático:', team);
        break;
      }

      // ── Sincronización del timer ──────────────────────────
      case 'timesync': {
        const gameSeconds = msg.data.seconds;
        if (typeof gameSeconds !== 'number') break;

        // Actualizar buffer siempre
        BUFFER.timerSeconds = gameSeconds;

        // Sincronizar HaxRef solo si tiene partido activo
        if (!state.inProgress || state.endTime || state.paused) break;
        const drift = Math.abs(gameSeconds - state.matchTimer);
        if (drift > 1) {
          console.log(`[HaxRef Live] Timer: local=${state.matchTimer}s juego=${gameSeconds}s drift=${drift}s`);
          state.matchTimer = gameSeconds;
          updatePeriodUI();
        }
        break;
      }

      // ── Pausa ─────────────────────────────────────────────
      case 'paused': {
        BUFFER.timerRunning = !msg.data.paused;
        if (!state.inProgress || state.endTime) break;
        if (state.paused === msg.data.paused) break;
        state.paused = msg.data.paused;
        updatePeriodUI();
        updateLiveScoreboard();
        console.log('[HaxRef Live] Pausa:', msg.data.paused ? 'PAUSADO' : 'REANUDADO',
          msg.data.by ? `(${msg.data.by})` : '');
        break;
      }

      // ── Jugadores ─────────────────────────────────────────
      case 'players': {
        const players = msg.data.players || [];
        window.__haxlive_players = players;
        BUFFER.players = players; // guardar en buffer

        // Aplicar a state.players si tienen equipo
        const reds  = players.filter(p => p.team === 'red').map(p => p.name);
        const blues = players.filter(p => p.team === 'blue').map(p => p.name);
        if (reds.length || blues.length) {
          reds.forEach(n  => { if (!state.players.red.includes(n))  state.players.red.push(n); });
          blues.forEach(n => { if (!state.players.blue.includes(n)) state.players.blue.push(n); });
        }
        window.dispatchEvent(new CustomEvent('haxlive:players', { detail: { players } }));
        break;
      }

      // ── Chat — parser de gol del bot ──────────────────────
      case 'chat': {
        const text = msg.data?.text || '';
        window.dispatchEvent(new CustomEvent('haxlive:chat', { detail: msg.data }));
        const goalMsg = _parseGoalMessage(text);
        if (goalMsg) {
          console.log('[HaxRef Live] Gol parseado:', goalMsg);
          _fillLastGoalEvent(goalMsg);
        }
        break;
      }

      case 'score':
        BUFFER.score = msg.data;
        break;

      // ── Log de reconciliación (al reconectar tras salir de la sala) ──
      // La extensión envía el log persistido en chrome.storage cuando
      // se reconecta al bridge. Usamos el timer y periodo para calibrar.
      case 'match_log': {
        const log = msg.data;
        if (!log) break;

        console.log('[HaxRef Live] Log recibido:', log.eventCount, 'eventos, timer:', log.lastTimer, 'period:', log.period);

        // Actualizar el buffer con los datos del log
        if (typeof log.lastTimer === 'number' && log.lastTimer > 0) {
          BUFFER.timerSeconds = log.lastTimer;
        }
        if (log.lastScore) BUFFER.score = log.lastScore;
        if (log.players?.length) BUFFER.players = log.players;
        if (log.period) BUFFER.period = log.period;

        // Si HaxRef tiene partido activo, reconciliar el timer
        if (state.inProgress && !state.endTime && typeof log.lastTimer === 'number') {
          const drift = Math.abs(log.lastTimer - state.matchTimer);
          if (drift > 5) {
            console.log(`[HaxRef Live] Reconciliación timer: local=${state.matchTimer}s log=${log.lastTimer}s drift=${drift}s`);
            state.matchTimer = log.lastTimer;
            updatePeriodUI();
          }
        }

        // Reconciliar periodo si no coincide
        if (log.period && log.period !== BUFFER.period) {
          console.log(`[HaxRef Live] Reconciliación periodo: buffer=${BUFFER.period} log=${log.period}`);
          BUFFER.period = log.period;
        }

        // Aplicar jugadores al roster de HaxRef si vienen del log
        if (log.players?.length) {
          const reds  = log.players.filter(p => p.team === 'red').map(p => p.name);
          const blues = log.players.filter(p => p.team === 'blue').map(p => p.name);
          reds.forEach(n  => { if (!state.players.red.includes(n))  state.players.red.push(n); });
          blues.forEach(n => { if (!state.players.blue.includes(n)) state.players.blue.push(n); });
          window.__haxlive_players = log.players;
        }

        break;
      }
      case 'overtime':
      case 'timewarn':
      case 'victory':
      case 'gameover':
        console.log('[HaxRef Live]', msg.type, msg.data);
        break;
      case 'state':
        console.log('[HaxRef Live] Estado bridge:', msg.data);
        break;

      // ── Control de tiempo desde overlay ──────────────────
      case 'ht_request': {
        // Botón HT pulsado en el overlay — solicitar ½T si corresponde
        if (state.inProgress && state.period === 1 && !state.endTime)
          triggerHalfTimeStart();
        break;
      }
      case 'resume_ht': {
        // Botón 2T▶ pulsado en el overlay — iniciar segundo tiempo
        if (state.inProgress && state.period === 'HT' && !state.endTime)
          triggerHalfTimeEnd();
        break;
      }
      case 'end_match': {
        // Botón FIN pulsado en el overlay — finalizar partido
        if (state.inProgress && !state.endTime)
          setMatchStatus('end');
        break;
      }

      // ── Tarjeta desde overlay ─────────────────────────────
      // msg.data: { visualTeam, type, player }
      // visualTeam está en coordenadas VISUALES (el overlay ya sabe
      // redName/blueName via _syncOverlayFull, y los mapea correctamente).
      case 'card_event': {
        const { visualTeam, type, player } = msg.data || {};
        if (!visualTeam || !type || !player) {
          console.warn('[HaxRef Live] card_event: datos incompletos', msg.data);
          break;
        }
        if (typeof applyCardFromOverlay === 'function') {
          applyCardFromOverlay({ visualTeam, type, player });
        }
        break;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  PARSER DE GOL DEL BOT
  // ══════════════════════════════════════════════════════════════
  function _parseGoalMessage(text) {
    if (!text || !/OL[,.]/.test(text)) return null;
    const scoreMatch = text.match(/(\d+)\s*[-–]\s*(\d+)/);
    const minMatch   = text.match(/(\d{1,3}(?::\d{2}|\+\d{1,2}))/);
    if (!scoreMatch) return null;
    const scoreRed  = parseInt(scoreMatch[1]);
    const scoreBlue = parseInt(scoreMatch[2]);
    const minute    = minMatch ? minMatch[1] : null;
    let rest = '';
    const ballIdx = text.indexOf('⚽');
    if (ballIdx >= 0) {
      rest = text.slice(ballIdx + 1).trim();
    } else if (minMatch) {
      rest = text.slice(text.indexOf(minMatch[1]) + minMatch[1].length).trim();
    }
    if (!rest) return null;
    const isOG = /\(OG\)/i.test(rest);
    rest = rest.replace(/\(OG\)/i, '').trim();
    const SEPARATORS = [
      /^(.*)\s*\(¡ESE PASE DE\s+(.+?)\)\s*$/i,
      /^(.*)\s*\(PASE DE\s+(.+?)\)\s*$/i,
      /^(.*)\s*\(asistido por\s+(.+?)\)\s*$/i,
      /^(.*)\s*\(assist[:\s]+(.+?)\)\s*$/i,
    ];
    let scorer = rest, assist = null;
    for (const sep of SEPARATORS) {
      const am = rest.match(sep);
      if (am) { scorer = am[1].trim(); assist = am[2].trim(); break; }
    }
    return { scoreRed, scoreBlue, minute, scorer: scorer.replace(/\s+$/, ''), assist, isOG };
  }

  function _fillLastGoalEvent(parsed) {
    if (!parsed?.scorer) return;
    const lastGoal = [...(state.events||[])].reverse().find(e => e.type === 'GOL');
    if (!lastGoal) return;
    const age = Date.now() - lastGoal.id;
    if (age > 15000) return;
    lastGoal.player = parsed.scorer;
    lastGoal.assist = parsed.assist || '';
    lastGoal.isOG   = parsed.isOG  || false;
    if (parsed.minute) lastGoal.minuteChat = parsed.minute;
    autoSave();
    if (typeof renderEventList === 'function') renderEventList();
    if (typeof updateScoreUI  === 'function') updateScoreUI();
    console.log('[HaxRef Live] Evento GOL rellenado:', lastGoal);
  }

  // ══════════════════════════════════════════════════════════════
  //  CONEXIÓN AL BRIDGE
  // ══════════════════════════════════════════════════════════════
  function connect() {
    try { ws = new WebSocket(BRIDGE_URL); } catch(e) {
      setTimeout(connect, RECONNECT_MS); return;
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'haxref_hello', data: { version: '2.4.5' }, ts: Date.now() }));
      setLiveIndicator(true);
      // Exponer _bridgeSend al scope global para que _syncOverlayFull pueda enviar overlay_cmd
      _bridgeSend = window._bridgeSend = (type, data) => {
        if (ws?.readyState === 1) {
          try { ws.send(JSON.stringify({ type, data, ts: Date.now() })); } catch(e) {}
        }
      };
      console.log('[HaxRef Live] Bridge conectado ✓');
    };
    ws.onmessage = ev => {
      try { onMessage(JSON.parse(ev.data)); } catch(e) {}
    };
    ws.onclose = () => {
      setLiveIndicator(false);
      ws = null;
      _bridgeSend = window._bridgeSend = null; // evitar llamadas al bridge desconectado
      setTimeout(connect, RECONNECT_MS);
    };
    ws.onerror = () => {};
  }

  // Cache de jugadores
  window.__haxlive_players = [];

  connect();
})();
