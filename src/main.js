import { SB_URL, SB_KEY } from './config.js';
import { checkInviteToken } from './auth/session.js';
import { openStudent, wireStudentLinks, stuNameLink } from './views/admin/student.js';

'use strict';

// ── SUPABASE CONFIG ──



function sbFetch(path, opts){
  return fetch(SB_URL + path, Object.assign({
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json'}
  }, opts || {}));
}

function sbInsert(row){
  return sbFetch('/rest/v1/incidents', {
    method:'POST',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
    body: JSON.stringify(row)
  });
}

function sbSelect(query){
  return sbFetch('/rest/v1/incidents?' + query);
}


// ── FETCH USER ROLE ──
function fetchRole(userId, cb){
  var tok = SESSION.token || SB_KEY;
  fetch(SB_URL + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(userId), {
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}
  }).then(function(r){ return r.json(); })
    .then(function(rows){
      var role = (rows && rows[0] && rows[0].role) || 'specials';
      if(cb) cb(null, role);
    })
    .catch(function(err){ if(cb) cb(err, 'teacher'); });
}

// ── AUTH via Supabase ──
var SB_AUTH_URL = SB_URL + '/auth/v1';
function sbSignIn(email, password){
  return fetch(SB_AUTH_URL + '/token?grant_type=password', {
    method:'POST',
    headers:{'apikey':SB_KEY,'Content-Type':'application/json'},
    body: JSON.stringify({email:email, password:password})
  });
}

// session token storage
var SESSION = {token: null, email: null, userId: null, role: null, refresh: null};
function saveSession(token, email, userId, refresh){
  SESSION.token = token; SESSION.email = email; SESSION.userId = userId || null; SESSION.refresh = refresh || null;
  try{
    localStorage.setItem('sb_token', token);
    localStorage.setItem('sb_email', email);
    if(userId) localStorage.setItem('sb_uid', userId);
    if(refresh) localStorage.setItem('sb_refresh', refresh);
  }catch(e){}
}
function loadSession(){
  try{
    var t=localStorage.getItem('sb_token');
    var e=localStorage.getItem('sb_email');
    var u=localStorage.getItem('sb_uid');
    var rf=localStorage.getItem('sb_refresh');
    if(t){SESSION.token=t;SESSION.email=e;SESSION.userId=u||null;SESSION.refresh=rf||null;return true;}
  }catch(e){}
  return false;
}
function refreshSession(cb){
  if(!SESSION.refresh){ if(cb) cb(false); return; }
  fetch(SB_AUTH_URL+'/token?grant_type=refresh_token',{
    method:'POST',
    headers:{'apikey':SB_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:SESSION.refresh})
  }).then(function(r){return r.json();})
  .then(function(data){
    if(data.access_token){
      saveSession(data.access_token, SESSION.email, data.user&&data.user.id, data.refresh_token);
      if(cb) cb(true);
    } else {
      if(cb) cb(false);
    }
  }).catch(function(){ if(cb) cb(false); });
}
function authedFetch(path, opts){
  if(!SESSION.token){ return Promise.reject(new Error('Not authenticated')); }
  var tok = SESSION.token;
  return fetch(SB_URL + path, Object.assign({
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok,'Content-Type':'application/json'}
  }, opts || {})).then(function(r){
    if(r.status === 401){
      return new Promise(function(res,rej){refreshSession(function(ok){if(ok)res(authedFetch(path,opts));else{signOut();rej(new Error('Session expired'));}});});
    }
    return r;
  });
}
function authedInsert(row){
  if(!SESSION.token){ return Promise.reject(new Error('Not authenticated')); }
  var tok = SESSION.token;
  return fetch(SB_URL + '/rest/v1/incidents', {
    method:'POST',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok,'Content-Type':'application/json','Prefer':'return=minimal'},
    body: JSON.stringify(row)
  }).then(function(r){
    if(r.status === 401){
      return new Promise(function(res,rej){refreshSession(function(ok){if(ok)res(authedInsert(row));else{signOut();rej(new Error('Session expired'));}});});
    }
    return r;
  });
}
function authedSelect(query){
  return authedFetch('/rest/v1/incidents?' + query);
}


// ── LIVE DATA ──

// ── ALL CLASSROOMS (grade-band ordered, includes zero-incident placeholders) ──
var ALL_CLASSES = [
  // Kindergarten
  'K-Fortner','K-Helms','K-McCormick','K-Wing',
  // 1st
  '1st-Beckett','1st-Cosetti','1st-Smith','1st-Worsely',
  // 2nd
  '2nd-Clark','2nd-Ham','2nd-Kennedy','2nd-Pollard',
  // 3rd
  '3rd-Danis/McClain','3rd-Jones','3rd-Mello',
  // 4th
  '4th-Bridgers','4th-Dohar','4th-Edwards',
  // 5th
  '5th-Coles','5th-Davis','5th-Smith',
  // EC / Other
  'EC'
];
var BAND_LABELS = {
  'K-Fortner':'Kindergarten','K-Helms':'Kindergarten','K-McCormick':'Kindergarten','K-Wing':'Kindergarten',
  '1st-Beckett':'1st Grade','1st-Cosetti':'1st Grade','1st-Smith':'1st Grade','1st-Worsely':'1st Grade',
  '2nd-Clark':'2nd Grade','2nd-Ham':'2nd Grade','2nd-Kennedy':'2nd Grade','2nd-Pollard':'2nd Grade',
  '3rd-Danis/McClain':'3rd Grade','3rd-Jones':'3rd Grade','3rd-Mello':'3rd Grade',
  '4th-Bridgers':'4th Grade','4th-Dohar':'4th Grade','4th-Edwards':'4th Grade',
  '5th-Coles':'5th Grade','5th-Davis':'5th Grade','5th-Smith':'5th Grade',
  'EC':'Exceptional Children'
};

var BEHAVIORS=['Disrupting learning environment','Disrespect or defiance','Noncompliance','Inappropriate language','Diminished participation','Deception / Lying','Rough Housing / Horseplay','Defacing School Property','Petty Theft','Out of Assigned Area','Inappropriate Touching','Sleeping/disengaged','Other'];
var MOTIVATIONS=['Attention','Power','Revenge','Avoidance'];
var CONTACT_METHODS=['Phone','Class Dojo','Email','IC Message'];
var BEHAVIOR_DISPLAY_MAP={
  'Verbal disruption':'Disrupting learning environment',
  'Disrupting learning environment':'Disrupting learning environment',
  'Off-task':'Diminished participation',
  'Diminished participation':'Diminished participation',
  'Out of seat':'Out of Assigned Area',
  'Out of Assigned Area':'Out of Assigned Area',
  'Physical behavior':'Rough Housing / Horseplay',
  'Rough Housing / Horseplay':'Rough Housing / Horseplay',
  'Peer conflict':'Disrespect or defiance',
  'Disrespect or defiance':'Disrespect or defiance',
  'Emotional distress':'Other',
  'Other':'Other',
  'Device misuse':'Disrupting learning environment',
  'Noncompliance':'Noncompliance',
  'Sleeping/disengaged':'Sleeping/disengaged',
  'Inappropriate language':'Inappropriate language',
  'Deception / Lying':'Deception / Lying',
  'Defacing School Property':'Defacing School Property',
  'Petty Theft':'Petty Theft',
  'Inappropriate Touching':'Inappropriate Touching'
};
function displayBehavior(tag){ return BEHAVIOR_DISPLAY_MAP[tag]||tag; }
var SUBJECTS_SPECIALS=['PE','Technology','Art','Music'];
var SUBJECTS_HOMEROOM=['Block 1','Block 2','Block 3','Lunch','Block 4','Block 5','Block 6','Reading','Math','Science','Small Group','Other'];
var SUBJECTS_IA=['PE','Technology','Art','Music','Block 1','Block 2','Block 3','Lunch','Block 4','Block 5','Block 6','Reading','Math','Science','Small Group','Other'];
var SUBJECTS=['PE','Technology','Art','Music'];
function getSubjects(){
  var r=SESSION&&SESSION.role?SESSION.role:'specials';
  if(r==='homeroom') return SUBJECTS_HOMEROOM;
  if(r==='ia') return SUBJECTS_IA;
  if(r==='admin') return SUBJECTS_IA;
  return SUBJECTS_SPECIALS;
}
var HOMEROOMS=ALL_CLASSES;
var SER=['#271A70','#BFA95F','#98A2AD','#271A70','#BFA95F','#98A2AD','#271A70','#BFA95F','#98A2AD','#271A70'];
var BEHAVIOR_COLORS=['#271A70','#BFA95F','#98A2AD','#271A70','#BFA95F','#98A2AD','#271A70','#BFA95F','#98A2AD','#271A70'];
var MONTH_COLORS=['#271A70','#BFA95F','#271A70','#BFA95F','#271A70','#BFA95F','#271A70','#BFA95F','#271A70','#BFA95F','#271A70','#BFA95F'];

var SUBJECT_TEACHER={
  'PE':'Mrs. Offield',
  'Technology':'Ms. Carmichael',
  'Art':'Mrs. Ali',
  'Music':'Mrs. Groff'
};

function getSubmitterDisplay(email, subject){
  if(email && email!=='import@waynestem.org' && email!=='specials-team'){
    return emailToDisplayName(email);
  }
  if(subject && SUBJECT_TEACHER[subject]) return SUBJECT_TEACHER[subject];
  return '';
}
var SC={'PE':'#271A70','Technology':'#BFA95F','Art':'#98A2AD','Music':'#271A70','P.E.':'#271A70'};


function scholarBarColor(count){
  if(count>=7) return '#271A70';
  if(count>=4) return '#BFA95F';
  return '#98A2AD';
}
function subjectBarColor(index){
  return index%2===0?'#271A70':'#BFA95F';
}

var HEAT_SCALE=[
  '#EDEAFA',
  '#CCC5F1',
  '#ABA0E9',
  '#8A7BE0',
  '#6956D7',
  '#4830CF',
  '#3B28A9',
  '#2E1F84',
  '#271A70',
  '#140E3A',
  '#070515'
];
function heatBucket(count,max){
  if(!max||count===0) return 0;
  var idx=Math.ceil((count/max)*(HEAT_SCALE.length-1));
  return Math.min(idx,HEAT_SCALE.length-1);
}
function heatColor(count,max){
  return HEAT_SCALE[heatBucket(count,max)];
}
function cssVar(name,fallback){
  var v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v||fallback;
}

var SCHOLAR_ALIASES={
  'ck':{student_name:'Chester King',homeroom:'3rd-Mello'},
  'chester':{student_name:'Chester King',homeroom:'3rd-Mello'},
  'kaiden h':{student_name:'Kaiden Horlback',homeroom:'2nd-Ham'},
  'austin':{student_name:'Austin Majano-Crowder',homeroom:'2nd-Clark'},
  'bryson':{student_name:'Bryson Oates',homeroom:'3rd-Danis/McClain'}
};
function resolveAlias(typed){
  var key=(typed||'').trim().toLowerCase();
  return SCHOLAR_ALIASES[key]||null;
}
var scholarAc={items:[],active:-1,req:0,timer:null,docBound:false};





function loadDisplayNames(emails, cb){
  if(!emails||!emails.length){ if(cb) cb(); return; }
  var unique=emails.filter(function(e,i,a){ return e&&a.indexOf(e)===i; });
  fetch(SB_URL+'/rest/v1/profiles?select=email,display_name&email=in.('+unique.map(encodeURIComponent).join(',')+')',{
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token}
  }).then(function(r){return r.json();}).then(function(rows){
    if(Array.isArray(rows)) rows.forEach(function(r){
      if(r.email&&r.display_name) DISPLAY_CACHE[r.email]=r.display_name;
    });
    if(cb) cb();
  }).catch(function(){ if(cb) cb(); });
}






var DISPLAY_CACHE={};

function emailToDisplayName(email){
  if(!email) return '';
  if(DISPLAY_CACHE[email]) return DISPLAY_CACHE[email];
  var local=email.split('@')[0]||'';
  var parts=local.split('.');
  var last=parts[parts.length-1]||'';
  var name='Ms. '+last.charAt(0).toUpperCase()+last.slice(1);
  return name;
}


var STATE={step:0,entry:null,logs:[],myDbLogs:[],myDbLoaded:false,adminTab:'overview',clsFilter:'all',liveRows:[],liveLoaded:false,liveError:false,currentScreen:'S-login',firstAidRows:[],firstAidLoaded:false,firstAidError:false,faFilterSpecials:'all',faFilterHome:'all'};
var STU_PREV_SCREEN='S-detail';
var DET_PREV_SCREEN='S-classes';
function setStuPrevScreen(v){ STU_PREV_SCREEN=v||'S-detail'; }
function getStuPrevScreen(){ return STU_PREV_SCREEN||'S-detail'; }
function setDetPrevScreen(v){ DET_PREV_SCREEN=v||'S-classes'; }
function todayStr(){return new Date().toISOString().split('T')[0];}
function nowStr(){var d=new Date();return d.toTimeString().slice(0,5);}
function freshEntry(){return{studentName:'',homeroom:'',specials:'',behaviors:[],date:todayStr(),time:nowStr(),colorChart:false,homeContact:false,motivation:'',contactMethod:'',notes:''};}
function el(id){return document.getElementById(id);}
function pb(pct,col){return '<div class="pbar"><div style="--pw:'+Math.min(pct,100)+'%;background:'+col+'" class="pfill"></div></div>';}
var INSTALL_PROMPT_EVENT=null;
function initTheme(){
  var saved=localStorage.getItem('cp-theme');
  var theme=saved||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  document.documentElement.setAttribute('data-theme',theme);
  var btn=document.getElementById('btn-theme-toggle');
  if(btn) btn.textContent=theme==='dark'?'[ Light ]':'[ Dark ]';
}
function toggleTheme(){
  var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem('cp-theme',next);
  var btn=document.getElementById('btn-theme-toggle');
  if(btn) btn.textContent=next==='dark'?'[ Light ]':'[ Dark ]';
}

function initPwa(){
  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){
      navigator.serviceWorker.register('/sw.js').catch(function(){});
    });
  }
  var btn=el('btn-install-app');
  if(!btn) return;
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();
    INSTALL_PROMPT_EVENT=e;
    btn.style.display='inline-flex';
  });
  window.addEventListener('appinstalled',function(){
    INSTALL_PROMPT_EVENT=null;
    btn.style.display='none';
  });
  btn.addEventListener('click',function(){
    if(!INSTALL_PROMPT_EVENT) return;
    INSTALL_PROMPT_EVENT.prompt();
    INSTALL_PROMPT_EVENT.userChoice.then(function(){
      INSTALL_PROMPT_EVENT=null;
      btn.style.display='none';
    });
  });
}

function startEegAnimation(){
  var svg=document.getElementById('eeg-loading-svg');
  if(!svg) return null;
  var W=280,H=52,mid=H/2;
  var offset=0;
  var running=true;
  function makePts(off){
    var pts=[];
    for(var x=0;x<W;x++){
      var sx=(x+off)%W;
      var y=mid;
      var d=sx-140;
      if(Math.abs(d)<30){
        if(d<0) y=mid-18*Math.exp(-Math.pow(sx-133,2)/8);
        else if(d<8) y=mid+11*Math.exp(-Math.pow(sx-145,2)/6);
        else y=mid-5*Math.exp(-Math.pow(sx-151,2)/10);
      }
      pts.push([x,y]);
    }
    return pts;
  }
  function frame(){
    if(!running) return;
    offset=(offset+1.5)%W;
    var pts=makePts(offset);
    var pathD='M'+pts.map(function(p){return p[0]+','+p[1];}).join('L');
    var peakPt=pts[Math.round(W*0.4)]||[0,mid];
    var troughPt=pts[Math.round(W*0.53)]||[0,mid];
    svg.innerHTML=
      '<defs><linearGradient id="efade" x1="0" x2="1" y1="0" y2="0">'+
        '<stop offset="0%" stop-color="var(--bg)"/>'+
        '<stop offset="12%" stop-color="transparent"/>'+
        '<stop offset="88%" stop-color="transparent"/>'+
        '<stop offset="100%" stop-color="var(--bg)"/>'+
      '</linearGradient></defs>'+
      '<line x1="0" y1="'+mid+'" x2="'+W+'" y2="'+mid+'" stroke="var(--navy)" stroke-width="1" opacity="0.12"/>'+
      '<path d="'+pathD+'" fill="none" stroke="var(--navy)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
      '<circle cx="'+peakPt[0]+'" cy="'+peakPt[1]+'" r="3.5" fill="var(--navy)"/>'+
      '<circle cx="'+troughPt[0]+'" cy="'+troughPt[1]+'" r="3.5" fill="var(--gold)"/>'+
      '<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="url(#efade)"/>';
    requestAnimationFrame(frame);
  }
  frame();
  return function(){ running=false; };
}
function alrt(t){return '<div class="alert"><span style="flex-shrink:0">!</span><span>'+t+'</span></div>';}
function kpiH(lb,v,sub,flag){return '<div class="kpi'+(flag?' flag':'')+'"><div class="lbl">'+lb+'</div><div class="val" style="color:'+(flag?'var(--red)':'var(--text)')+'">'+v+'</div><div class="sub">'+sub+'</div></div>';}

