// releaseTag: #7 — haxref.js
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
  matchTimer:0, // DMark: segundos transcurridos (cronómetro)
  timerInterval:null // DMark: intervalo del cronómetro
};
let pendingContext   = null;
let discordConnected = false;
let webhookUrl       = '';
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
function startMatchTimer() {
  if (state.timerInterval) return; // Ya está corriendo
  state.timerInterval = setInterval(() => {
    if (state.inProgress && !state.endTime) {
      state.matchTimer++;
      // Actualizar marcador cada 15 segundos
      if (state.matchTimer % 15 === 0) {
        updateLiveScoreboard();
      }
    }
  }, 1000);
}

function stopMatchTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
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
let revertTimer = null;
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
  if(revertTimer) clearTimeout(revertTimer);
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
  [['nav-1',s.score],['nav-2',s.cards],['nav-3',s.discord],['nav-4',s.report],['nav-5',s.export]]
    .forEach(([id,txt]) => _setNodeText(document.getElementById(id), txt));

  // ── Nav picker labels ──────────────────────────────────────────
  [['np-1',s.npScore],['np-2',s.npCards],['np-3',s.npDiscord],['np-4',s.npReport],
   ['np-5',s.npExport],['np-6',s.npSettings],['np-7',s.npSocial],['np-exit',s.npExit]]
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

function changeDelay(delta){
  cdDelay=Math.max(3,Math.min(30,cdDelay+delta));
  localStorage.setItem('haxref_delay',cdDelay);
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
  // P5: limpiar estado ANTES de llamar _processQueue para evitar frame inconsistente
  cdCurrentCb=null;
  cdQueue.shift();
  cdRunning=false;
  _renderStack();
  if(cdQueue.length)_processQueue();
}
function sendNow(){
  if(cdInterval){clearInterval(cdInterval);cdInterval=null;}
  const cb=cdCurrentCb;cdCurrentCb=null;cdQueue.shift();cdRunning=false;
  if(cb)cb();_processQueue();
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
  document.getElementById('msg-history-modal').style.display='flex';
}
function closeMsgHistory(){
  document.getElementById('msg-history-modal').style.display='none';
}
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
  const dot=document.getElementById('dc-status-dot'),txt=document.getElementById('dc-status-txt');
  const btn=document.getElementById('dc-connect-btn'),nd=document.getElementById('dc-dot');
  if(discordConnected){
    dot.classList.add('on');txt.classList.add('on');txt.textContent='Conectado';
    btn.textContent='DESCONECTAR';btn.classList.add('connected');nd.classList.add('on');
    _startPing();
  }else{
    dot.classList.remove('on');txt.classList.remove('on');txt.textContent='Sin conexión';
    btn.textContent='CONECTAR';btn.classList.remove('connected');nd.classList.remove('on');
    _stopPing();
  }
  updateResendUI();
}

let _pingInFlight=false;
function _startPing(){
  _stopPing();
  _pingInterval=setInterval(async()=>{
    if(!webhookUrl||!discordConnected||_pingInFlight)return;
    _pingInFlight=true;
    try{
      const r=await fetch(webhookUrl,{method:'GET'});
      const dot=document.getElementById('dc-status-dot');
      const txt=document.getElementById('dc-status-txt');
      if(r.ok){
        dot.style.background='';dot.style.boxShadow='';
        dot.classList.add('on');
        txt.textContent='Conectado';txt.classList.add('on');txt.style.color='';
      }else{
        dot.classList.remove('on');
        dot.style.background='#ff6b2a';dot.style.boxShadow='0 0 8px rgba(255,107,42,.7)';
        txt.textContent=`Error ${r.status}`;txt.classList.remove('on');txt.style.color='#ff6b2a';
      }
    }catch(e){
      const dot=document.getElementById('dc-status-dot');
      const txt=document.getElementById('dc-status-txt');
      dot.classList.remove('on');
      dot.style.background='#ff2a2a';dot.style.boxShadow='0 0 8px rgba(255,42,42,.6)';
      txt.textContent='Sin conexión';txt.classList.remove('on');txt.style.color='var(--red)';
    }finally{_pingInFlight=false;}
  },(_activeFastPing?2:pingIntervalSecs)*1000);
}