// ── FRESHNESS STRIP ──
function updateFreshnessPill(){
  var pill=document.querySelector('.fresh-pill');
  if(pill&&STATE.liveRows&&Array.isArray(STATE.liveRows)){
    pill.textContent=STATE.liveRows.length+' rows';
  }
}
function initFreshness(){
  var now=new Date();
  var ts=now.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · '+now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  var f=el('fresh-ts');
  if(f) f.textContent='Synced '+ts+' · Supabase · loading…';
  fetchLiveData(function(err, rows){
    var f=el('fresh-ts'), p=el('fresh-pill');
    var ts2=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    if(!err && rows){
      if(f) f.textContent='Synced '+ts2+' · Supabase · live';
      updateFreshnessPill();
    } else {
      if(f) f.textContent='Session expired · signing out…';
      var fd=el('fresh-dot');if(fd) fd.style.background='var(--red)';
    }
  });
}


// ── LOGIN ──
function initLogin(){
  var btnLogin = el('btn-login');
  var fEmail = el('l-email');
  var fPass = el('l-pass');
  if(!btnLogin) return;

  if(loadSession()){
    showScreen('S-loading');
    var stopEeg=startEegAnimation();
    updateUserDisplay();
    // Always refresh token on restore — localStorage persists beyond 1hr token expiry
    refreshSession(function(ok){
      fetchRole(SESSION.userId, function(err, role){
        if(stopEeg) stopEeg();
        if(err || !role){ showScreen('S-login'); return; }
        SESSION.role = role;
        if(role === 'admin'){ goAdmin(); } else { goTeacher(); }
      });
    });
    return;
  }
  showScreen('S-login');

  btnLogin.addEventListener('click', function(){
    var email = fEmail.value.trim();
    var pass = fPass.value;
    var errEl = el('l-err');
    if(!email || !pass){ errEl.textContent = 'Email and password required'; return; }
    btnLogin.textContent = '[ Authenticating… ]';
    btnLogin.disabled = true;
    errEl.textContent = '';
    sbSignIn(email, pass).then(function(r){ return r.json(); }).then(function(data){
      if(data.access_token){
        saveSession(data.access_token, email, data.user && data.user.id, data.refresh_token);
        SESSION.userId = data.user && data.user.id;
        updateUserDisplay();
        fetchRole(SESSION.userId, function(err, role){
          SESSION.role = role;
          if(role === 'admin'){ goAdmin(); } else { goTeacher(); }
        });
      } else {
        var msg=data.error_description||data.msg||data.message||'';
        var friendly=msg.toLowerCase().indexOf('invalid login')>=0||msg.toLowerCase().indexOf('invalid credentials')>=0?'Wrong password — or check invite email to set one':msg.toLowerCase().indexOf('email not confirmed')>=0?'Check your invite email to confirm your account':msg.toLowerCase().indexOf('user not found')>=0?'No account found — check your invite email':msg||'Sign-in failed';
        errEl.textContent=friendly;
        btnLogin.textContent='Sign in';
        btnLogin.disabled=false;
      }
    }).catch(function(){
      errEl.textContent = 'Network error — check connection';
      btnLogin.textContent = 'Sign in';
      btnLogin.disabled = false;
    });
  });

  fPass.addEventListener('keydown', function(e){ if(e.key==='Enter') btnLogin.click(); });
}


// ── SIGN OUT ──
function signOut(){
  SESSION.token = null; SESSION.email = null; SESSION.userId = null; SESSION.role = null; SESSION.refresh = null;
  try{localStorage.removeItem('sb_token');localStorage.removeItem('sb_email');localStorage.removeItem('sb_uid');localStorage.removeItem('sb_refresh');}catch(e){}
  STATE.liveRows = []; STATE.liveLoaded = false; STATE.liveError = false;
  STATE.logs = []; STATE.entry = freshEntry(); STATE.step = 0;
  showScreen('S-login');
  // re-attach login listeners on the now-visible form
  var btnLogin = el('btn-login');
  var fEmail = el('l-email');
  var fPass = el('l-pass');
  var errEl = el('l-err');
  if(errEl) errEl.textContent = '';
  if(fEmail) fEmail.value = '';
  if(fPass) fPass.value = '';
  if(btnLogin){
    var fresh = btnLogin.cloneNode(true);
    btnLogin.parentNode.replaceChild(fresh, btnLogin);
    fresh.textContent = 'Sign in';
    fresh.disabled = false;
    fresh.addEventListener('click', function(){
      var email = fEmail.value.trim();
      var pass = fPass.value;
      if(!email || !pass){ errEl.textContent = 'Email and password required'; return; }
      fresh.textContent = '[ Authenticating… ]'; fresh.disabled = true; errEl.textContent = '';
      sbSignIn(email, pass).then(function(r){return r.json();}).then(function(data){
        if(data.access_token){
          saveSession(data.access_token, email, data.user && data.user.id, data.refresh_token);
          updateUserDisplay();
          showScreen('S-role');
        } else {
          var msg=data.error_description||data.msg||data.message||'';
          errEl.textContent=msg.toLowerCase().indexOf('invalid login')>=0||msg.toLowerCase().indexOf('invalid credentials')>=0?'Wrong password — or check invite email to set one':msg.toLowerCase().indexOf('email not confirmed')>=0?'Check your invite email first':msg||'Sign-in failed';
          fresh.textContent='Sign in'; fresh.disabled=false;
        }
      }).catch(function(){
        errEl.textContent = 'Network error — check connection';
        fresh.textContent = 'Sign in'; fresh.disabled = false;
      });
    });
    fPass.addEventListener('keydown', function(e){ if(e.key==='Enter') fresh.click(); });
  }
}

function updateNavActive(screenId){
  var navMap={
    'S-admin':'AN-dash',
    'S-classes':'AN-classes',
    'S-detail':'AN-classes',
    'S-student':'AN-classes',
    'S-teacher':'TN-log',
    'S-log':'TN-log'
  };
  document.querySelectorAll('.ni').forEach(function(b){
    b.classList.remove('on');
  });
  var adminNav=document.getElementById('admin-bnav');
  var teacherNav=document.getElementById('teacher-bnav');
  var isAdminScreen=screenId==='S-admin'||screenId==='S-classes'||screenId==='S-detail'||screenId==='S-student';
  var isTeacherScreen=screenId==='S-teacher'||screenId==='S-log';
  if(adminNav) adminNav.style.display=isAdminScreen?'flex':'none';
  if(teacherNav) teacherNav.style.display=isTeacherScreen?'flex':'none';
  var activeId=navMap[screenId];
  if(activeId){
    var btn=document.getElementById(activeId);
    if(btn) btn.classList.add('on');
  }
}
function showScreen(id,back){
  STATE.currentScreen=id;
  document.querySelectorAll('.screen').forEach(function(s){
    if(s.id===id){s.classList.remove('hidden','back');}
    else if(!s.classList.contains('hidden')){if(back)s.classList.add('back');s.classList.add('hidden');}
  });
  updateNavActive(id);
}
function goTeacher(){STATE.entry=freshEntry();STATE.step=0;STATE.myDbLoaded=false;STATE.myDbLogs=[];updateUserDisplay();showScreen('S-teacher');showPane('log');renderStep();updateTeacherNav();}

function updateTeacherNav(){
  var sw = el('btn-t-switch');
  if(sw) sw.style.display = SESSION.role === 'admin' ? '' : 'none';
}

function goAdmin(){updateUserDisplay();showScreen('S-admin');STATE.adminTab='overview';document.querySelectorAll('#admin-tabs .tab').forEach(function(b){b.classList.toggle('on',b.dataset.tab==='overview');});renderAdmin();}
function showPane(pane){
  el('T-log').style.display=pane==='log'?'flex':'none';
  el('T-hist').style.display=pane==='hist'?'flex':'none';
  el('TN-log').className='ni'+(pane==='log'?' on':'');
  el('TN-hist').className='ni'+(pane==='hist'?' on':'');
  if(pane==='hist')renderHistory();
}

// ── STEP FORM ──
var SLBL=['Step 1 of 4 · Scholar & class','Step 2 of 4 · Behavior type','Step 3 of 4 · Timing','Step 4 of 4 · Response & notes'];
function renderStep(){
  el('step-lbl').textContent=SLBL[STATE.step];
  el('step-dots').innerHTML=SLBL.map(function(_,i){return '<div class="dot '+(i<STATE.step?'done':i===STATE.step?'active':'')+'"></div>';}).join('');
  var body=el('step-body');
  if(STATE.step===0)body.innerHTML=bS1();
  else if(STATE.step===1)body.innerHTML=bS2();
  else if(STATE.step===2)body.innerHTML=bS3();
  else body.innerHTML=bS4();
  attachSL();
}
function bS1(){
  var opts=HOMEROOMS.map(function(h){return '<option value="'+h+'"'+(STATE.entry.homeroom===h?' selected':'')+'>'+h+'</option>';}).join('');
  var chips=getSubjects().map(function(s){return '<button type="button" class="chip'+(STATE.entry.specials===s?' on':'')+'" data-sp="'+s+'">'+s+'</button>';}).join('');
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">Who is this about?</h3>'+
    '<div class="fg scholar-ac-wrap"><label class="fl">Scholar name <span class="req">*</span></label><input type="text" id="f-name" placeholder="First Last" value="'+escAttr(STATE.entry.studentName)+'" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="f-name-suggestions"><div id="f-name-suggestions" class="scholar-ac" role="listbox"></div></div>'+
    '<div class="fg"><label class="fl">Homeroom class <span class="req">*</span></label><select id="f-hr"><option value="">Select homeroom...</option>'+opts+'</select></div>'+
    '<div class="fg"><label class="fl">'+(SESSION.role==="homeroom"||SESSION.role==="ia"?"Subject / context":"Your class")+' <span class="req">*</span></label><div class="chips" id="sp-chips">'+chips+'</div></div>'+
    '<button type="button" class="btn-p" id="s1-next">Next</button></div>';
}
function bS2(){
  var chips=BEHAVIORS.map(function(b){return '<button type="button" class="chip'+(STATE.entry.behaviors.indexOf(b)>=0?' on':'')+'" data-beh="'+b+'">'+b+'</button>';}).join('');
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">What happened?</h3>'+
    '<div class="fg"><label class="fl">Behavior type(s) <span class="req">*</span></label><div class="chips">'+chips+'</div></div>'+
    '<div class="brow"><button type="button" class="btn-s" id="s2-back">Back</button><button type="button" class="btn-p" id="s2-next">Next</button></div></div>';
}
function bS3(){
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">When did this happen?</h3>'+
    '<div class="fg"><label class="fl">Date</label><input type="date" id="f-date" value="'+STATE.entry.date+'"></div>'+
    '<div class="fg"><label class="fl">Incident time <span style="font-size:11px;color:var(--text3)">(best estimate ok)</span></label><input type="time" id="f-time" value="'+STATE.entry.time+'"></div>'+
    '<div class="brow"><button type="button" class="btn-s" id="s3-back">Back</button><button type="button" class="btn-p" id="s3-next">Next</button></div></div>';
}
function bS4(){
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">Response taken</h3>'+
    '<div class="card" style="margin-bottom:14px">'+
    '<div class="tog-row"><div><div class="tog-lbl">Color chart used</div><div class="tog-sub">Behavior chart shown to student</div></div>'+
    '<label class="tog"><input type="checkbox" id="f-chart"'+(STATE.entry.colorChart?' checked':'')+'>'+
    '<div class="tog-track"></div><div class="tog-thumb"></div></label></div>'+
    '<div class="tog-row"><div><div class="tog-lbl">Home contacted</div><div class="tog-sub">Parent or guardian notified</div></div>'+
    '<label class="tog"><input type="checkbox" id="f-home"'+(STATE.entry.homeContact?' checked':'')+'>'+
    '<div class="tog-track"></div><div class="tog-thumb"></div></label></div></div>'+
    '<div class="fg"><label class="fl">Possible Motivation <span style="font-size:11px;color:var(--text3)">(optional)</span></label><div class="chips">'+MOTIVATIONS.map(function(m){return '<button type="button" class="chip'+(STATE.entry.motivation===m?' on':'')+'" data-mot="'+m+'">'+m+'</button>';}).join('')+'</div></div>'+
    (STATE.entry.homeContact?'<div class="fg"><label class="fl">Parent Contact Method <span style="font-size:11px;color:var(--text3)">(optional)</span></label><div class="chips">'+CONTACT_METHODS.map(function(c){return '<button type="button" class="chip'+(STATE.entry.contactMethod===c?' on':'')+'" data-contact="'+c+'">'+c+'</button>';}).join('')+'</div></div>':'')+
    '<div class="fg"><label class="fl">Additional notes <span style="font-size:11px;color:var(--text3)">(optional)</span></label>'+
    '<textarea id="f-notes" placeholder="A — Antecedent: what triggered the behavior?\nB — Behavior: what did the scholar do?\nC — Consequence: what was the immediate result?">'+STATE.entry.notes+'</textarea></div>'+
    '<div class="brow"><button type="button" class="btn-s" id="s4-back">Back</button><button type="button" class="btn-ok" id="s4-sub">Submit log</button></div></div>';
}

function fetchScholarSuggestions(query, homeroom, cb){
  var q='select=student_name,homeroom,grade&active=eq.true&school_year=eq.2025-26&student_name=ilike.*'+encodeURIComponent(query)+'*&order=homeroom.asc,student_name.asc&limit=50';
  authedFetch('/rest/v1/students?'+q).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(rows){
    rows=Array.isArray(rows)?rows:[];
    rows.sort(function(a,b){
      var ah=homeroom&&a.homeroom===homeroom?0:1;
      var bh=homeroom&&b.homeroom===homeroom?0:1;
      if(ah!==bh) return ah-bh;
      return String(a.student_name||'').localeCompare(String(b.student_name||''));
    });
    cb(rows.slice(0,6));
  }).catch(function(err){
    console.warn('Scholar autocomplete failed',err);
    cb([]);
  });
}
function renderScholarSuggestions(items, activeIdx){
  var box=el('f-name-suggestions');
  var input=el('f-name');
  if(!box||!input) return;
  scholarAc.items=items||[];
  scholarAc.active=typeof activeIdx==='number'?activeIdx:-1;
  if(!scholarAc.items.length){
    box.innerHTML='';box.classList.remove('show');input.setAttribute('aria-expanded','false');return;
  }
  box.innerHTML=scholarAc.items.map(function(r,i){
    return '<button type="button" class="scholar-ac-row'+(i===scholarAc.active?' active':'')+'" role="option" aria-selected="'+(i===scholarAc.active?'true':'false')+'" data-scholar-idx="'+i+'">'+
      '<span class="scholar-ac-name">'+(r.alias?'<span class="scholar-ac-arrow">&gt;</span>':'')+escHtml(r.student_name||'')+'</span>'+
      '<span class="scholar-ac-room">'+escHtml(r.homeroom||'')+'</span>'+
    '</button>';
  }).join('');
  box.classList.add('show');
  input.setAttribute('aria-expanded','true');
}
function selectScholarSuggestion(row){
  if(!row) return;
  var name=el('f-name');
  var hr=el('f-hr');
  STATE.entry.studentName=row.student_name||'';
  STATE.entry.homeroom=row.homeroom||'';
  if(name) name.value=STATE.entry.studentName;
  if(hr) hr.value=STATE.entry.homeroom;
  renderScholarSuggestions([],-1);
}
function updateScholarAutocomplete(){
  var input=el('f-name');
  if(!input) return;
  var typed=input.value||'';
  STATE.entry.studentName=typed;
  var alias=resolveAlias(typed);
  if(alias){
    selectScholarSuggestion(alias);
    renderScholarSuggestions([Object.assign({alias:true},alias)],0);
    return;
  }
  if(typed.trim().length<2){renderScholarSuggestions([],-1);return;}
  var req=++scholarAc.req;
  var homeroom=(el('f-hr')&&el('f-hr').value)||STATE.entry.homeroom||'';
  fetchScholarSuggestions(typed.trim(), homeroom, function(items){
    if(req!==scholarAc.req) return;
    renderScholarSuggestions(items,-1);
  });
}
function wireScholarAutocomplete(){
  var input=el('f-name');
  var box=el('f-name-suggestions');
  var hr=el('f-hr');
  if(!input||!box) return;
  input.addEventListener('input',function(){
    clearTimeout(scholarAc.timer);
    scholarAc.timer=setTimeout(updateScholarAutocomplete,120);
  });
  input.addEventListener('keydown',function(e){
    if(!scholarAc.items.length) return;
    if(e.key==='ArrowDown'){
      e.preventDefault();
      renderScholarSuggestions(scholarAc.items, Math.min(scholarAc.active+1, scholarAc.items.length-1));
    }else if(e.key==='ArrowUp'){
      e.preventDefault();
      renderScholarSuggestions(scholarAc.items, Math.max(scholarAc.active-1, 0));
    }else if(e.key==='Enter'&&scholarAc.active>=0){
      e.preventDefault();
      selectScholarSuggestion(scholarAc.items[scholarAc.active]);
    }else if(e.key==='Escape'){
      e.preventDefault();
      renderScholarSuggestions([],-1);
    }
  });
  box.addEventListener('mousedown',function(e){e.preventDefault();});
  box.addEventListener('click',function(e){
    var row=e.target.closest('[data-scholar-idx]');
    if(row) selectScholarSuggestion(scholarAc.items[parseInt(row.dataset.scholarIdx,10)]);
  });
  if(hr) hr.addEventListener('change',function(){
    STATE.entry.homeroom=hr.value;
    if(input.value.trim().length>=2) updateScholarAutocomplete();
  });
  if(!scholarAc.docBound){
    document.addEventListener('click',function(e){
      var wrap=e.target.closest('.scholar-ac-wrap');
      if(!wrap) renderScholarSuggestions([],-1);
    });
    scholarAc.docBound=true;
  }
}
function attachSL(){
  var fn=el('f-name');if(fn)fn.addEventListener('input',function(){STATE.entry.studentName=fn.value;});
  var fhr=el('f-hr');if(fhr)fhr.addEventListener('change',function(){STATE.entry.homeroom=fhr.value;});
  wireScholarAutocomplete();
  document.querySelectorAll('[data-sp]').forEach(function(btn){btn.addEventListener('click',function(){STATE.entry.specials=btn.dataset.sp;document.querySelectorAll('[data-sp]').forEach(function(b){b.classList.toggle('on',b.dataset.sp===STATE.entry.specials);});});});
  var s1n=el('s1-next');
  if(s1n)s1n.addEventListener('click',function(){if(!STATE.entry.studentName.trim()||!STATE.entry.homeroom||!STATE.entry.specials){alert('Please fill in scholar name, homeroom, and subject.');return;}STATE.step=1;renderStep();});
  document.querySelectorAll('[data-beh]').forEach(function(btn){btn.addEventListener('click',function(){var b=btn.dataset.beh,idx=STATE.entry.behaviors.indexOf(b);if(idx>=0)STATE.entry.behaviors.splice(idx,1);else STATE.entry.behaviors.push(b);document.querySelectorAll('[data-beh]').forEach(function(c){c.classList.toggle('on',STATE.entry.behaviors.indexOf(c.dataset.beh)>=0);});});});
  var s2b=el('s2-back');if(s2b)s2b.addEventListener('click',function(){STATE.step=0;renderStep();});
  var s2n=el('s2-next');if(s2n)s2n.addEventListener('click',function(){if(!STATE.entry.behaviors.length){alert('Please select at least one behavior type.');return;}STATE.step=2;renderStep();});
  var fd=el('f-date');if(fd)fd.addEventListener('change',function(){STATE.entry.date=fd.value;});
  var ft=el('f-time');if(ft)ft.addEventListener('change',function(){STATE.entry.time=ft.value;});
  var s3b=el('s3-back');if(s3b)s3b.addEventListener('click',function(){STATE.step=1;renderStep();});
  var s3n=el('s3-next');if(s3n)s3n.addEventListener('click',function(){STATE.step=3;renderStep();});
  var fc=el('f-chart');if(fc)fc.addEventListener('change',function(){STATE.entry.colorChart=fc.checked;});
  var fh=el('f-home');if(fh)fh.addEventListener('change',function(){STATE.entry.homeContact=fh.checked;renderStep();});
  document.querySelectorAll('[data-mot]').forEach(function(btn){btn.addEventListener('click',function(){STATE.entry.motivation=STATE.entry.motivation===btn.dataset.mot?'':btn.dataset.mot;renderStep();});});
  document.querySelectorAll('[data-contact]').forEach(function(btn){btn.addEventListener('click',function(){STATE.entry.contactMethod=STATE.entry.contactMethod===btn.dataset.contact?'':btn.dataset.contact;renderStep();});});
  var fn2=el('f-notes');if(fn2)fn2.addEventListener('input',function(){STATE.entry.notes=fn2.value;});
  var s4b=el('s4-back');if(s4b)s4b.addEventListener('click',function(){STATE.step=3;renderStep();});
  var sub=el('s4-sub');
  if(sub)sub.addEventListener('click',function(){
    var e=STATE.entry;
    var extra=[];
    if(e.motivation) extra.push('Motivation: '+e.motivation);
    if(e.homeContact&&e.contactMethod) extra.push('Contact method: '+e.contactMethod);
    var fullNotes=((e.notes||'').trim()+(extra.length?('\n'+extra.join('\n')):'')).trim();
    var row={student:e.studentName,homeroom:e.homeroom,specials:e.specials,subject:e.specials,teacher_role:SESSION.role||'specials',behaviors:e.behaviors.slice(),incident_date:e.date||null,incident_time:e.time||null,color_chart:e.colorChart,home_contact:e.homeContact,notes:fullNotes||null,submitted_by:SESSION.email||'specials-team'};
    var log=Object.assign({},row,{studentName:e.studentName,colorChart:e.colorChart,homeContact:e.homeContact,date:e.date,time:e.time,id:Date.now()});
    STATE.logs.unshift(log);
    el('sheet-detail').textContent=e.studentName+' · '+e.specials+' · '+(e.behaviors.length?e.behaviors.map(displayBehavior).join(', '):'—');
    el('T-sheet').classList.add('show');el('T-overlay').classList.add('show');
    authedInsert(row).catch(function(err){console.warn('Supabase insert failed',err);});
  });
}
function closeSheet(){el('T-sheet').classList.remove('show');el('T-overlay').classList.remove('show');STATE.entry=freshEntry();STATE.step=0;renderStep();}


// ── USER DISPLAY ──
function updateUserDisplay(){
  var email = SESSION.email || '';
  var short = email ? email.split('@')[0] : '';
  var sub = el('hist-sub');
  if(sub && short) sub.textContent = short + ' · this session';
  var asub = el('admin-sub');
  if(asub && short) asub.textContent = short + ' · live data';

}

// ── FETCH MY LOGS FROM SUPABASE ──
function fetchMyLogs(cb){
  if(!SESSION.token){ if(cb) cb(new Error('not authenticated'),[]); return; }
  var email = SESSION.email||'';
  var q = 'select=*&submitted_by=eq.'+encodeURIComponent(email)+'&order=created_at.desc&limit=200';
  authedSelect(q).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(rows){
    STATE.myDbLogs = rows;
    STATE.myDbLoaded = true;
    if(cb) cb(null, rows);
  }).catch(function(err){
    STATE.myDbLoaded = true;
    console.warn('fetchMyLogs error', err);
    if(cb) cb(err, []);
  });
}

// ── MY LOGS: improved history with session summary + date groups ──
function renderHistory(){
  var body=el('hist-body');
  if(!STATE.myDbLoaded){
    body.innerHTML='<div style="text-align:center;padding:32px 0;color:var(--text3);font-size:11px;letter-spacing:.06em">Loading your logs…</div>';
    fetchMyLogs(function(){ renderHistory(); });
    return;
  }
  var sessionKeys={};
  STATE.logs.forEach(function(l){ sessionKeys[(l.studentName||'')+'|'+(l.date||'')+'|'+(l.time||'')]=true; });
  var dbDisplay=STATE.myDbLogs.map(function(r){
    return {dbId:r.id,studentName:r.student,homeroom:r.homeroom,specials:r.specials,
      behaviors:r.behaviors||[],date:r.incident_date||r.created_at.slice(0,10),
      time:r.incident_time||r.created_at.slice(11,16),
      colorChart:r.color_chart,homeContact:r.home_contact,notes:r.notes||'',fromDb:true};
  });
  var filteredDb=dbDisplay.filter(function(r){
    return !sessionKeys[(r.studentName||'')+'|'+(r.date||'')+'|'+(r.time||'')];
  });
  var allLogs=STATE.logs.concat(filteredDb);
  if(!allLogs.length){
    body.innerHTML='<div class="empty"><div class="empty-t">No logs yet</div><div class="empty-s">Your incidents will appear here as you log them.</div></div>';
    return;
  }
  var chartCount=allLogs.filter(function(l){return l.colorChart||l.color_chart;}).length;
  var homeCount=allLogs.filter(function(l){return l.homeContact||l.home_contact;}).length;
  var chartPct=allLogs.length?Math.round(chartCount/allLogs.length*100):0;
  var homePct=allLogs.length?Math.round(homeCount/allLogs.length*100):0;

  var stuMap={};
  allLogs.forEach(function(l){var n=l.studentName||'Unknown';stuMap[n]=(stuMap[n]||0)+1;});
  var topStus=Object.keys(stuMap).map(function(k){return{name:k,n:stuMap[k]};}).sort(function(a,b){return b.n-a.n;}).slice(0,5);
  var maxStu=topStus.length?topStus[0].n:1;

  var behMap={};
  allLogs.forEach(function(l){(l.behaviors||[]).forEach(function(b){var m=displayBehavior(b);behMap[m]=(behMap[m]||0)+1;});});
  var topBehs=Object.keys(behMap).map(function(k){return{name:k,n:behMap[k]};}).sort(function(a,b){return b.n-a.n;}).slice(0,5);
  var maxBeh=topBehs.length?topBehs[0].n:1;

  var weekMap={};
  allLogs.forEach(function(l){
    if(!l.date) return;
    var d=new Date(l.date+'T12:00:00');
    var day=d.getDay();
    var mon=new Date(d); mon.setDate(d.getDate()-(day===0?6:day-1));
    var wk=mon.toISOString().slice(0,10);
    weekMap[wk]=(weekMap[wk]||0)+1;
  });
  var wkKeys=Object.keys(weekMap).sort().slice(-8);
  var wkVals=wkKeys.map(function(k){return weekMap[k];});
  var wkLabels=wkKeys.map(function(k){
    var d=new Date(k+'T12:00:00');
    return isNaN(d)?k:(d.toLocaleString('en-US',{month:'short'})+' '+d.getDate());
  });
  var monthMap={};
  allLogs.forEach(function(l){
    if(!l.date) return;
    var mk=l.date.slice(0,7);
    monthMap[mk]=(monthMap[mk]||0)+1;
  });
  var monthKeys=Object.keys(monthMap).sort().slice(-4);
  var monthHtml=monthKeys.length?'<div class="sec">Monthly changes</div><div class="card" style="margin-bottom:10px">'+
    monthKeys.map(function(mk,idx){
      var v=monthMap[mk];
      var prev=idx?monthMap[monthKeys[idx-1]]:null;
      var delta=(prev&&prev>0)?Math.round(((v-prev)/prev)*100):null;
      var dLab=(function(){
        var d=new Date(mk+'-01T12:00:00');
        return isNaN(d)?mk:d.toLocaleString('en-US',{month:'short',year:'numeric'});
      })();
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:'+(idx<monthKeys.length-1?'0.5px solid var(--border)':'0')+'">'+
        '<div style="font-size:12px">'+dLab+'</div>'+
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;font-size:12px">'+v+'</span>'+
          '<span class="tag '+(delta===null?'gray':delta>0?'red':delta<0?'green':'gray')+'" style="font-size:9px">'+(delta===null?'—':(delta>0?'+':'')+delta+'%')+'</span>'+
        '</div></div>';
    }).join('')+'</div>':'';

  function barRow(name,n,max,color){
    var pct=Math.round((n/max)*100);
    return '<div style="margin-bottom:7px">'+
      '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">'+
      '<span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">'+escHtml(name)+'</span>'+
      '<span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;color:'+color+'">'+n+'</span></div>'+
      '<div style="height:3px;background:#eef1f8;border-radius:2px">'+
      '<div style="height:3px;width:'+pct+'%;background:'+color+';border-radius:2px"></div>'+
      '</div></div>';
  }

  var summ=
    '<div class="sess-strip" style="margin-bottom:12px">'+
      '<div class="ss-item"><div class="ss-val" style="color:var(--text)">'+allLogs.length+'</div><div class="ss-lbl">Total logged</div></div>'+
      '<div class="ss-item"><div class="ss-val" style="color:var(--navy)">'+chartPct+'%</div><div class="ss-lbl">Chart used</div></div>'+
      '<div class="ss-item"><div class="ss-val" style="color:var(--yellow)">'+homePct+'%</div><div class="ss-lbl">Home contact</div></div>'+
    '</div>'+
    (wkVals.length>1?
      '<div class="sec">Weekly trend</div>'+
      '<div class="card" style="margin-bottom:10px;padding:10px 12px">'+
        '<canvas id="hist-wk-line" height="80" style="width:100%;display:block"></canvas>'+
      '</div>'
    :'')+
    '<div class="sec">Weekly pattern heatmap</div><div class="card" id="hist-heat-card" style="overflow-x:auto"></div>'+
    monthHtml+
    (topStus.length?
      '<div class="sec">Your scholars</div>'+
      '<div class="card" style="margin-bottom:10px">'+
        topStus.map(function(s){return barRow(s.name,s.n,maxStu,'var(--navy)');}).join('')+
      '</div>'
    :'')+
    (topBehs.length?
      '<div class="sec">Behavior types</div>'+
      '<div class="card" style="margin-bottom:10px">'+
        topBehs.map(function(b){return barRow(b.name,b.n,maxBeh,'var(--yellow)');}).join('')+
      '</div>'
    :'');
  var grouped={};
  allLogs.forEach(function(l,idx){
    var k=l.date||'Unknown date';
    if(!grouped[k]) grouped[k]=[];
    grouped[k].push({log:l,idx:idx});
  });
  var dates=Object.keys(grouped).sort(function(a,b){return b>a?1:-1;});
  var logHtml=dates.map(function(d){
    var pretty=d==='Unknown date'?d:(function(){try{var dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}catch(e){return d;}})();
    return '<div class="date-grp-hdr">'+pretty+'</div>'+
      grouped[d].map(function(item){
        var l=item.log,idx=item.idx;
        var isDb=l.fromDb;
        var uid=isDb?('db-'+l.dbId):('s-'+l.id);
        var behs=(l.behaviors||[]);
        var hasNotes=l.notes&&l.notes.trim().length>0;
        return '<div class="log-item" data-uid="'+uid+'" style="'+(isDb?'border-color:rgba(39,26,112,.1)':'')+'">'+
          '<div class="log-hdr" data-toggle="'+uid+'">'+
            '<div class="log-name">'+stuNameLink(l.studentName)+(l.submittedBy&&l.submittedBy!==SESSION.email?'<span style="font-size:9px;color:var(--text3);font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;margin-left:4px">'+emailToDisplayName(l.submittedBy)+'</span>':'')+
              '<span class="log-chevron" id="chev-'+uid+'">▾</span>'+
            '</div>'+
            '<div class="log-time">'+(isDb?'<span style="color:var(--text3);margin-right:4px;font-size:9px">db</span>':'')+l.time+'</div>'+
          '</div>'+
          '<div class="log-tags">'+
            '<span class="tag blue">'+l.specials+'</span>'+
            '<span class="tag gray">'+l.homeroom+'</span>'+
            behs.map(function(b){return '<span class="tag amber">'+displayBehavior(b)+'</span>';}).join('')+
            ((l.colorChart||l.color_chart)?'<span class="tag green">Chart</span>':'')+
            ((l.homeContact||l.home_contact)?'<span class="tag red">Home</span>':'')+
          '</div>'+
          '<div class="log-detail" id="det-'+uid+'">'+
            '<div class="log-detail-inner">'+
              (hasNotes?'<div class="log-notes">'+escHtml(l.notes)+'</div>':
                '<div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;letter-spacing:.04em">— no notes —</div>')+
              '<div class="log-actions">'+
                '<button class="log-act-btn edit" data-edit="'+uid+'">[ Edit ]</button>'+
                (isDb&&SESSION.role==='admin'?'<button class="log-act-btn del" data-del="'+uid+'" data-dbid="'+(l.dbId||'')+'">Delete</button>':'')+
              '</div>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');
  }).join('');
  body.innerHTML=summ+logHtml;
  if(wkVals.length>1){
    setTimeout(function(){ drawLine('hist-wk-line', wkLabels, wkVals); },20);
  }
  wireHeatCard('hist-heat-card', allLogs, {prefix:'hist-heat',showFilters:false});
  wireStudentLinks(body,'S-teacher');
  // bind toggles
  body.querySelectorAll('[data-toggle]').forEach(function(hdr){
    hdr.addEventListener('click',function(){
      var uid=hdr.dataset.toggle;
      var det=body.querySelector('#det-'+uid),chev=body.querySelector('#chev-'+uid);
      var isOpen=det.classList.contains('open');
      // close all others
      body.querySelectorAll('.log-detail.open').forEach(function(d){d.classList.remove('open');});
      body.querySelectorAll('.log-chevron.open').forEach(function(c){c.classList.remove('open');});
      if(!isOpen){det.classList.add('open');if(chev)chev.classList.add('open');}
    });
  });
  // bind edit buttons
  body.querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var uid=btn.dataset.edit;
      openEditSheet(uid,allLogs);
    });
  });
  // bind delete buttons
  body.querySelectorAll('[data-del]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      openDelConfirm(btn.dataset.uid||btn.dataset.del, btn.dataset.dbid, allLogs);
    });
  });
}