function _stopPing(){
  if(_pingInterval){clearInterval(_pingInterval);_pingInterval=null;}
  // Resetear estilos inline del dot/txt
  const dot=document.getElementById('dc-status-dot');
  const txt=document.getElementById('dc-status-txt');
  if(dot){dot.style.background='';dot.style.boxShadow='';}
  if(txt){txt.style.color='';}
}

// ══════════════════════════════════════════════════
//  WEBHOOK TEMPLATES — variables simplificadas
// ══════════════════════════════════════════════════
const defaultTemplates={
  start:   {title:'¡Inicia el partido! {teamred} 🆚 {teamblue} · {hora}',                                   color:'#57f287'},
  ht_start:{title:'⏸️ Medio tiempo — {teamred} {scorered} - {scoreblue} {teamblue} · {hora}',               color:'#9d00ff'},
  ht_end:  {title:'▶️ ¡Comienza la 2T! {teamred} {scorered} - {scoreblue} {teamblue} · {hora}',             color:'#7c3aed'},
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


function buildWeGrid(){ return; }

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
async function _patchScoreboardImage() {
  if (!discordConnected || !webhookUrl || !state.liveMessageId) return;
  try {
    // Borrar mensaje anterior
    await fetch(`${webhookUrl}/messages/${state.liveMessageId}`, { method: 'DELETE' });
    state.liveMessageId = null;
    localStorage.removeItem('haxref_live_message_id');
    // Postear imagen actualizada
    await _sendScoreboardImage();
  } catch (e) {}
}

function queueMatchStart(){
  if (discordConnected) _sendScoreboardImage();
}
function resendStart(){
  if(!discordConnected){showAlert('Conecta el webhook primero.');return;}
  const p=buildHtStartPayload(); // usa snapshot actual como aproximación
  enqueueCountdown('🟢 Reenvío inicio…',async()=>{const id=await sendEmbed(p);_addMsgHistory(id,'🟢 Reenvío inicio',p);});
}
function resendEnd(){
  if(!discordConnected){showAlert('Conecta el webhook primero.');return;}
  if(!endSnapshot){showAlert('Finaliza el partido primero.');return;}
  const p=buildEndPayloadFromSnap(endSnapshot);
  enqueueCountdown('🏁 Reenvío final…',async()=>{const id=await sendEmbed(p);_addMsgHistory(id,'🏁 Reenvío final',p);});
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
  updateLiveScoreboard(); // DMark: actualizar marcador visual
  // DMark: NO enviar mensaje individual si marcador visual está activo
  if(discordConnected && !_dmarkActive){
    enqueueCountdown('▶️ Fin ½T — enviando…',async()=>{const id=await sendEmbed(p);_addMsgHistory(id,'▶️ Fin ½T',p);});
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
  if(document.getElementById('modal-overlay').style.display==='flex')return;
  if(document.getElementById('generic-modal').style.display==='flex')return;
  // Zoom con teclado (Ctrl + / Ctrl -)
  if(e.ctrlKey && (e.key==='=' || e.key==='+' || e.key==='NumpadAdd')){e.preventDefault();changeZoom(0.1);return;}
  if(e.ctrlKey && (e.key==='-' || e.key==='NumpadSubtract')){e.preventDefault();changeZoom(-0.1);return;}
  if(e.ctrlKey && e.key==='0'){e.preventDefault();zoomScale=1.0;_applyZoom(1.0);return;}
  if(!e.ctrlKey){
    if(e.key==='1')tab('sec-score',  document.getElementById('nav-1'));
    if(e.key==='2')tab('sec-cards',  document.getElementById('nav-2'));
    if(e.key==='3')tab('sec-discord',document.getElementById('nav-3'));
    if(e.key==='4')tab('sec-messages', document.getElementById('nav-4'));
    if(e.key==='5')tab('sec-export', document.getElementById('nav-5'));
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

  modal.style.display='flex';

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
  document.getElementById('wh-profiles-modal').style.display='none';
  const cb=_whpOnSelect;_whpOnSelect=null;
  if(cb)cb(profileId,noWebhook);
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
  const list=document.getElementById('dc-profiles-list');
  if(!list)return;
  const profiles=_getProfiles();
  const activeId=_getActiveProfileId();
  if(!profiles.length){
    list.innerHTML=`<div style="font-size:11px;color:#2a1a40;text-align:center;padding:14px 0;letter-spacing:.5px">Sin canales guardados — añade uno arriba</div>`;
    return;
  }
  list.innerHTML=profiles.map(p=>`
    <div class="whp-manage-item${p.id===activeId?' is-active':''}">
      <div class="whp-info" style="flex:1;min-width:0">
        <div class="whp-name" style="font-size:12px">${p.name}${p.id===activeId?' <span style="font-size:9px;color:var(--discord);letter-spacing:1px">● ACTIVO</span>':''}</div>
        <div class="whp-url">${p.url.replace('https://discord.com/api/webhooks/','…/webhooks/')}</div>
      </div>
      <div class="whp-manage-actions">
        <button class="whp-act-btn connect" onclick="connectProfile('${p.id}')">USAR</button>
        <button class="whp-act-btn" onclick="renameProfile('${p.id}')">✎</button>
        <button class="whp-act-btn del" onclick="deleteProfile('${p.id}')">✕</button>
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════
//  INICIO / INTERFAZ
// ══════════════════════════════════════════════════
function startNewMatch(){
  _migrateOldWebhook();
  showProfileSelector(async(profileId, noWebhook)=>{
    if(noWebhook||!profileId){
      // Sin webhook
      webhookUrl='';discordConnected=false;
      document.getElementById('dc-url-input').value='';
      document.getElementById('dc-webhook-info').classList.remove('visible');
      updateDiscordUI();
      askTeamNames();
      return;
    }
    // Usar perfil seleccionado
    const profiles=_getProfiles();
    const p=profiles.find(x=>x.id===profileId);
    if(!p){askTeamNames();return;}
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
    askTeamNames();
  });
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

function resetState(){
  state.id=Date.now();
  state.score={red:0,blue:0};state.origScore={red:0,blue:0};
  state.events=[];state.period=1;
  state.startTime=null;state.endTime=null;state.inProgress=false;
  state.players={red:[],blue:[]};
  state.liveMessageId=null;
  _dmarkActive=false;
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
  document.getElementById('lbl-red').innerText=state.redName;
  document.getElementById('lbl-blue').innerText=state.blueName;
  document.getElementById('cards-lbl-red').innerText=state.redName;
  document.getElementById('cards-lbl-blue').innerText=state.blueName;
  document.getElementById('btn-resend-start').style.display=state.startTime?'':'none';
  document.getElementById('btn-resend-end').style.display=state.endTime?'':'none';
  updateScoreUI();updateTimeUI();updatePeriodUI();
  renderEventList();updateDiscordUI();buildWeGrid();_updateMsgsBtn();
  renderProfilesList();
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
  if(el)el.classList.add('active');
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
  const btn=document.getElementById('period-btn');
  if(!state.startTime){btn.innerText='1T';btn.classList.remove('second');}
  else if(state.endTime){btn.innerText='FIN';btn.classList.add('second');}
  else if(!state.inProgress&&state.startTime){btn.innerText='½T';btn.classList.add('second');}
  else{btn.innerText=state.period===1?'1T':'2T';btn.classList.toggle('second',state.period!==1);}
}

function setMatchStatus(action){
  const ts=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  if(action==='start'){
    if(!state.inProgress){
      if(!state.startTime){
        // Partido NUEVO - limpiar liveMessageId para crear mensaje nuevo
        state.startTime=ts;
        state.liveMessageId=null;
        localStorage.removeItem('haxref_live_message_id');
        resetMatchTimer(); // DMark: resetear cronómetro
      }
      // Si startTime ya existe, es REANUDACIÓN - mantener liveMessageId
      state.endTime=null;state.inProgress=true;
      startMatchTimer(); // DMark: iniciar cronómetro
      queueMatchStart();
      autoSave();
      updateLiveScoreboard(); // DMark: crear/actualizar marcador visual
    }
  }else if(action==='end'){
    state.endTime=ts;state.inProgress=false;
    stopMatchTimer(); // DMark: detener cronómetro
    endSnapshot=JSON.parse(JSON.stringify(state));
    saveMatchToHistory();
    // DMark: ACTUALIZAR marcador final ANTES de limpiar liveMessageId
    if(discordConnected && state.liveMessageId){
      updateLiveScoreboard();
    }
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
    btn.innerText='EN JUEGO';btn.classList.add('playing');
    log.innerText=`INICIO: ${state.startTime} (Jugando…)`;
  }else if(state.endTime){
    btn.innerText='REANUDAR';btn.classList.remove('playing');
    log.innerText=`INICIO: ${state.startTime} — FIN: ${state.endTime}`;
  }else if(state.startTime){
    btn.innerText='REANUDAR';btn.classList.remove('playing');
    log.innerText=`INICIO: ${state.startTime} (½T)`;
  }else{
    btn.innerText='INICIAR';btn.classList.remove('playing');
    log.innerText='ESPERANDO INICIO…';
  }
  document.getElementById('btn-resend-start').style.display=state.startTime?'':'none';
}

function modScore(team,delta){
  // Anti-error: no se puede anotar si no ha iniciado o está en medio tiempo
  if(delta>0){
    if(!state.inProgress){showAlert('⚠️ No puedes anotar antes de iniciar el partido.');return;}
    if(state.startTime&&!state.inProgress&&!state.endTime){showAlert('⚠️ No puedes anotar durante el medio tiempo.');return;}
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
    const idx = [...state.events].map((e,i)=>({e,i})).reverse().find(({e})=>e.team===team&&e.type==='GOL');
    if(idx) state.events.splice(idx.i, 1);
  }
  const swapped=state.redName!==state.origRed;
  if(!swapped){state.origScore.red=state.score.red;state.origScore.blue=state.score.blue;}
  else{state.origScore.red=state.score.blue;state.origScore.blue=state.score.red;}
  
  // DMark: Registrar gol como evento con minuto redondeado
  if(delta>0&&state.inProgress){
    const minute = getMatchMinuteRounded();
    // equipo visual (team) ya es correcto post-swap
    state.events.push({
      id: Date.now(),
      team,                          // equipo visual (red/blue en pantalla)
      teamName: team==='red' ? state.redName : state.blueName,
      type: 'GOL',
      player: '',
      minute,
      period: state.period
    });
  }
  
  autoSave();
  updateLiveScoreboard(); // DMark: actualizar marcador visual
  if(delta>0&&state.inProgress){
    triggerGoalBall(team);
    // DMark: Si marcador visual está activo, NO enviar mensajes individuales de gol
    if(discordConnected && !_dmarkActive){
      const t=templates.goal;
      const hora=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const team_orig=(!swapped)?(team==='red'?state.origRed:state.origBlue):(team==='red'?state.origBlue:state.origRed);
      const goalPayload={title:applyVars(t.title,{team:team_orig,teamred:state.origRed,teamblue:state.origBlue,scorered:state.origScore.red,scoreblue:state.origScore.blue,hora}),color:hexToDec(t.color)};
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
  document.getElementById('score-red').innerText=state.score.red;
  document.getElementById('score-blue').innerText=state.score.blue;
  _updateScoreLogos();
}

// Sincroniza los logos encima de los scores con el equipo visual actual
function _updateScoreLogos(){
  const imgR = document.getElementById('score-logo-red');
  const phR  = document.getElementById('score-logo-red-ph');
  const imgB = document.getElementById('score-logo-blue');
  const phB  = document.getElementById('score-logo-blue-ph');

  if(imgR && phR){
    if(state.shieldRed){ imgR.src=state.shieldRed; imgR.style.display=''; phR.style.display='none'; }
    else               { imgR.style.display='none'; phR.style.display=''; }
  }
  if(imgB && phB){
    if(state.shieldBlue){ imgB.src=state.shieldBlue; imgB.style.display=''; phB.style.display='none'; }
    else                { imgB.style.display='none'; phB.style.display=''; }
  }
}

function swapTeams(){
  [state.redName,state.blueName]=[state.blueName,state.redName];
  [state.score.red,state.score.blue]=[state.score.blue,state.score.red];
  [state.players.red,state.players.blue]=[state.players.blue,state.players.red];
  // DMark: NO cambiar period si ya es 'HT'
  if(state.period !== 'HT') {
    state.period=state.period===1?2:1;
  }
  document.getElementById('lbl-red').innerText=state.redName;
  document.getElementById('lbl-blue').innerText=state.blueName;
  document.getElementById('cards-lbl-red').innerText=state.redName;
  document.getElementById('cards-lbl-blue').innerText=state.blueName;
  updateScoreUI();updatePeriodUI();renderEventList();
}
function showModal(placeholder,cb,showSugg=true,needsReason=false,teamFilter=null){
  modal.input.placeholder=placeholder;modal.input.value='';modal.reason.value='';
  modal.callback=cb;modal.needsReason=needsReason;
  modal.el.style.display='flex';
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
  if(!player){modal.input.style.borderColor='var(--red)';setTimeout(()=>modal.input.style.borderColor='#2a1a40',700);return;}
  // La razón es siempre opcional — si needsReason solo muestra el campo pero no obliga
  modal.el.style.display='none';if(modal.callback)modal.callback(player,reason);
}
function cancelModal(){modal.el.style.display='none';modal.callback=null;}
modal.input.addEventListener('keypress',e=>{if(e.key==='Enter'){if(modal.needsReason)modal.reason.focus();else confirmModal();}});
modal.reason.addEventListener('keypress',e=>{if(e.key==='Enter')confirmModal();});

// B3: detecta doble amarilla por nombre de jugador, ignorando lado visual (cross-swap)
function hasYellowCard(player){
  return state.events.some(e=>e.player===player&&e.type==='TA');
}
function promptEvent(team,type){
  pendingContext={team,type};
  const titleLabel=document.getElementById('modal-title-label');
  if(titleLabel){
    if(type==='TA')titleLabel.innerHTML='🟨 TARJETA AMARILLA';
    else if(type==='TR')titleLabel.innerHTML='🟥 TARJETA ROJA';
    else titleLabel.innerHTML='DATOS JUGADOR';
  }
  showModal(`JUGADOR (${type})`,(player,reason)=>{
    player=player||"Desconocido";
    if(!state.players[team].includes(player))state.players[team].push(player);
    let finalType=pendingContext.type,wasDouble=false;
    if(finalType==='TA'){
      // B3: buscar TA por nombre de jugador en cualquier equipo (cubre post-swap)
      if(hasYellowCard(player)){finalType='TR';wasDouble=true;}
    }
    // Guardar el nombre real del equipo en el evento (no el lado físico)
    // para que post-swap las tarjetas sigan al equipo correcto
    const swapped=state.redName!==state.origRed;
    const tName=(!swapped)?(team==='red'?state.origRed:state.origBlue):(team==='red'?state.origBlue:state.origRed);
    const minute = getMatchMinuteRounded(); // DMark: minuto redondeado
    state.events.push({id:Date.now(),team,teamName:tName,type:finalType,player,reason,wasDouble,period:state.period,minute}); // DMark: agregar minuto
    renderEventList();
    autoSave();
    updateLiveScoreboard(); // DMark: actualizar marcador con tarjetas
    // DMark: NO enviar mensaje individual si marcador visual está activo
    if(discordConnected && !_dmarkActive){
      const label=finalType==='TA'?'🟨 Tarjeta amarilla — enviando…':'🟥 Tarjeta roja — enviando…';
      const histLabel=finalType==='TA'?`🟨 TA · ${player}`:`🟥 TR · ${player}`;
      enqueueCountdown(label,async()=>{const id=await sendEmbed(payload);_addMsgHistory(id,histLabel,payload);});
    }
  },true,true,team);  // showSugg=true, showReason=true (opcional)
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
  document.getElementById('history-panel').style.display=show?'flex':'none';
  if(show){buildWeekSidebar();loadHistoryUI('all');}
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

function getHistory(){return JSON.parse(localStorage.getItem('haxref_v2_history')||'[]');}

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
  state=JSON.parse(JSON.stringify(m));
  if(!state.origRed)state.origRed=state.redName;
  if(!state.origBlue)state.origBlue=state.blueName;
  if(!state.origScore)state.origScore={...state.score};
  if(!state.players)state.players={red:[],blue:[]};
  state.inProgress=false;
  if(state.endTime)endSnapshot=JSON.parse(JSON.stringify(state));
  initInterface();toggleHistory(false);
}

// AUTO-SAVE: persiste el partido en cada cambio relevante
let _autoSaveTimer=null;
function autoSave(){
  if(!state.id)return;
  if(!(state.score.red>0||state.score.blue>0||state.events.length>0||state.startTime))return;
  if(_autoSaveTimer)return; // ya hay uno pendiente
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
  let txt=`HaxRef Pro 2.4.1 — Exportación\n${'═'.repeat(40)}\nExportado: ${new Date().toLocaleString()}\n\n`;
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

function triggerImport(){document.getElementById('import-file').click();}

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
function showAlert(msg){
  const el=document.getElementById('generic-modal');
  document.getElementById('generic-msg-text').textContent=msg;
  document.getElementById('generic-btns').innerHTML=`<button class="gbtn-confirm" style="flex:none;width:100%" onclick="document.getElementById('generic-modal').style.display='none'">ACEPTAR</button>`;
  el.style.display='flex';
}
let _cOk=null,_cCancel=null;
function showConfirm(msg,onOk,onCancel,lblOk='SÍ',lblNo='NO'){
  _cOk=onOk;_cCancel=onCancel;
  const el=document.getElementById('generic-modal');
  document.getElementById('generic-msg-text').textContent=msg;
  document.getElementById('generic-btns').innerHTML=`
    <button class="gbtn-cancel"  onclick="_closeConfirm(false)">${lblNo}</button>
    <button class="gbtn-confirm" onclick="_closeConfirm(true)">${lblOk}</button>`;
  el.style.display='flex';
}
function _closeConfirm(ok){
  document.getElementById('generic-modal').style.display='none';
  const cb=ok?_cOk:_cCancel;_cOk=null;_cCancel=null;if(cb)cb();
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
  _migrateOldWebhook();
  // buildWeGrid(); // DMark: Eliminado - no se usan mensajes personalizados
  loadShields();
  refreshLogosList(); // DMark: cargar lista de logos guardados
  // Cargar liveMessageId si existe
  const liveId = localStorage.getItem('haxref_live_message_id');
  if (liveId) state.liveMessageId = liveId;
  
  // DMark: Cargar parámetros de marcador visual
  const league = localStorage.getItem('scoreboard_league');
  const matchday = localStorage.getItem('scoreboard_matchday');
  const halfDuration = localStorage.getItem('half_duration');
  const leagueEl = document.getElementById('scoreboard-league');
  const matchdayEl = document.getElementById('scoreboard-matchday');
  const halfEl = document.getElementById('half-duration');
  if (league && leagueEl) leagueEl.value = league;
  if (matchday && matchdayEl) matchdayEl.value = matchday;
  if (halfDuration && halfEl) halfEl.value = halfDuration;
});

// ══════════════════════════════════════════════════
//  DMark: SHIELDS MANAGEMENT
// ══════════════════════════════════════════════════
function uploadShield(team, input) {
  const file = input.files[0];
  if (!file) return;
  
  // Pedir nombre del equipo
  const teamName = prompt(`Nombre del equipo para este logo:`);
  if (!teamName) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    
    // Guardar en biblioteca de logos
    const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
    savedLogos[teamName.toLowerCase().trim()] = base64;
    localStorage.setItem('saved_team_logos', JSON.stringify(savedLogos));
    
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
    
    // Actualizar lista de logos disponibles
    refreshLogosList();
    updateLiveScoreboard();
    _updateScoreLogos();
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
}

function refreshLogosList() {
  const savedLogos = JSON.parse(localStorage.getItem('saved_team_logos') || '{}');
  const redSelect = document.getElementById('saved-logos-red');
  const blueSelect = document.getElementById('saved-logos-blue');
  
  if (redSelect) {
    redSelect.innerHTML = '<option value="">-- Seleccionar logo guardado --</option>';
    Object.keys(savedLogos).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      redSelect.appendChild(opt);
    });
  }
  
  if (blueSelect) {
    blueSelect.innerHTML = '<option value="">-- Seleccionar logo guardado --</option>';
    Object.keys(savedLogos).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      blueSelect.appendChild(opt);
    });
  }
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
  const W = 1600, H = 534;
  
  // ── Fondo del canvas ──────────────────────────────
  const _bgData = localStorage.getItem('dmark_bg');
  if (_bgData) {
    await new Promise(resolve => {
      const bgImg = new Image();
      bgImg.onload = () => {
        // Dibujar cubriendo todo el canvas manteniendo aspect ratio (cover)
        const scale = Math.max(W / bgImg.width, H / bgImg.height);
        const sw = bgImg.width * scale, sh = bgImg.height * scale;
        const sx = (W - sw) / 2, sy = (H - sh) / 2;
        ctx.drawImage(bgImg, sx, sy, sw, sh);
        resolve();
      };
      bgImg.onerror = () => {
        // Fallback si la imagen falla
        ctx.fillStyle = '#2b2d31';
        ctx.fillRect(0, 0, W, H);
        resolve();
      };
      bgImg.src = _bgData;
    });
    // Overlay semitransparente para que los textos sigan legibles
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
  } else {
    // Fondo por defecto
    ctx.fillStyle = '#2b2d31';
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

  // ── Zonas de equipo: izq=red visual, der=blue visual ──────────────
  // EQUIPO ROJO - Nombre
  ctx.fillStyle = DC.textTeam;
  ctx.font = '600 29px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(state.origRed, 267, 127);
  
  // EQUIPO ROJO - Logo
  if (state.shieldRed) {
    const imgR = new Image();
    await new Promise(resolve => {
      imgR.onload = () => {
        const maxW = 200, maxH = 200;
        let w = imgR.width, h = imgR.height;
        const ratio = Math.min(maxW / w, maxH / h);
        w *= ratio; h *= ratio;
        const x = 167 + (maxW - w) / 2;
        const y = 147 + (maxH - h) / 2;
        ctx.drawImage(imgR, x, y, w, h);
        resolve();
      };
      imgR.onerror = resolve;
      imgR.src = state.shieldRed;
    });
  } else {
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🔴', 267, 280);
  }
  
  // EQUIPO AZUL - Nombre
  ctx.fillStyle = DC.textTeam;
  ctx.font = '600 29px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(state.origBlue, 1333, 127);
  
  // EQUIPO AZUL - Logo
  if (state.shieldBlue) {
    const imgB = new Image();
    await new Promise(resolve => {
      imgB.onload = () => {
        const maxW = 200, maxH = 200;
        let w = imgB.width, h = imgB.height;
        const ratio = Math.min(maxW / w, maxH / h);
        w *= ratio; h *= ratio;
        const x = 1233 + (maxW - w) / 2;
        const y = 147 + (maxH - h) / 2;
        ctx.drawImage(imgB, x, y, w, h);
        resolve();
      };
      imgB.onerror = resolve;
      imgB.src = state.shieldBlue;
    });
  } else {
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🔵', 1333, 280);
  }
  
  // MARCADOR CENTRAL
  ctx.fillStyle = DC.textScore;
  ctx.font = '700 93px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(state.score.red.toString(), 653, 267);
  ctx.fillText('-', 800, 267);
  ctx.fillText(state.score.blue.toString(), 947, 267);
  
  // MINUTO + PERIODO
  const minute = getMatchMinute();
  let statusTxt = '';
  let statusColor = DC.colorPlay;
  
  if (state.endTime) {
    statusTxt = 'FINALIZADO';
    statusColor = DC.colorFin;
  } else if (state.period === 'HT') {
    statusTxt = 'HT';
    statusColor = DC.colorHT;
  } else if (state.inProgress) {
    const period = state.period === 1 ? '1T' : '2T';
    statusTxt = `${minute}' ${period}`;
  }
  
  if (statusTxt) {
    ctx.fillStyle = statusColor;
    ctx.font = '600 27px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
    ctx.textAlign = 'center';
    ctx.fillText(statusTxt, W/2, 320);
  }
  
  // BARRA DE PROGRESO
  const barW = 400;
  const barX = (W - barW) / 2;
  const barY = 340;
  const barH = 5;
  
  if (state.endTime) {
    ctx.fillStyle = DC.colorFin;
    ctx.fillRect(barX, barY, barW, barH);
  } else if (state.period === 'HT') {
    ctx.fillStyle = DC.colorHT;
    ctx.fillRect(barX, barY, barW, barH);
  } else if (state.inProgress) {
    const halfDuration = parseInt(localStorage.getItem('half_duration') || '8') * 60;
    const progress = Math.min(state.matchTimer / halfDuration, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = DC.colorPlay;
    ctx.fillRect(barX, barY, barW * progress, barH);
  }

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
  const EV_AREA_TOP = 368;
  const EV_AREA_H   = H - EV_AREA_TOP - 18; // espacio disponible para eventos

  // Dividir eventos por periodo
  const ev1L = redEvents.filter(e  => e.period === 1 || e.period === 'HT');
  const ev2L = redEvents.filter(e  => e.period === 2);
  const ev1R = blueEvents.filter(e => e.period === 1 || e.period === 'HT');
  const ev2R = blueEvents.filter(e => e.period === 2);

  const hasTwoHalves = ev2L.length > 0 || ev2R.length > 0;

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
    // Sin 2T: layout original, alineado al top del área
    let yL = EV_AREA_TOP, yR = EV_AREA_TOP;
    redEvents.slice(0, 5).forEach(e  => { drawEvL(e, yL); yL += EV_GAP; });
    blueEvents.slice(0, 5).forEach(e => { drawEvR(e, yR); yR += EV_GAP; });
  } else {
    // Con 2T: dividir el área verticalmente en dos mitades con separador al centro
    const halfH   = EV_AREA_H / 2;
    const sepY    = EV_AREA_TOP + halfH;
    const maxPer  = 4; // máx eventos por mitad

    // 1T — arriba (alineados desde abajo hacia el separador)
    const rows1 = Math.max(ev1L.length, ev1R.length, 1);
    const block1H = Math.min(rows1, maxPer) * EV_GAP;
    let yL = sepY - 16 - block1H;
    let yR = sepY - 16 - block1H;
    ev1L.slice(0, maxPer).forEach(e => { drawEvL(e, yL); yL += EV_GAP; });
    ev1R.slice(0, maxPer).forEach(e => { drawEvR(e, yR); yR += EV_GAP; });

    // Separador
    drawHalfSep(sepY);

    // 2T — abajo (alineados desde arriba desde el separador)
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
  'sec-cards':    'np-2',
  'sec-discord':  'np-3',
  'sec-messages': 'np-4',
  'sec-export':   'np-5',
  'sec-settings': 'np-6',
  'sec-social':   'np-7',
};
const _npLabels = {
  'np-1':'MARCADOR','np-2':'SANCIONES','np-3':'DISCORD',
  'np-4':'MARCAS','np-5':'EXPORTAR','np-6':'AJUSTES','np-7':'REDES'
};

function openNavPicker(){
  document.getElementById('nav-picker').classList.add('open');
}
function closeNavPicker(){
  document.getElementById('nav-picker').classList.remove('open');
}
function navPickerSelect(sectionId, npId, label){
  // Cambiar sección usando la función tab existente
  // Encontrar el nav-btn desktop equivalente para mantener sync
  const navBtnMap = {
    'sec-score':'nav-1','sec-cards':'nav-2','sec-discord':'nav-3',
    'sec-messages':'nav-4','sec-export':'nav-5','sec-settings':'nav-6','sec-social':'nav-7'
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
  const tabOrder = ['sec-score','sec-cards','sec-discord','sec-messages','sec-export'];
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