function escHtml(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s){
  return escHtml(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── FIND LOG BY UID ──
function findLog(uid, allLogs){
  for(var i=0;i<allLogs.length;i++){
    var l=allLogs[i];
    var lid=l.fromDb?('db-'+l.dbId):('s-'+l.id);
    if(lid===uid) return {log:l,idx:i};
  }
  return null;
}

// ── EDIT SHEET ──

function populateEditSheet(l){
  var hrSel=el('es-homeroom');
  hrSel.innerHTML=HOMEROOMS.map(function(h){return '<option value="'+h+'"'+(l.homeroom===h?' selected':'')+'>'+h+'</option>';}).join('');
  var spSel=el('es-specials');
  var spChips=el('es-specials-chips');
  var spLabel=el('es-specials-label');
  var curSubj=l.specials||l.subject||'';
  if(spLabel) spLabel.textContent=SESSION.role==='homeroom'?'Subject / context':'Subject';
  if(spSel) spSel.value=curSubj;
  if(spChips){
    spChips.innerHTML=getSubjects().map(function(s){
      return '<button type="button" class="chip'+(s===curSubj?' on':'')+'" data-es="'+s+'">'+s+'</button>';
    }).join('');
    spChips.querySelectorAll('[data-es]').forEach(function(btn){
      btn.addEventListener('click',function(){
        curSubj=btn.dataset.es;
        if(spSel) spSel.value=curSubj;
        spChips.querySelectorAll('[data-es]').forEach(function(b){
          b.classList.toggle('on',b.dataset.es===curSubj);
        });
      });
    });
  }
  el('es-student').value=l.studentName||'';
  el('es-date').value=l.date||'';
  el('es-time').value=l.time||'';
  el('es-chart').checked=!!(l.colorChart||l.color_chart);
  el('es-home').checked=!!(l.homeContact||l.home_contact);
  el('es-notes').value=l.notes||'';
  var behDiv=el('es-behs');
  var curBehs=l.behaviors||[];
  var allTags=BEHAVIORS.slice();
  curBehs.forEach(function(b){
    if(allTags.indexOf(b)===-1) allTags.push(b);
  });
  var seenLabels={};
  allTags=allTags.filter(function(tag){
    var label=displayBehavior(tag);
    if(seenLabels[label]) return false;
    seenLabels[label]=true;
    return true;
  });
  behDiv.innerHTML=allTags.map(function(b){
    var label=displayBehavior(b);
    return '<button type="button" class="edit-chip'+(curBehs.indexOf(b)>=0||curBehs.indexOf(label)>=0?' on':'')+'" data-eb="'+label+'">'+label+'</button>';
  }).join('');
  behDiv.querySelectorAll('[data-eb]').forEach(function(c){c.addEventListener('click',function(){c.classList.toggle('on');});});
  el('es-status').textContent='';
  el('es-save').disabled=false;
  el('es-save').textContent='Save changes';
}

var EDIT_STATE={uid:null,dbId:null,allLogs:null};
function openEditSheet(uid, allLogs){
  var found=findLog(uid,allLogs);if(!found)return;
  var l=found.log;
  EDIT_STATE={uid:uid,dbId:l.dbId||null,allLogs:allLogs,onAfterEdit:null};
  populateEditSheet(l);
  el('edit-sheet').classList.add('show');
  el('edit-overlay').classList.add('show');
}
function closeEditSheet(){
  el('edit-sheet').classList.remove('show');
  el('edit-overlay').classList.remove('show');
}

// ── DELETE CONFIRM ──
var DEL_STATE={uid:null,dbId:null};
function openDelConfirm(uid, dbId, allLogs){
  var found=findLog(uid,allLogs);
  var name=found?found.log.studentName:'this incident';
  DEL_STATE={uid:uid,dbId:dbId};
  el('del-confirm-sub').textContent='Remove '+name+' from the database. This cannot be undone.';
  el('del-confirm').classList.add('show');
  el('edit-overlay').classList.add('show');
}
function closeDelConfirm(){
  el('del-confirm').classList.remove('show');
  el('edit-overlay').classList.remove('show');
}

// ── LIVE DATA FETCH ──
function fetchLiveData(cb){
  authedSelect('select=*&order=created_at.desc&limit=500')
    .then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    })
    .then(function(rows){
      STATE.liveRows = rows;
      STATE.liveLoaded = true;
      STATE.liveError = false;
      updateFreshnessPill();
      if(cb) cb(null, rows);
    })
    .catch(function(err){
      STATE.liveError = true;
      STATE.liveLoaded = true;
      if(err && err.message && err.message.indexOf('401')>=0) return; // already signed out
      if(cb) cb(err, null);
    });
}

function buildLiveStats(rows){
  var total = rows.length;
  if(!total) return null;
  var chartYes = rows.filter(function(r){return r.color_chart;}).length;
  var homeYes = rows.filter(function(r){return r.home_contact;}).length;
  // behavior counts
  var behCounts = {};
  rows.forEach(function(r){
    var behs = r.behaviors || [];
    behs.forEach(function(b){var mapped=displayBehavior(b);behCounts[mapped]=(behCounts[mapped]||0)+1;});
    if(!behs.length) behCounts['Unspecified']=(behCounts['Unspecified']||0)+1;
  });
  var behaviors = Object.keys(behCounts).sort(function(a,b){return behCounts[b]-behCounts[a];}).map(function(k){return{t:k,n:behCounts[k]};});
  // grade counts
  var gradeCounts = {};
  rows.forEach(function(r){
    var g = r.homeroom||'';
    var band = g.match(/^K/i)?'Kinder':g.match(/^1/)?'1st':g.match(/^2/)?'2nd':g.match(/^3/)?'3rd':g.match(/^4/)?'4th':g.match(/^5/)?'5th':'Other';
    gradeCounts[band]=(gradeCounts[band]||0)+1;
  });
  var gradeOrder=['Kinder','1st','2nd','3rd','4th','5th','Other'];
  var grades = gradeOrder.filter(function(g){return gradeCounts[g];}).map(function(g){return{g:g,n:gradeCounts[g]};});
  // specials
  var spCounts = {};
  rows.forEach(function(r){var s=r.subject||r.specials;if(s)spCounts[s]=(spCounts[s]||0)+1;});
  var specials = Object.keys(spCounts).sort(function(a,b){return spCounts[b]-spCounts[a];}).map(function(k){return{n:k,total:spCounts[k]};});
  var dates = rows.map(function(r){return r.incident_date || (r.created_at||'').slice(0,10);}).filter(Boolean).sort();
  var dateRange = dates.length ? dates[0] + ' – ' + dates[dates.length-1] : 'No data';
  var uniqueDaysMap = rows.reduce(function(a,r){
    var ds = r.incident_date || (r.created_at||'').slice(0,10);
    if(ds) a[ds]=1;
    return a;
  },{});
  var uniqueDays = Object.keys(uniqueDaysMap).length;
  var perDay = uniqueDays ? (rows.length / uniqueDays).toFixed(1) : '—';
  // DOW
  var dowCounts = {}, dowDayCounts = {};
  rows.forEach(function(r){
    var ds = r.incident_date || (r.created_at||'').slice(0,10);
    if(!ds) return;
    var d = new Date(ds+'T12:00:00');
    if(isNaN(d)) return;
    var name=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
    dowCounts[name]=(dowCounts[name]||0)+1;
    dowDayCounts[name]=dowDayCounts[name]||{};
    dowDayCounts[name][ds]=1;
  });
  var dowOrder=['Monday','Tuesday','Wednesday','Thursday','Friday'];
  var dow = dowOrder.map(function(d){var days=Object.keys(dowDayCounts[d]||{}).length;return{d:d,r:days?parseFloat((dowCounts[d]/days).toFixed(2)):0};});
  // weekly
  var wkCounts = {}, wkDayCounts = {};
  rows.forEach(function(r){
    var ds = r.incident_date || (r.created_at||'').slice(0,10);
    if(!ds) return;
    var d = new Date(ds+'T12:00:00');
    if(isNaN(d)) return;
    var day=d.getDay();
    var mon=new Date(d);
    mon.setDate(d.getDate()-(day===0?6:day-1));
    var key=mon.toISOString().slice(0,10);
    wkCounts[key]=(wkCounts[key]||0)+1;
    wkDayCounts[key]=wkDayCounts[key]||{};
    wkDayCounts[key][ds]=1;
  });
  var wkOrder=Object.keys(wkCounts).sort();
  var weekly = wkOrder.map(function(w){
    var d=new Date(w+'T12:00:00');
    var label=isNaN(d)?w:(d.toLocaleString('en-US',{month:'short'})+' '+d.getDate());
    var n=wkCounts[w]||0;
    var days=Object.keys(wkDayCounts[w]||{}).length || 1;
    return{w:label,r:parseFloat((n/days).toFixed(2)),n:n};
  });
  // top students
  var stuCounts = {};
  rows.forEach(function(r){if(r.student) stuCounts[r.student]=(stuCounts[r.student]||0)+1;});
  var topStudents = Object.keys(stuCounts).sort(function(a,b){return stuCounts[b]-stuCounts[a];}).slice(0,15).map(function(k){return{name:k,n:stuCounts[k]};});
  // classrooms
  var clsMap = {};
  rows.forEach(function(r){
    var k=r.homeroom||'Unknown';
    if(!clsMap[k]) clsMap[k]={total:0,chartY:0,homeY:0,behCounts:{},spCounts:{},stuCounts:{},wkCounts:{}};
    var c=clsMap[k];
    c.total++;
    if(r.color_chart) c.chartY++;
    if(r.home_contact) c.homeY++;
    (r.behaviors||[]).forEach(function(b){var mapped=displayBehavior(b);c.behCounts[mapped]=(c.behCounts[mapped]||0)+1;});
    if(r.specials) c.spCounts[r.specials]=(c.spCounts[r.specials]||0)+1;
    if(r.student) c.stuCounts[r.student]=(c.stuCounts[r.student]||0)+1;
    var ds=r.incident_date || (r.created_at||'').slice(0,10);
    var d=new Date(ds+'T12:00:00');
    if(!isNaN(d)){var day=d.getDay();var mon=new Date(d);mon.setDate(d.getDate()-(day===0?6:day-1));var lbl=mon.toISOString().slice(0,10);c.wkCounts[lbl]=(c.wkCounts[lbl]||0)+1;}
  });
  var classrooms = {};
  Object.keys(clsMap).forEach(function(k){
    var c=clsMap[k];
    classrooms[k]={
      total:c.total,
      chart:Math.round(c.chartY/c.total*100),
      home:Math.round(c.homeY/c.total*100),
      behaviors:Object.keys(c.behCounts).sort(function(a,b){return c.behCounts[b]-c.behCounts[a];}).map(function(b){return{t:b,n:c.behCounts[b]};}),
      specials:c.spCounts,
      students:Object.keys(c.stuCounts).sort(function(a,b){return c.stuCounts[b]-c.stuCounts[a];}).slice(0,5).map(function(s){return{name:s,n:c.stuCounts[s]};}),
      weekly:Object.keys(c.wkCounts).sort().map(function(w){var d=new Date(w+'T12:00:00');var label=isNaN(d)?w:(d.toLocaleString('en-US',{month:'short'})+' '+d.getDate());return{w:label,n:c.wkCounts[w]};})
    };
  });
  var topCls = Object.keys(clsMap).sort(function(a,b){return clsMap[b].total-clsMap[a].total;}).slice(0,15).map(function(k){return{cls:k,n:clsMap[k].total};});
  return {total:total,chart_yes:chartYes,home_yes:homeYes,behaviors:behaviors,grades:grades,specials:specials,dow:dow,weekly:weekly,top_students:topStudents,classrooms:classrooms,top_cls:topCls,date_range:dateRange,unique_days:uniqueDays,per_day:perDay};
}

// ── ADMIN ──
function setTab(t){STATE.adminTab=t;document.querySelectorAll('#admin-tabs .tab').forEach(function(b){b.classList.toggle('on',b.dataset.tab===t);});renderAdmin();}

// Interpretation note shown once at top of admin, persists across tabs

function renderAdmin(){
  var body=el('admin-body'),t=STATE.adminTab;
  if(!STATE.liveLoaded){
    body.innerHTML='<div style="text-align:center;padding:40px 0;color:var(--text3);font-size:12px;letter-spacing:.06em">LOADING LIVE DATA…</div>';
    fetchLiveData(function(){renderAdmin();});
    return;
  }
  var live=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;
  var content='';
  if(t==='overview') content=bOV(live);
  else if(t==='timing'){ content=bTM(live); setTimeout(function(){ wireHeat('all'); },50); }
  else if(t==='coverage') content=bCV();
  else if(t==='students') content=bST(live);
  else if(t==='firstaid') content=bFA();
  else content=bCL(live);
  body.innerHTML=content;
  if(STATE.liveError) body.innerHTML='<div class="alert" style="margin:0">Error: Could not reach Supabase — showing cached data</div>'+body.innerHTML;
  if(t==='students') wireStudentLinks(body,'S-admin');
  if(t==='firstaid') {
    body.querySelectorAll('[data-fa-spec]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        STATE.faFilterSpecials = btn.dataset.faSpec;
        renderAdmin();
      });
    });
    body.querySelectorAll('[data-fa-home]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        STATE.faFilterHome = btn.dataset.faHome;
        renderAdmin();
      });
    });
  }
  setTimeout(drawCharts,60);
  body.querySelectorAll('[data-cls]').forEach(function(r){r.addEventListener('click',function(){openDet(r.dataset.cls,live);});});
}

function fetchFirstAid(cb){
  if(!SESSION.token){ STATE.firstAidLoaded=true; if(cb) cb(new Error('not authenticated'),[]); return; }
  var q='select=*&order=incident_date.desc,created_at.desc&limit=500';
  fetch(SB_URL+'/rest/v1/first_aid_log?'+q,{
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token}
  }).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(rows){
    STATE.firstAidRows=rows||[];
    STATE.firstAidLoaded=true;
    STATE.firstAidError=false;
    if(cb) cb(null, STATE.firstAidRows);
  }).catch(function(err){
    STATE.firstAidRows=[];
    STATE.firstAidLoaded=true;
    STATE.firstAidError=true;
    if(cb) cb(err, []);
  });
}
function bFA() {
  if (!STATE.firstAidLoaded) {
    fetchFirstAid(function () { renderAdmin(); });
    return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">Loading first aid log…</div>';
  }
  if (STATE.firstAidError) {
    return '<div class="card" style="text-align:center;padding:32px 0;color:var(--red);font-size:12px">Could not load first aid records. Check connection and try again.<br><br><button class="pill" onclick="STATE.firstAidLoaded=false;STATE.firstAidError=false;renderAdmin()">Retry</button></div>';
  }

  var all = STATE.firstAidRows || [];
  if (!all.length) return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No first aid records found.</div>';

  // Read active filters from DOM (default: all)
  var activeSpecials = STATE.faFilterSpecials || 'all';
  var activeHome     = STATE.faFilterHome     || 'all';

  // Apply filters
  var rows = all.filter(function (r) {
    var passSpecials = activeSpecials === 'all' || (r.specials || '') === activeSpecials;
    var passHome     = activeHome === 'all'
      || (activeHome === 'yes' && r.home_contact)
      || (activeHome === 'no'  && !r.home_contact);
    return passSpecials && passHome;
  });

  // KPI calculations
  var total      = all.length;
  var homeYes    = all.filter(function (r) { return r.home_contact; }).length;
  var returnedYes= all.filter(function (r) { return r.returned_to_activity; }).length;
  var homePct    = total ? Math.round(homeYes / total * 100) : 0;
  var returnPct  = total ? Math.round(returnedYes / total * 100) : 0;

  // Build specials filter pills
  var specials = ['all'].concat(Object.keys(all.reduce(function(a,r){var s=r.specials||r.subject;if(s)a[s]=1;return a;},{})).sort());
  var homePills = [['all','All'],['yes','Home yes'],['no','No contact']];

  var filterBar =
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center">' +
      '<span style="font-size:10px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;margin-right:4px">Specials</span>' +
      specials.map(function (s) {
        var on = s === activeSpecials;
        return '<button class="pill fa-filter" data-fa-spec="' + s + '" style="' +
          (on ? 'background:var(--indigo);color:#ffffff;' : '') + '">' +
          (s === 'all' ? 'All' : s) + '</button>';
      }).join('') +
      '<span style="font-size:10px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;margin:0 4px 0 12px">Home</span>' +
      homePills.map(function (p) {
        var on = p[0] === activeHome;
        return '<button class="pill fa-filter" data-fa-home="' + p[0] + '" style="' +
          (on ? 'background:var(--indigo);color:#ffffff;' : '') + '">' + p[1] + '</button>';
      }).join('') +
    '</div>';

  // Build expandable cards
  var cards = rows.length
    ? rows.map(function (r, i) {
        var id = 'fa-card-' + i;
        return '<div class="card" id="' + id + '" style="margin-bottom:8px;cursor:pointer;padding:12px 14px" onclick="toggleFA(\'' + id + '\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<div>' +
              '<span style="font-size:13px;font-weight:600;color:var(--text)">' + escHtml(r.student || '—') + '</span>' +
              '<span style="font-size:11px;color:var(--indigo);margin-left:8px">' + escHtml(r.specials || '') + '</span>' +
              '<span style="font-size:11px;color:var(--text3);margin-left:8px">' + escHtml(r.incident_date || '') + '</span>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
              (r.home_contact ? '<span style="font-size:10px;color:var(--indigo);letter-spacing:.04em">Home yes</span>' : '<span style="font-size:10px;color:var(--text3)">—</span>') +
              (r.returned_to_activity ? '<span style="font-size:10px;color:var(--indigo)">Returned</span>' : '<span style="font-size:10px;color:var(--red)">Did not return</span>') +
              '<span class="fa-chevron" style="color:var(--text3);font-size:14px;transition:transform .2s"></span>' +
            '</div>' +
          '</div>' +
          '<div class="fa-detail" style="display:none;margin-top:12px;padding-top:12px;border-top:0.5px solid var(--border)">' +
            '<div style="font-size:11px;color:var(--text2);margin-bottom:4px"><span style="color:var(--text3)">Injury: </span>' + escHtml(r.injury_description || '—') + '</div>' +
            '<div style="font-size:11px;color:var(--text2);margin-bottom:4px"><span style="color:var(--text3)">Treatment: </span>' + escHtml(r.treatment || '—') + '</div>' +
            (r.staff_notified ? '<div style="font-size:11px;color:var(--text2);margin-bottom:4px"><span style="color:var(--text3)">Staff notified: </span>' + escHtml(r.staff_notified) + '</div>' : '') +
            (r.homeroom ? '<div style="font-size:11px;color:var(--text2);margin-bottom:4px"><span style="color:var(--text3)">Homeroom: </span>' + escHtml(r.homeroom) + '</div>' : '') +
            (r.notes ? '<div style="font-size:11px;color:var(--text2);margin-top:6px;line-height:1.6">' + escHtml(r.notes) + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('')
    : '<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:12px">No records match this filter.</div>';

  return '<div class="sec">First Aid / Injury Log</div>' +
    '<div class="kpi-grid" style="margin-bottom:12px">' +
      kpiH('Total incidents', total, 'all time', false) +
      kpiH('Home contacted', homePct + '%', homeYes + ' of ' + total, homePct < 50) +
      kpiH('Returned to activity', returnPct + '%', returnedYes + ' of ' + total, returnPct < 80) +
    '</div>' +
    filterBar +
    cards;
}

// Toggle expand/collapse for a first aid card
function toggleFA(id) {
  var card = document.getElementById(id);
  if (!card) return;
  var detail  = card.querySelector('.fa-detail');
  var chevron = card.querySelector('.fa-chevron');
  var open    = detail.style.display !== 'none';
  detail.style.display  = open ? 'none' : 'block';
  if (chevron) {
    chevron.style.transform = open ? '' : 'rotate(90deg)';
    chevron.textContent     = open ? '' : '';
  }
  card.style.borderLeft = open ? '' : '2px solid var(--indigo)';
}

function bOV(live){
  var LD=live||{};
  if(!LD.total){
    return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  }
  var tot=LD.total+STATE.logs.length;
  var chartPct=Math.round((LD.chart_yes||0)/LD.total*100);
  var homePct=Math.round((LD.home_yes||0)/LD.total*100);
  var dateRange=LD.date_range||'No data';
  var uniqueDays=LD.unique_days||0;
  var perDay=LD.per_day||'—';
  return '<div class="kpi-grid">'+
    kpiH('Total incidents',tot,dateRange,false)+
    kpiH('Per logged incident day',perDay,uniqueDays+' logged incident days',false)+
    kpiH('Color chart used',chartPct+'%',(LD.chart_yes||0)+' of '+LD.total+' incidents',false)+
    kpiH('Home contacted',homePct+'%',(LD.home_yes||0)+' of '+LD.total+' incidents',true)+
    '</div>'+
    '<div class="card"><div style="font-size:12px;color:var(--text2);margin-bottom:8px">Weekly incidents / logged incident day</div>'+
    '<canvas id="c-wk" height="80" style="width:100%;display:block" data-live="1"></canvas>'+
    '<div style="display:flex;gap:12px;margin-top:8px">'+
    '<span style="font-size:10px;color:var(--text2);display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:2px;background:#271A70;border-radius:1px"></span>Incidents/logged day</span>'+
    '</div></div>'+
    '<div class="sec">Incidents by grade</div><div class="card"><canvas id="c-gr" height="100" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec">Behavior types <span style="font-weight:400;color:var(--text3);font-size:10px;text-transform:none;letter-spacing:0">(tagged incidents · multi-select)</span></div><div class="card">'+
    (function(){var beh=LD.behaviors||[];if(!beh.length)return '<div style="font-size:11px;color:var(--text3);padding:8px 0">No live data yet.</div>';var mx=beh.reduce(function(a,b){return Math.max(a,b.n);},0)||1;return beh.map(function(b,i){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+displayBehavior(b.t)+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;color:'+(b.t==='Unspecified'?'var(--text3)':'var(--text2)')+'">'+b.n+'</span></div>'+pb((b.n/mx)*100,b.t==='Unspecified'?'#98A2AD':BEHAVIOR_COLORS[i%BEHAVIOR_COLORS.length])+'</div>';}).join('');}())+'</div>'+
    '<div class="sec">By subject</div><div class="card">'+
    (function(){
      var specList=LD.specials&&LD.specials.length?LD.specials:[];
      if(!specList.length) return '<div style="font-size:11px;color:var(--text3);padding:8px 0">No live data yet.</div>';
      var mx=specList[0].total||1;
      return specList.map(function(s,i){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+subjectBarColor(i)+'">'+s.n+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">'+s.total+'</span></div>'+pb((s.total/mx)*100,subjectBarColor(i))+'</div>';}).join('');
    }())+'</div>';
}
function bTM(live){
  var rows=STATE.liveRows||[];
  if(!rows.length){
    return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  }
  return '<div class="card"><div style="font-size:12px;color:var(--text2);margin-bottom:6px">Incidents per logged incident day · by weekday</div><canvas id="c-dow" height="90" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec">Weekly longitudinal trend</div><div class="card"><canvas id="c-tm-wk" height="80" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec">Monthly incident totals</div><div class="card"><canvas id="c-tm-mo" height="90" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec">By class block</div><div class="card"><canvas id="c-tm-pd" height="90" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec">When it happens</div><div class="card" id="heat-card" style="overflow-x:auto">'+bHeat('all')+'</div>';
}
// ── INTERACTIVE HEATMAP ──
var PERIODS=[
  {label:'P1',start:'7:50',end:'8:45'},
  {label:'P2',start:'8:55',end:'9:45'},
  {label:'P3',start:'10:15',end:'11:05'},
  {label:'Lunch',start:'11:06',end:'11:45'},
  {label:'P4',start:'11:50',end:'12:40'},
  {label:'P5',start:'1:00',end:'1:50'},
  {label:'P6',start:'2:00',end:'2:50'}
];
var HEAT_DAYS=['Mon','Tue','Wed','Thu','Fri'];
var HEAT_DAY_FULL=['Monday','Tuesday','Wednesday','Thursday','Friday'];

function timeToMin(t){
  if(!t) return -1;
  var p=t.split(':');
  return parseInt(p[0],10)*60+(parseInt(p[1],10)||0);
}
function getPeriod(timeStr){
  var m=timeToMin(timeStr);
  if(m<0) return null;
  for(var i=0;i<PERIODS.length;i++){
    var s=timeToMin(PERIODS[i].start),e=timeToMin(PERIODS[i].end);
    if(m>=s&&m<=e) return PERIODS[i].label;
  }
  return null;
}
function buildTimingStats(rows){
  var weeklyMap={}, monthlyMap={}, periodMap={};
  PERIODS.forEach(function(p){ periodMap[p.label]=0; });
  (rows||[]).forEach(function(r){
    var ds=(r.incident_date||(r.created_at||'').slice(0,10));
    if(ds){
      var d=new Date(ds+'T12:00:00');
      if(!isNaN(d)){
        var day=d.getDay();
        var mon=new Date(d);
        mon.setDate(d.getDate()-(day===0?6:day-1));
        var wk=mon.toISOString().slice(0,10);
        weeklyMap[wk]=(weeklyMap[wk]||0)+1;
        var mk=ds.slice(0,7);
        monthlyMap[mk]=(monthlyMap[mk]||0)+1;
      }
    }
    var p=getPeriod(r.incident_time||(r.created_at||'').slice(11,16));
    if(p) periodMap[p]=(periodMap[p]||0)+1;
  });
  var wkKeys=Object.keys(weeklyMap).sort().slice(-10);
  var moKeys=Object.keys(monthlyMap).sort().slice(-6);
  return {
    weekly:{
      labels:wkKeys.map(function(k){
        var d=new Date(k+'T12:00:00');
        return isNaN(d)?k:(d.toLocaleString('en-US',{month:'short'})+' '+d.getDate());
      }),
      values:wkKeys.map(function(k){return weeklyMap[k]||0;})
    },
    monthly:{
      labels:moKeys.map(function(k){
        var d=new Date(k+'-01T12:00:00');
        return isNaN(d)?k:d.toLocaleString('en-US',{month:'short'});
      }),
      values:moKeys.map(function(k){return monthlyMap[k]||0;})
    },
    periods:{
      labels:PERIODS.map(function(p){return p.label;}),
      values:PERIODS.map(function(p){return periodMap[p.label]||0;})
    }
  };
}

function buildHeatGrid(rows, subjectFilter){
  var grid={};
  var incidents={};
  PERIODS.forEach(function(p){
    grid[p.label]={};
    incidents[p.label]={};
    HEAT_DAYS.forEach(function(d){
      grid[p.label][d]=0;
      incidents[p.label][d]=[];
    });
  });
  rows.forEach(function(r){
    if(subjectFilter && subjectFilter!=='all'){
      var s=r.subject||r.specials;
      if(s!==subjectFilter) return;
    }
    var dateStr=(r.incident_date||r.date||(r.created_at||'').slice(0,10));
    if(!dateStr) return;
    var d=new Date(dateStr+'T12:00:00');
    var dow=d.getDay();
    if(dow===0||dow===6) return;
    var dayLabel=HEAT_DAYS[dow-1];
    var period=getPeriod(r.incident_time||r.time||(r.created_at||'').slice(11,16));
    if(!period) return;
    grid[period][dayLabel]++;
    incidents[period][dayLabel].push(r);
  });
  return {grid:grid,incidents:incidents};
}

function bHeatForRows(rows, subjectFilter, opts){
  opts=opts||{};
  var showFilters=opts.showFilters!==false;
  var prefix=opts.prefix||'heat';
  var data=buildHeatGrid(rows||[],subjectFilter||'all');
  var grid=data.grid;
  var mx=0;
  PERIODS.forEach(function(p){HEAT_DAYS.forEach(function(d){if(grid[p.label][d]>mx)mx=grid[p.label][d];});});

  var subjects=['all'].concat(Object.keys((rows||[]).reduce(function(a,r){var s=r.subject||r.specials;if(s)a[s]=1;return a;},{})));
  var filterHtml=showFilters?'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">'+
    subjects.map(function(s){
      var on=(subjectFilter||'all')===s;
      return '<button type="button" data-hf="'+escHtml(s)+'" style="'+
        'font-size:10px;font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;letter-spacing:.06em;padding:4px 10px;'+
        'border-radius:10px;border:1px solid '+(on?'var(--navy)':'rgba(39,26,112,.25)')+';'+
        'background:'+(on?'rgba(39,26,112,.12)':'transparent')+';'+
        'color:'+(on?'var(--navy)':'var(--text3)')+';cursor:pointer">'+(s==='all'?'All':escHtml(s))+'</button>';
    }).join('')+'</div>':'';

  var h='<table class="htable" style="width:100%;border-collapse:collapse">'+
    '<thead><tr>'+
    '<th style="text-align:left;font-size:9px;color:var(--text3);padding:4px 8px 4px 0;font-weight:400;min-width:48px">Period</th>'+
    HEAT_DAYS.map(function(d){return '<th style="font-size:9px;color:var(--text3);padding:4px 6px;font-weight:400;text-align:center">'+d+'</th>';}).join('')+
    '</tr></thead><tbody>';

  PERIODS.forEach(function(p){
    h+='<tr>';
    h+='<td style="font-size:9px;color:var(--text3);padding:6px 8px 6px 0;white-space:nowrap;font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;vertical-align:middle">'+
      '<div style="font-weight:600;color:var(--text2)">'+p.label+'</div>'+
      '<div style="font-size:8px;opacity:.6">'+p.start+'</div></td>';
    HEAT_DAYS.forEach(function(d){
      var v=grid[p.label][d];
      var idx=heatBucket(v,mx);
      var bg=heatColor(v,mx);
      var cellColor=idx>=4?'#ffffff':'var(--indigo)';
      var txt=v===0?'<span style="color:'+cellColor+';font-size:10px">·</span>':
        '<span style="font-size:12px;font-weight:600;color:'+cellColor+'">'+v+'</span>';
      h+='<td style="text-align:center;padding:4px 2px;cursor:'+(v>0?'pointer':'default')+'"'+
        (v>0?' data-hp="'+escHtml(p.label)+'" data-hd="'+escHtml(d)+'"':'')+
        ' title="'+p.label+' '+d+': '+v+' incident'+(v===1?'':'s')+'">'+
        '<div style="background:'+bg+';border-radius:4px;padding:6px 4px;min-width:32px">'+txt+'</div></td>';
    });
    h+='</tr>';
  });

  h+='</tbody></table>';
  var drillHtml='<div id="'+prefix+'-drill" style="display:none;margin-top:12px;border-top:1px solid rgba(39,26,112,.15);padding-top:12px">'+
    '<div id="'+prefix+'-drill-hdr" style="font-size:11px;color:var(--navy);font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;margin-bottom:8px"></div>'+
    '<div id="'+prefix+'-drill-list"></div></div>';

  return filterHtml+h+drillHtml;
}

function wireHeatCard(cardId, rows, opts){
  opts=opts||{};
  var prefix=opts.prefix||'heat';
  var showFilters=opts.showFilters!==false;
  var currentFilter=opts.subjectFilter||'all';
  var card=document.getElementById(cardId);
  if(!card) return;
  card.innerHTML=bHeatForRows(rows||[], currentFilter, {prefix:prefix,showFilters:showFilters});
  card.addEventListener('click',function(e){
    // filter chip
    var hf=e.target.closest('[data-hf]');
    if(hf&&showFilters){
      var s=hf.dataset.hf;
      currentFilter=s;
      card.innerHTML=bHeatForRows(rows||[], currentFilter, {prefix:prefix,showFilters:showFilters});
      return;
    }
    // cell click
    var hp=e.target.closest('[data-hp]');
    if(hp){
      var period=hp.dataset.hp, day=hp.dataset.hd;
      var data=buildHeatGrid(rows||[],currentFilter||'all');
      var list=(data.incidents[period]&&data.incidents[period][day])||[];
      if(typeof opts.onCellClick==='function'){
        opts.onCellClick(list,{period:period,day:day});
        return;
      }
      var drill=document.getElementById(prefix+'-drill');
      var hdr=document.getElementById(prefix+'-drill-hdr');
      var ul=document.getElementById(prefix+'-drill-list');
      if(!drill) return;
      if(!list.length){drill.style.display='none';return;}
      hdr.textContent=period+' · '+HEAT_DAY_FULL[HEAT_DAYS.indexOf(day)]+' — '+list.length+' incident'+(list.length===1?'':'s');
      ul.innerHTML=list.map(function(r){
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(39,26,112,.08);font-size:11px">'+
          '<div>'+
            '<span style="color:var(--text);font-weight:600">'+escHtml(r.student||'')+'</span>'+
            '<span style="color:var(--text3);margin-left:6px;font-size:10px">'+escHtml(r.homeroom||'')+'</span>'+
          '</div>'+
          '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">'+
            (r.subject||r.specials?'<span class="tag blue">'+escHtml(r.subject||r.specials)+'</span>':'')+
            (r.incident_date?'<span class="tag gray" style="font-size:9px">'+r.incident_date+'</span>':'')+
          '</div>'+
        '</div>';
      }).join('');
      drill.style.display='block';
    }
  });
}
function bHeat(subjectFilter){
  return bHeatForRows(STATE.liveRows||[],subjectFilter||'all',{prefix:'heat',showFilters:true});
}
function wireHeat(subjectFilter){
  wireHeatCard('heat-card', STATE.liveRows||[], {prefix:'heat',showFilters:true,subjectFilter:subjectFilter||'all'});
}
function bCV(){
  var rows=STATE.liveRows||[];
  var total=rows.length;

  if(!total){
    return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  }

  // build subject breakdown from live data
  var subjMap={};
  var subjWeeks={};
  var subjChart={};
  var subjLag=[];
  rows.forEach(function(r){
    var s=r.subject||r.specials||'Unknown';
    subjMap[s]=(subjMap[s]||0)+1;
    if(r.color_chart) subjChart[s]=(subjChart[s]||0)+1;
    // lag: time between incident_date and created_at
    if(r.incident_date&&r.created_at){
      var inc=new Date(r.incident_date+'T12:00:00');
      var cre=new Date(r.created_at);
      var lag=(cre-inc)/(1000*3600);
      if(lag>=0&&lag<168) subjLag.push({s:s,lag:lag});
    }
    // week tracking
    if(r.incident_date){
      var d=new Date(r.incident_date+'T12:00:00');
      var day=d.getDay();
      var mon=new Date(d); mon.setDate(d.getDate()-(day===0?6:day-1));
      var wk=mon.toISOString().slice(0,10);
      if(!subjWeeks[s]) subjWeeks[s]={};
      subjWeeks[s][wk]=1;
    }
  });

  // get total unique weeks in dataset
  var allWeeks={};
  rows.forEach(function(r){
    if(!r.incident_date) return;
    var d=new Date(r.incident_date+'T12:00:00');
    var day=d.getDay();
    var mon=new Date(d); mon.setDate(d.getDate()-(day===0?6:day-1));
    allWeeks[mon.toISOString().slice(0,10)]=1;
  });
  var totalWks=Object.keys(allWeeks).length||1;

  // avg lag per subject
  var lagBySubj={};
  subjLag.forEach(function(x){
    if(!lagBySubj[x.s]) lagBySubj[x.s]={sum:0,n:0};
    lagBySubj[x.s].sum+=x.lag;
    lagBySubj[x.s].n++;
  });

  function cc(c){return c>=60?'#271A70':c>=25?'#BFA95F':'#98A2AD';}
  function pc(p){return p>=80?'#271A70':p>=50?'#BFA95F':'#98A2AD';}
  function lc(l){return l<=2?'#271A70':l<=5?'#BFA95F':'#98A2AD';}

  var subjects=Object.keys(subjMap).sort(function(a,b){return subjMap[b]-subjMap[a];});

  var tableHtml='<div class="card" style="overflow-x:auto"><table class="ctable">'+
    '<thead><tr>'+
    '<th style="text-align:left">Subject</th>'+
    '<th>Total</th>'+
    '<th>Weeks active</th>'+
    '<th>Avg lag</th>'+
    '<th>Chart %</th>'+
    '</tr></thead><tbody>'+
    subjects.map(function(s){
      var n=subjMap[s];
      var wks=Object.keys(subjWeeks[s]||{}).length;
      var wkPct=Math.round(wks/totalWks*100);
      var lagD=lagBySubj[s];
      var lag=lagD?parseFloat((lagD.sum/lagD.n).toFixed(1)):null;
      var chartPct=Math.round(((subjChart[s]||0)/n)*100);
      var color=SC[s]||'var(--text)';
      return '<tr>'+
        '<td style="font-weight:600;color:'+color+'">'+escHtml(s)+'</td>'+
        '<td style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;text-align:center">'+n+'</td>'+
        '<td style="text-align:center"><span style="font-size:10px;color:'+pc(wkPct)+'">'+wks+'/'+totalWks+' ('+wkPct+'%)</span></td>'+
        '<td style="text-align:center">'+(lag!==null?'<span class="tag" style="background:'+lc(lag)+'22;color:'+lc(lag)+'">'+lag+'h</span>':'<span style="color:var(--text3)">—</span>')+'</td>'+
        '<td style="text-align:center"><span class="tag" style="background:'+cc(chartPct)+'22;color:'+cc(chartPct)+'">'+chartPct+'%</span></td>'+
      '</tr>';
    }).join('')+
  '</tbody></table></div>';

  // field completeness from live data
  var hasStudent=rows.filter(function(r){return r.student&&r.student.trim();}).length;
  var hasSubject=rows.filter(function(r){return r.subject||r.specials;}).length;
  var hasBehavior=rows.filter(function(r){return r.behaviors&&r.behaviors.length;}).length;
  var hasChart=rows.filter(function(r){return r.color_chart;}).length;
  var hasHome=rows.filter(function(r){return r.home_contact;}).length;
  var hasTime=rows.filter(function(r){return r.incident_time;}).length;

  var fields=[
    {f:'Scholar name',n:hasStudent},
    {f:'Subject',n:hasSubject},
    {f:'Behavior type',n:hasBehavior},
    {f:'Time logged',n:hasTime},
    {f:'Color chart response',n:hasChart},
    {f:'Home contact',n:hasHome}
  ];

  var completenessHtml='<div class="sec">Field completeness · '+total+' records</div><div class="card">'+
    fields.map(function(f){
      var p=Math.round(f.n/total*100);
      var c=p>=90?'#271A70':p>=50?'#BFA95F':'#98A2AD';
      return '<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">'+
        '<span>'+f.f+'</span>'+
        '<span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;color:'+c+'">'+p+'%</span>'+
        '</div>'+pb(p,c)+'</div>';
    }).join('')+'</div>';

  return '<div class="sec">By subject · '+total+' total incidents</div>'+
    tableHtml+completenessHtml;
}
function bST(live){
  var LD=live||{};
  var stuList=LD.top_students&&LD.top_students.length?LD.top_students:[];
  if(!stuList.length) return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  var mx=stuList[0].n||1;
  return '<div class="sec">Scholars with 4+ logged incidents</div><div class="card">'+
    stuList.map(function(s){return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+stuNameLink(s.name)+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;font-weight:500;color:'+scholarBarColor(s.n)+'">'+s.n+'</span></div>'+pb((s.n/mx)*100,scholarBarColor(s.n))+'</div>';}).join('')+'</div>';
}
function bCL(live){
  var LD=live||{};
  var sorted=(LD.top_cls&&LD.top_cls.length?LD.top_cls:[]).slice().sort(function(a,b){return b.n-a.n;});
  if(!sorted.length) return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  var mx=sorted[0].n||1;
  return '<div class="sec">All classrooms · sorted by incident count</div><div class="card">'+
    sorted.map(function(c,i){var det=(LD.classrooms&&LD.classrooms[c.cls])||{};return '<div class="li" data-cls="'+c.cls+'"><div class="li-c"><div class="li-t">'+c.cls+'</div><div class="li-s">Chart: '+(det.chart!=null?det.chart:'—')+'% · Home: '+(det.home!=null?det.home:0)+'%</div>'+pb((c.n/mx)*100,'#271A70')+'</div><div class="li-r" style="color:var(--text2);margin-left:10px">'+c.n+'</div><div style="color:var(--text3);font-size:18px"></div></div>';}).join('')+'</div>';
}

// ── CLASS EXPLORER ──
function filterClasses(list, live){
  var f=STATE.clsFilter;
  var classes=(live&&live.classrooms)||{};
  if(f==='all') return list;
  if(f==='zero') return list.filter(function(k){var c=classes[k];return !c||c.total===0;});
  if(f==='four') return list.filter(function(k){var c=classes[k];return c&&c.total>=4;});
  if(f==='lowchart') return list.filter(function(k){var c=classes[k];return c&&c.total>0&&c.chart<30;});
  return list;
}

function renderClsExplorer(live){
  var liveArg=live||(STATE.liveRows.length?buildLiveStats(STATE.liveRows):null);
  var filtered=filterClasses(ALL_CLASSES,liveArg);
  var q=(el('cls-search')||{value:''}).value||'';
  if(q) filtered=filtered.filter(function(k){return k.toLowerCase().indexOf(q.toLowerCase())>=0;});

  // update subtitle
  var sub=el('cls-sub');if(sub) sub.textContent=filtered.length+' of '+ALL_CLASSES.length+' classrooms';

  // build filter chips
  var filters=[
    {k:'all',lb:'All ('+ALL_CLASSES.length+')'},
    {k:'zero',lb:'Zero incidents'},
    {k:'four',lb:'4+ incidents'},
    {k:'lowchart',lb:'Low chart use'}
  ];
  var fHtml='<div class="cls-filters">'+filters.map(function(f){return '<button class="fchip'+(STATE.clsFilter===f.k?' on':'')+'" data-f="'+f.k+'">'+f.lb+'</button>';}).join('')+'</div>';

  // group by grade band
  var bands={};
  var bandOrder=[];
  filtered.forEach(function(k){
    var b=BAND_LABELS[k]||'Other';
    if(!bands[b]){bands[b]=[];bandOrder.push(b);}
    bands[b].push(k);
  });
  // dedupe bandOrder
  var seen={};bandOrder=bandOrder.filter(function(b){if(seen[b])return false;seen[b]=true;return true;});

  var cardsHtml=bandOrder.map(function(band){
    var rows=bands[band].map(function(k){
      var c=liveArg&&liveArg.classrooms&&liveArg.classrooms[k];
      var isZero=!c||c.total===0;
      var cardClass='card'+(isZero?' card-zero':'');
      var tot=isZero?0:c.total;
      var chartV=isZero?'—':(c.chart+'%');
      var chartTag=isZero?'<span class="tag gray">No data</span>':('<span class="tag '+(c.chart>=50?'green':c.chart>=30?'amber':'red')+'">Chart '+c.chart+'%</span>');
      var specHtml=isZero?'<span style="font-size:10px;color:var(--text3)">No incidents logged this window</span>':Object.keys(c.specials).filter(function(s){return c.specials[s]>0;}).map(function(s){return '<span style="font-size:10px;background:'+(SC[s]||'var(--text2)')+'22;color:'+(SC[s]||'var(--text3)')+';border-radius:10px;padding:2px 8px">'+s+': '+c.specials[s]+'</span>';}).join('');
      return '<div class="'+cardClass+'" style="cursor:pointer;margin-bottom:8px" data-cls="'+k+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div><div style="font-size:15px;font-weight:600">'+k+'</div><div style="font-size:11px;color:var(--text2);margin-top:2px">'+(isZero?'No incidents logged':''+tot+' incidents')+'</div></div>'+
        '<div style="text-align:right"><div style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;font-size:22px;font-weight:500;color:'+(isZero?'var(--text3)':'var(--text)')+'">'+tot+'</div>'+chartTag+'</div></div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">'+specHtml+'</div></div>';
    }).join('');
    return '<div class="band-hdr">'+band+'</div>'+rows;
  }).join('');

  el('cls-body').innerHTML=
    '<div class="sbar" style="margin-bottom:0"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><input id="cls-search" placeholder="Search classroom..." autocomplete="off" value="'+(q||'')+'"></div>'+
    fHtml+
    '<div id="cls-cards">'+cardsHtml+'</div>';

  // search
  el('cls-search').addEventListener('input',function(){renderClsExplorer();});
  // filter chips
  el('cls-body').querySelectorAll('[data-f]').forEach(function(btn){
    btn.addEventListener('click',function(){STATE.clsFilter=btn.dataset.f;renderClsExplorer();});
  });
  // card clicks
  el('cls-cards').querySelectorAll('[data-cls]').forEach(function(card){
    card.addEventListener('click',(function(k){return function(){setDetPrevScreen('S-classes');openDet(k,liveArg);};})(card.dataset.cls));
  });
}

// ── CLASS DETAIL ──



// ── EXPORT TO CSV ──
function exportCSV(){
  var tok=SESSION.token||SB_KEY;
  var btn=el('btn-export');
  if(btn){btn.textContent='[ Exporting… ]';btn.disabled=true;}
  fetch(SB_URL+'/rest/v1/incidents?select=*&order=incident_date.asc,created_at.asc&limit=2000',{
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}
  }).then(function(r){return r.json();})
  .then(function(rows){
    var cols=['id','student','homeroom','specials','behaviors','incident_date','incident_time','color_chart','home_contact','notes','submitted_by','created_at'];
    var csv=cols.join(',')+'\n'+rows.map(function(r){
      return cols.map(function(c){
        var v=r[c];
        if(Array.isArray(v)) v=v.join('; ');
        if(v===null||v===undefined) v='';
        v=String(v).replace(/"/g,'""');
        return '"'+v+'"';
      }).join(',');
    }).join('\n');
    var blob=new Blob([csv],{type:'text/csv'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;a.download='classpulse-incidents-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if(btn){btn.textContent='Export CSV';btn.disabled=false;}
  }).catch(function(){
    if(btn){btn.textContent='Export CSV';btn.disabled=false;}
  });
}


// ── FETCH INCIDENTS FOR A CLASSROOM ──
function fetchClassIncidents(homeroom, cb){
  if(!SESSION.token){ if(cb) cb(new Error('not authenticated'),[]); return; }
  var tok=SESSION.token;
  var q='select=*&homeroom=eq.'+encodeURIComponent(homeroom)+'&order=incident_date.desc,created_at.desc&limit=200';
  fetch(SB_URL+'/rest/v1/incidents?'+q,{
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}
  }).then(function(r){return r.json();})
    .then(function(rows){if(cb)cb(null,rows);})
    .catch(function(err){if(cb)cb(err,[]);});
}

function fetchStudentIncidents(name, cb){
  if(!SESSION.token){ if(cb) cb(new Error('not authenticated'),[]); return; }
  var tok=SESSION.token;
  var q='select=*&student=eq.'+encodeURIComponent(name)+'&order=incident_date.desc,created_at.desc&limit=200';
  fetch(SB_URL+'/rest/v1/incidents?'+q,{
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok}
  }).then(function(r){return r.json();})
    .then(function(rows){if(cb)cb(null,rows||[]);})
    .catch(function(err){if(cb)cb(err,[]);});
}

// ── RENDER INCIDENT LOG LIST (reusable) ──
function renderIncidentList(rows, container, onAfterEdit){
  if(!rows||!rows.length){
    container.innerHTML='<div style="text-align:center;padding:24px 0;font-size:11px;color:var(--text3);letter-spacing:.06em">No incidents found</div>';
    return;
  }
  // group by date
  var grouped={};
  rows.forEach(function(r){
    var k=r.incident_date||r.created_at.slice(0,10)||'Unknown';
    if(!grouped[k])grouped[k]=[];
    grouped[k].push(r);
  });
  var dates=Object.keys(grouped).sort(function(a,b){return b>a?1:-1;});
  var html=dates.map(function(d){
    var pretty=(function(){try{var dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}catch(e){return d;}})();
    return '<div class="date-grp-hdr">'+pretty+'</div>'+
      grouped[d].map(function(r){
        var uid='db-'+r.id;
        var behs=r.behaviors||[];
        var hasNotes=r.notes&&r.notes.trim().length>0;
        var submitter=getSubmitterDisplay(r.submitted_by,r.subject||r.specials);
        submitter=submitter?'<span style="font-size:9px;color:var(--text3);font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;margin-left:4px">'+escHtml(submitter)+'</span>':'';
        return '<div class="log-item" data-uid="'+uid+'">'+
          '<div class="log-hdr" data-toggle="'+uid+'">'+
            '<div class="log-name">'+stuNameLink(r.student||'—')+submitter+
              '<span class="log-chevron" id="chev-'+uid+'">▾</span>'+
            '</div>'+
            '<div class="log-time">'+(r.incident_time||r.created_at.slice(11,16))+'</div>'+
          '</div>'+
          '<div class="log-tags">'+
            '<span class="tag blue">'+escHtml(r.specials||'—')+'</span>'+
            behs.map(function(b){return '<span class="tag amber">'+escHtml(displayBehavior(b))+'</span>';}).join('')+
            (r.color_chart?'<span class="tag green">Chart</span>':'')+
            (r.home_contact?'<span class="tag red">Home</span>':'')+
          '</div>'+
          '<div class="log-detail" id="det-'+uid+'">'+
            '<div class="log-detail-inner">'+
              (hasNotes?'<div class="log-notes">'+escHtml(r.notes)+'</div>':
                '<div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;letter-spacing:.04em">— no notes —</div>')+
              '<div class="log-actions">'+
                '<button class="log-act-btn edit" data-edit="'+uid+'" data-dbid="'+r.id+'">[ Edit ]</button>'+
                (SESSION.role==='admin'?'<button class="log-act-btn del" data-del="'+uid+'" data-dbid="'+r.id+'">Delete</button>':'')+
              '</div>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');
  }).join('');
  container.innerHTML=html;
  wireStudentLinks(container, getStuPrevScreen());
  // bind toggles
  container.querySelectorAll('[data-toggle]').forEach(function(hdr){
    hdr.addEventListener('click',function(){
      var uid=hdr.dataset.toggle;
      var det=container.querySelector('#det-'+uid),chev=container.querySelector('#chev-'+uid);
      var isOpen=det.classList.contains('open');
      container.querySelectorAll('.log-detail.open').forEach(function(d){d.classList.remove('open');});
      container.querySelectorAll('.log-chevron.open').forEach(function(c){c.classList.remove('open');});
      if(!isOpen){det.classList.add('open');if(chev)chev.classList.add('open');}
    });
  });
  // bind edit
  container.querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var dbId=btn.dataset.dbid;
      // find row from rows array
      var row=null;for(var i=0;i<rows.length;i++){if(String(rows[i].id)===String(dbId)){row=rows[i];break;}}
      if(!row)return;
      // convert DB row to log-like object
      var logObj={dbId:row.id,studentName:row.student,homeroom:row.homeroom,specials:row.subject||row.specials,subject:row.subject||row.specials,
        behaviors:row.behaviors||[],date:row.incident_date,time:row.incident_time,
        colorChart:row.color_chart,homeContact:row.home_contact,notes:row.notes||'',fromDb:true};
      // open edit sheet using existing openEditSheet logic
      EDIT_STATE={uid:'db-'+row.id,dbId:row.id,allLogs:[logObj],onAfterEdit:onAfterEdit||null};
      populateEditSheet(logObj);
      el('edit-sheet').classList.add('show');
      el('edit-overlay').classList.add('show');
    });
  });
  // bind delete
  container.querySelectorAll('[data-del]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var dbId=btn.dataset.dbid;
      var row=null;for(var i=0;i<rows.length;i++){if(String(rows[i].id)===String(dbId)){row=rows[i];break;}}
      DEL_STATE={uid:'db-'+dbId,dbId:dbId,onAfterDelete:onAfterEdit||null};
      el('del-confirm-sub').textContent='Remove '+escHtml(row?row.student:'this incident')+' from the database. This cannot be undone.';
      el('del-confirm').classList.add('show');
      el('edit-overlay').classList.add('show');
    });
  });
}

function openDet(id,live){
  var LD=live||{};
  var c=LD.classrooms&&LD.classrooms[id];
  var isZero=!c||c.total===0;
  var backBtn=el('btn-det-back');
  if(backBtn) backBtn.textContent=DET_PREV_SCREEN==='S-teacher'?'‹ My Logs':'‹ Classes';
  el('det-title').textContent=id;
  el('det-sub').textContent=isZero?'No incidents logged':c.total+' incidents · Chart: '+c.chart+'% · Home: '+c.home+'%';

  if(isZero){
    el('det-body').innerHTML=
      '<div class="empty" style="padding-top:36px">'+
      '<div class="empty-t">No incidents logged</div>'+
      '<div class="empty-s">No specials incidents were recorded for this classroom in the current live data.</div></div>'+
      '<div style="height:16px"></div>';
    wireStudentLinks(el('det-body'),'S-detail');
  showScreen('S-detail');
    return;
  }

  var mxB=c.behaviors.reduce(function(a,b){return Math.max(a,b.n);},0);
  var mxS=c.students.reduce(function(a,s){return Math.max(a,s.n);},0);
  var spVals=Object.keys(c.specials).map(function(k){return c.specials[k];});
  var mxSP=Math.max.apply(null,spVals)||1;

  // summary block values
  var topBeh=c.behaviors.length?c.behaviors[0].t:'—';
  var topStu=(function(){var ns=c.students.filter(function(s){return s.name!=='Other';});return ns.length?ns[0].name+' ('+ns[0].n+')':'—';})();
  var topSpec=(function(){var best='—',bestN=0;Object.keys(c.specials).forEach(function(s){if(c.specials[s]>bestN){bestN=c.specials[s];best=s;}});return bestN>0?best+' ('+bestN+')':'—';})();

  var summBlock='<div class="det-summary">'+
    '<div class="ds-item"><div class="ds-lbl">Top behavior</div><div class="ds-val hi">'+topBeh+'</div></div>'+
    '<div class="ds-item"><div class="ds-lbl">Highest-repeat scholar</div><div class="ds-val hi">'+topStu+'</div></div>'+
    '<div class="ds-item"><div class="ds-lbl">Top subject</div><div class="ds-val hi">'+topSpec+'</div></div>'+
    '<div class="ds-item"><div class="ds-lbl">Chart use · Home contact</div><div class="ds-val hi">'+c.chart+'% · '+c.home+'%</div></div>'+
    '</div>';

  el('det-body').innerHTML=
    summBlock+
    '<div class="kpi-grid" style="margin-bottom:10px">'+
    kpiH('Total incidents',c.total,'specials logs',false)+
    kpiH('Chart used',c.chart+'%','',c.chart<30)+
    kpiH('Home contact',c.home+'%','',c.home===0)+
    '<div class="kpi"><div class="lbl">Subjects logged</div><div class="val">'+Object.keys(c.specials).filter(function(k){return c.specials[k]>0;}).length+'</div></div></div>'+
    '<div class="sec">Behavior types</div><div class="card">'+
    c.behaviors.map(function(b,i){return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+displayBehavior(b.t)+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">'+b.n+'</span></div>'+pb((b.n/mxB)*100,BEHAVIOR_COLORS[i%BEHAVIOR_COLORS.length])+'</div>';}).join('')+'</div>'+
    '<div class="sec">Scholars</div><div class="card">'+
    c.students.map(function(s){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+(s.name==='Other'?'var(--text2)':'var(--text)')+'">'+stuNameLink(s.name)+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;color:'+scholarBarColor(s.n)+'">'+s.n+'</span></div>'+pb((s.n/mxS)*100,s.name==='Other'?'#98A2AD':scholarBarColor(s.n))+'</div>';}).join('')+'</div>'+
    '<div class="sec">By subject</div><div class="card">'+
    Object.keys(c.specials).map(function(s,i){var n=c.specials[s],col=subjectBarColor(i);return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+col+'">'+s+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">'+n+'</span></div>'+pb((n/mxSP)*100,col)+'</div>';}).join('')+'</div>'+
    '<div class="sec">Weekly trend</div><div class="card"><canvas id="c-det-wk" height="80" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec" style="display:flex;justify-content:space-between;align-items:center">'+
    'All incidents'+
    '<span style="font-size:10px;color:var(--text3);font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;letter-spacing:.04em" id="det-inc-count">loading…</span>'+
    '</div>'+
  '<div id="det-inc-list" style="margin-bottom:16px"><div style="text-align:center;padding:20px 0;font-size:11px;color:var(--text3);letter-spacing:.06em">Fetching records…</div></div>'+
  '<div style="height:16px"></div>';

  wireStudentLinks(el('det-body'),'S-detail');
  showScreen('S-detail');
  setTimeout(function(){
    drawLine('c-det-wk',c.weekly.map(function(w){return w.w;}),c.weekly.map(function(w){return w.n;}));
    // fetch and render individual incidents
    fetchClassIncidents(id, function(err, rows){
      var countEl=el('det-inc-count');
      var listEl=el('det-inc-list');
      if(!listEl)return;
      if(err||!rows){
        if(listEl) listEl.innerHTML='<div style="font-size:11px;color:var(--text3);text-align:center;padding:16px 0">Could not load incidents</div>';
        return;
      }
      if(countEl) countEl.textContent=rows.length+' records';
      var onRefresh=function(){
        // re-fetch after edit/delete
        fetchClassIncidents(id,function(e2,r2){
          if(r2&&listEl) renderIncidentList(r2,listEl,onRefresh);
          STATE.liveLoaded=false;STATE.liveRows=[];
        });
      };
      renderIncidentList(rows, listEl, onRefresh);
    });
  },60);
}

// ── CANVAS CHARTS ──
function wireChartTooltip(canvasId,dataPoints){
  var canvas=document.getElementById(canvasId);
  if(!canvas) return;
  var tip=document.getElementById('chart-tooltip');
  if(!tip){
    tip=document.createElement('div');
    tip.id='chart-tooltip';
    tip.style.cssText=[
      'position:fixed',
      'background:var(--panel)',
      'border:1px solid var(--border)',
      'border-radius:6px',
      'padding:6px 10px',
      'font-size:11px',
      'font-weight:600',
      'color:var(--text)',
      'box-shadow:var(--shadow)',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity .15s',
      'z-index:9999',
      'white-space:nowrap'
    ].join(';');
    document.body.appendChild(tip);
  }
  if(canvas._chartTooltipMove) canvas.removeEventListener('mousemove',canvas._chartTooltipMove);
  if(canvas._chartTooltipLeave) canvas.removeEventListener('mouseleave',canvas._chartTooltipLeave);
  canvas._chartTooltipMove=function(e){
    var rect=canvas.getBoundingClientRect();
    var mx=e.clientX-rect.left;
    var my=e.clientY-rect.top;
    var hit=dataPoints.find(function(point){
      return mx>=point.x&&mx<=point.x+point.w&&my>=point.y&&my<=point.y+point.h;
    });
    if(hit){
      tip.textContent=hit.label+': '+hit.value;
      tip.style.left=(e.clientX+12)+'px';
      tip.style.top=(e.clientY-28)+'px';
      tip.style.opacity='1';
    }else{
      tip.style.opacity='0';
    }
  };
  canvas._chartTooltipLeave=function(){tip.style.opacity='0';};
  canvas.addEventListener('mousemove',canvas._chartTooltipMove);
  canvas.addEventListener('mouseleave',canvas._chartTooltipLeave);
}

function drawCharts(){
  var t=STATE.adminTab;
  if(t==='overview'){
    var liveStats=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;
    var liveWk=(liveStats&&liveStats.weekly)||[];
    if(liveWk.length) drawLine('c-wk',liveWk.map(function(d){return d.w;}),liveWk.map(function(d){return d.r;}));
    var liveGrades=(liveStats&&liveStats.grades)||[];
    if(liveGrades.length) drawBar('c-gr',liveGrades.map(function(d){return d.g;}),liveGrades.map(function(d){return d.n;}),liveGrades.map(function(d,i){return SER[i];}));
  }
  if(t==='timing'){
    var rows=STATE.liveRows||[];
    var liveDow=(rows.length&&buildLiveStats(rows)||{}).dow||[];
    if(liveDow.length) drawBar('c-dow',liveDow.map(function(d){return d.d.slice(0,3);}),liveDow.map(function(d){return d.r;}),liveDow.map(function(_,i){return BEHAVIOR_COLORS[i%BEHAVIOR_COLORS.length];}));
    var tm=buildTimingStats(rows);
    if(tm.weekly.values.length){
      drawLine('c-tm-wk',tm.weekly.labels,tm.weekly.values);
    }
    if(tm.monthly.values.length){
      drawBar('c-tm-mo',tm.monthly.labels,tm.monthly.values,tm.monthly.values.map(function(_,i){return MONTH_COLORS[i%MONTH_COLORS.length];}));
    }
    if(tm.periods.values.reduce(function(a,b){return a+b;},0)>0){
      drawBar('c-tm-pd',tm.periods.labels,tm.periods.values,tm.periods.values.map(function(v){
        return v>0?cssVar('--indigo','#271A70'):'rgba(39,26,112,.2)';
      }));
    }
  }
}
function drawLine(id,labels,d1){
  var cv=el(id);if(!cv)return;
  var ctx=cv.getContext('2d'),W=cv.offsetWidth||280,H=parseInt(cv.getAttribute('height'))||80,dpr=window.devicePixelRatio||1;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.height=H+'px';ctx.scale(dpr,dpr);
  var p={l:4,r:4,t:10,b:22},cw=W-p.l-p.r,ch=H-p.t-p.b;
  var avgStats=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;
  var avgLine=avgStats&&avgStats.per_day!=='—'?parseFloat(avgStats.per_day):0;
  var mx=Math.max(Math.max.apply(null,d1),avgLine||0,1)*1.2;
  var allLen=labels.length||1;
  var indigo=cssVar('--indigo','#271A70');
  var gold=cssVar('--gold','#BFA95F');
  var text2=cssVar('--text2','#4a5568');
  function xi(i){return p.l+(allLen>1?i*(cw/(allLen-1)):cw/2);}
  function yi(v){return p.t+ch-(v/mx)*ch;}
  ctx.strokeStyle='rgba(39,26,112,.06)';ctx.lineWidth=.5;
  [2,4,6,8,10].forEach(function(v){if(v<=mx){ctx.beginPath();ctx.moveTo(p.l,yi(v));ctx.lineTo(p.l+cw,yi(v));ctx.stroke();}});
  ctx.strokeStyle=gold;ctx.lineWidth=1;ctx.setLineDash([2,4]);
  if(avgLine){ctx.beginPath();ctx.moveTo(p.l,yi(avgLine));ctx.lineTo(p.l+cw,yi(avgLine));ctx.stroke();}ctx.setLineDash([]);
  ctx.fillStyle='rgba(39,26,112,0.08)';
  ctx.beginPath();ctx.moveTo(xi(0),yi(d1[0]||0));
  d1.forEach(function(v,i){ctx.lineTo(xi(i),yi(v));});
  ctx.lineTo(xi(d1.length-1),yi(0));ctx.lineTo(xi(0),yi(0));ctx.closePath();ctx.fill();
  ctx.strokeStyle=indigo;ctx.lineWidth=2;
  ctx.beginPath();d1.forEach(function(v,i){i===0?ctx.moveTo(xi(i),yi(v)):ctx.lineTo(xi(i),yi(v));});ctx.stroke();
  var mxR=Math.max.apply(null,d1);
  var points=[];
  d1.forEach(function(v,i){
    var px=xi(i),py=yi(v),radius=v===mxR?4:2.5;
    ctx.beginPath();ctx.arc(px,py,radius,0,Math.PI*2);ctx.fillStyle=indigo;ctx.fill();
    points.push({x:px-8,y:py-8,w:16,h:16,label:labels[i]||'',value:Number.isInteger(v)?v:v.toFixed(1)});
  });
  ctx.fillStyle=text2;ctx.font="10px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";ctx.textAlign='center';
  var step=Math.ceil(allLen/6);
  for(var i=0;i<allLen;i+=step){ctx.fillText((labels[i]||'').replace(/\w+ /,''),xi(i),H-4);}
  ctx.fillStyle='rgba(39,26,112,.4)';ctx.font="10px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";ctx.textAlign='right';if(avgLine) ctx.fillText('avg '+avgLine.toFixed(1),p.l+cw,yi(avgLine)-3);
  wireChartTooltip(id,points);
}
function drawBar(id,labels,data,colors){
  var cv=el(id);if(!cv)return;
  var ctx=cv.getContext('2d'),W=cv.offsetWidth||280,H=parseInt(cv.getAttribute('height'))||100,dpr=window.devicePixelRatio||1;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.height=H+'px';ctx.scale(dpr,dpr);
  var p={l:2,r:2,t:8,b:22},cw=W-p.l-p.r,ch=H-p.t-p.b;
  var mx=(Math.max.apply(null,data)||1)*1.15;
  var count=data.length||1;
  var bw=(cw/count)*.65,gap=(cw/count)*.35;
  var text2=cssVar('--text2','#4a5568');
  ctx.strokeStyle='rgba(39,26,112,.06)';ctx.lineWidth=.5;
  [.25,.5,.75].forEach(function(f){var yy=p.t+ch*(1-f);ctx.beginPath();ctx.moveTo(p.l,yy);ctx.lineTo(p.l+cw,yy);ctx.stroke();});
  var bars=[];
  data.forEach(function(v,i){
    var bx=p.l+i*(bw+gap)+gap/2,bh=(v/mx)*ch,by=p.t+ch-bh,r=Math.min(3,bh);
    ctx.fillStyle=Array.isArray(colors)?colors[i]:colors;
    ctx.beginPath();ctx.moveTo(bx+r,by);ctx.lineTo(bx+bw-r,by);ctx.quadraticCurveTo(bx+bw,by,bx+bw,by+r);
    ctx.lineTo(bx+bw,p.t+ch);ctx.lineTo(bx,p.t+ch);ctx.lineTo(bx,by+r);ctx.quadraticCurveTo(bx,by,bx+r,by);
    ctx.closePath();ctx.fill();
    if(v>0){ctx.fillStyle='rgba(39,26,112,.75)';ctx.font="10px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";ctx.textAlign='center';ctx.fillText(Number.isInteger(v)?v:v.toFixed(1),bx+bw/2,by-2);}
    ctx.fillStyle=text2;ctx.font="10px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";ctx.textAlign='center';
    ctx.fillText((labels[i]||'').length>4?labels[i].slice(0,4):labels[i],bx+bw/2,H-4);
    bars.push({x:bx,y:by,w:bw,h:Math.max(bh,ch-bh<1?1:bh),label:labels[i]||'',value:Number.isInteger(v)?v:v.toFixed(1)});
  });
  wireChartTooltip(id,bars);
}

// ── WIRE EVENTS ──
el('btn-t-signout') && el('btn-t-signout').addEventListener('click',signOut);
el('btn-th-signout') && el('btn-th-signout').addEventListener('click',signOut);
el('btn-a-signout') && el('btn-a-signout').addEventListener('click',signOut);
el('btn-t-switch').addEventListener('click',function(){ if(SESSION.role==='admin') goAdmin(); });
el('btn-th-switch').addEventListener('click',function(){ if(SESSION.role==='admin') goAdmin(); });
el('TN-log').addEventListener('click',function(){showPane('log');});
el('TN-hist').addEventListener('click',function(){showPane('hist');});
el('T-overlay').addEventListener('click',closeSheet);
el('btn-log-another').addEventListener('click',closeSheet);
el('btn-a-log').addEventListener('click',goTeacher);
el('btn-export') && el('btn-export').addEventListener('click',exportCSV);
el('btn-theme-toggle') && el('btn-theme-toggle').addEventListener('click',toggleTheme);
el('AN-classes').addEventListener('click',function(){ if(SESSION.role!=='admin') return; STATE.clsFilter='all';showScreen('S-classes');renderClsExplorer(STATE.liveRows.length?buildLiveStats(STATE.liveRows):null);});
el('AN-log').addEventListener('click',goTeacher);
el('btn-cls-back').addEventListener('click',function(){showScreen('S-admin',true);});
el('btn-det-back').addEventListener('click',function(){
  if(DET_PREV_SCREEN==='S-teacher'){
    showScreen('S-teacher',true);
    showPane('hist');
    renderHistory();
    return;
  }
  showScreen('S-classes',true);
  var live=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;
  renderClsExplorer(live);
});
el('btn-stu-back') && el('btn-stu-back').addEventListener('click',function(){
  var live=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;
  if(getStuPrevScreen()==='S-classes'){
    showScreen('S-classes',true);
    renderClsExplorer(live);
  } else {
    showScreen(getStuPrevScreen(),true);
  }
});

el('btn-det-log') && el('btn-det-log').addEventListener('click',function(){
  var hr=el('det-title').textContent;
  STATE.entry=freshEntry();
  STATE.entry.homeroom=hr;
  STATE.step=0;
  STATE.myDbLoaded=false;
  STATE.myDbLogs=[];
  updateUserDisplay();
  updateTeacherNav();
  showScreen('S-teacher');
  showPane('log');
  renderStep();
});

el('admin-tabs').addEventListener('click',function(e){var t=e.target.dataset.tab;if(t)setTab(t);});

// ── EDIT SHEET EVENTS ──
el('edit-close-btn').addEventListener('click',closeEditSheet);
el('edit-overlay').addEventListener('click',function(){closeEditSheet();closeDelConfirm();});

el('es-save').addEventListener('click',function(){
  var saveBtn=el('es-save'),status=el('es-status');
  var behs=[];
  el('es-behs').querySelectorAll('.edit-chip.on').forEach(function(c){behs.push(c.dataset.eb);});
  var updates={
    student:el('es-student').value.trim(),
    homeroom:el('es-homeroom').value,
    specials:el('es-specials').value,
    incident_date:el('es-date').value||null,
    incident_time:el('es-time').value||null,
    behaviors:behs,
    color_chart:el('es-chart').checked,
    home_contact:el('es-home').checked,
    notes:el('es-notes').value.trim()||null
  };
  if(!updates.student){status.textContent='Scholar name required';status.style.color='var(--red)';return;}

  function resetSaveBtn(){saveBtn.textContent='Save changes';saveBtn.disabled=false;}
  function onSaved(){
    var cb=EDIT_STATE.onAfterEdit;
    resetSaveBtn();
    closeEditSheet();
    STATE.myDbLogs=STATE.myDbLogs.map(function(row){
      if(String(row.id)===String(EDIT_STATE.dbId)){
        return Object.assign({},row,{student:updates.student,homeroom:updates.homeroom,specials:updates.specials,subject:updates.specials,behaviors:updates.behaviors,incident_date:updates.incident_date,incident_time:updates.incident_time,color_chart:updates.color_chart,home_contact:updates.home_contact,notes:updates.notes});
      }
      return row;
    });
    if(STATE.currentScreen==='S-admin'){STATE.liveLoaded=false;STATE.liveRows=[];}
    if(cb){ setTimeout(function(){try{cb();}catch(e){console.error(e);}},50); }
    else { setTimeout(function(){STATE.myDbLoaded=true;renderHistory();},50); }
  }

  saveBtn.textContent='[ Saving… ]';saveBtn.disabled=true;status.textContent='';

  if(EDIT_STATE.dbId){
    if(!SESSION.token){status.textContent='Not signed in';status.style.color='var(--red)';resetSaveBtn();return;}
    fetch(SB_URL+'/rest/v1/incidents?id=eq.'+EDIT_STATE.dbId,{
      method:'PATCH',
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify(updates)
    }).then(function(r){
      if(r.status===401){
        return new Promise(function(res,rej){
          refreshSession(function(ok){
            if(!ok){signOut();rej(new Error('Session expired'));return;}
            fetch(SB_URL+'/rest/v1/incidents?id=eq.'+EDIT_STATE.dbId,{
              method:'PATCH',
              headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token,'Content-Type':'application/json','Prefer':'return=minimal'},
              body:JSON.stringify(updates)
            }).then(res).catch(rej);
          });
        });
      }
      if(!r.ok) throw new Error('HTTP '+r.status+' — check your connection');
      return r;
    }).then(function(){
      onSaved();
    }).catch(function(err){
      status.textContent=err.message||'Save failed';
      status.style.color='var(--red)';
      resetSaveBtn();
    });
  } else {
    // session-only log
    STATE.logs=STATE.logs.map(function(l){
      if(('s-'+l.id)===EDIT_STATE.uid){
        return Object.assign({},l,{studentName:updates.student,homeroom:updates.homeroom,specials:updates.specials,behaviors:updates.behaviors,date:updates.incident_date,time:updates.incident_time,colorChart:updates.color_chart,homeContact:updates.home_contact,notes:updates.notes});
      }
      return l;
    });
    onSaved();
  }
});

// ── DELETE CONFIRM EVENTS ──
el('del-cancel-btn').addEventListener('click',closeDelConfirm);
el('del-go-btn').addEventListener('click',function(){
  function resetDeleteBtn(){el('del-go-btn').textContent='Delete';el('del-go-btn').disabled=false;}
  if(!DEL_STATE.dbId){resetDeleteBtn();closeDelConfirm();return;}
  el('del-go-btn').textContent='[ Deleting… ]';
  el('del-go-btn').disabled=true;
  if(!SESSION.token){resetDeleteBtn();closeDelConfirm();return;}
  fetch(SB_URL+'/rest/v1/incidents?id=eq.'+DEL_STATE.dbId,{
    method:'DELETE',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token,'Prefer':'return=minimal'}
  }).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    STATE.myDbLogs=STATE.myDbLogs.filter(function(row){return String(row.id)!==String(DEL_STATE.dbId);});
    if(STATE.currentScreen==='S-admin'){STATE.liveLoaded=false;STATE.liveRows=[];}
    var cb=DEL_STATE.onAfterDelete;
    resetDeleteBtn();
    closeDelConfirm();
    if(cb){ try{cb();}catch(e){console.error(e);} }
    else renderHistory();
  }).catch(function(){
    resetDeleteBtn();
    closeDelConfirm();
  });
});


// ── SERVICE WORKER ──
// Service worker requires a deployed URL — skipped in single-file mode.
// Offline support is available when deployed via Netlify/Vercel (add a sw.js file).



function initPasswordSetup(token){
  fetch(SB_URL + '/auth/v1/user', {
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+token}
  }).then(function(r){ return r.json(); })
  .then(function(user){
    SESSION.token = token;
    SESSION.email = user.email;
    history.replaceState(null,'',window.location.pathname);
    showScreen('S-setup');
  })
  .catch(function(){ showScreen('S-login'); });
}

// ── INIT ──
initTheme();
var _inviteToken = checkInviteToken();
if(_inviteToken){
  initPasswordSetup(_inviteToken);
} else {
  initLogin();
}

// ── SETUP FORM ──
el('setup-submit').addEventListener('click', function(){
  var btn = el('setup-submit');
  var errEl = el('setup-error');
  var pass = el('setup-pass').value;
  var confirm = el('setup-confirm').value;
  errEl.textContent = '';
  if(pass.length < 8){errEl.textContent='Password must be at least 8 characters';return;}
  if(pass !== confirm){errEl.textContent='Passwords do not match';return;}
  btn.textContent='[ Activating… ]'; btn.disabled=true;
  fetch(SB_URL+'/auth/v1/user',{
    method:'PUT',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token,'Content-Type':'application/json'},
    body:JSON.stringify({password:pass})
  }).then(function(r){
    if(!r.ok) throw new Error('Failed to set password');
    return fetch(SB_URL+'/auth/v1/token?grant_type=password',{
      method:'POST',
      headers:{'apikey':SB_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email:SESSION.email,password:pass})
    });
  }).then(function(r){ return r.json(); })
  .then(function(data){
    if(!data.access_token) throw new Error('Sign in failed');
    saveSession(data);
    SESSION.token = data.access_token;
    SESSION.email = data.user.email;
    fetchRole(data.user.id, function(err, role){
      if(role==='admin') goAdmin(); else goTeacher();
    });
  }).catch(function(err){
    errEl.textContent = err.message||'Something went wrong';
    btn.textContent='Activate account'; btn.disabled=false;
  });
});

initPwa();
initFreshness();

export {
  SESSION, STATE, ALL_CLASSES, BAND_LABELS, BEHAVIORS, HOMEROOMS, SER, SC,
  todayStr, nowStr, freshEntry,
  saveSession, loadSession, refreshSession, signOut,
  initLogin, fetchRole,
  authedFetch, authedInsert, authedSelect,
  fetchLiveData, buildLiveStats, fetchClassIncidents, fetchStudentIncidents, renderIncidentList,
  sbInsert,
  drawLine, drawBar, wireChartTooltip, pb,
  wireHeatCard,
  openEditSheet, closeEditSheet, populateEditSheet, openDelConfirm, closeDelConfirm,
  renderStep, goTeacher, showPane, closeSheet, renderHistory, fetchMyLogs,
  goAdmin, renderAdmin, setTab, bOV, bTM, bCV, bST, bCL,
  renderClsExplorer, filterClasses, openDet, showScreen, escHtml,
  openStudent, wireStudentLinks, stuNameLink, setStuPrevScreen, getStuPrevScreen, displayBehavior
};
