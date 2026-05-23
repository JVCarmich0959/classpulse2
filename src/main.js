import { SB_URL, SB_KEY, ROSTER_SCHOOL_YEAR } from './config.js';
import { supabase } from './api/client.js';
import { checkInviteToken } from './auth/session.js';
import { openStudent, wireStudentLinks, stuNameLink } from './views/admin/student.js';

'use strict';

// ── SUPABASE CONFIG ──




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
  var baseHeaders = {'apikey':SB_KEY,'Authorization':'Bearer '+tok,'Content-Type':'application/json'};
  var mergedOpts = Object.assign({}, opts || {});
  mergedOpts.headers = Object.assign({}, baseHeaders, (opts && opts.headers) || {});
  return fetch(SB_URL + path, mergedOpts).then(function(r){
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
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok,'Content-Type':'application/json','Prefer':'return=representation'},
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

// Drop color_transitions that are duplicates of an incident from the same
// behavioral event. Catches three cases:
//   1. Auto-resolved Green returns with no needed documentation (noise).
//   2. Transitions explicitly linked via incident_id.
//   3. Orphan transitions from the legacy insert flow that didn't set
//      incident_id — matched heuristically by (student, homeroom, specials,
//      created_at within 5 minutes of an incident).
function dedupeTransitions(incidents, transitions){
  var inc = Array.isArray(incidents) ? incidents : [];
  var tr  = Array.isArray(transitions) ? transitions : [];
  var incidentIds = new Set(inc.map(function(r){ return r.id; }));
  var bucket = {};
  inc.forEach(function(r){
    if(!r.created_at) return;
    var key = (r.student||'') + '|' + (r.homeroom||'') + '|' + (r.specials||r.subject||'');
    if(!bucket[key]) bucket[key] = [];
    bucket[key].push(new Date(r.created_at).getTime());
  });
  var FIVE_MIN = 5 * 60 * 1000;
  return tr.filter(function(t){
    if(!t || !t.to_color) return false;
    if(t.to_color === 'Green' && !t.needs_documentation) return false;
    if(t.incident_id && incidentIds.has(t.incident_id)) return false;
    if(t.created_at){
      var key = (t.student||'') + '|' + (t.homeroom||'') + '|' + (t.specials||'');
      var matches = bucket[key] || [];
      var ts = new Date(t.created_at).getTime();
      for(var i=0; i<matches.length; i++){
        if(Math.abs(matches[i] - ts) < FIVE_MIN) return false;
      }
    }
    return true;
  });
}

// Normalize a color_transition row into a unified shape compatible with
// the rendering and aggregation code that consumes incident rows.
function transitionToUnifiedRow(t){
  return {
    _type:        'transition',
    id:           'ct-' + t.id,
    student:      t.student,
    homeroom:     t.homeroom,
    specials:     t.specials || '',
    subject:      t.specials || '',
    date:         t.incident_date || (t.created_at || '').slice(0, 10),
    time:         (t.created_at || '').slice(11, 16),
    incident_date: t.incident_date || (t.created_at || '').slice(0, 10),
    incident_time: (t.created_at || '').slice(11, 16),
    created_at:   t.created_at,
    from_color:   t.from_color || 'Green',
    to_color:     t.to_color,
    resolved_at:  t.resolved_at,
    duration_mins: (t.resolved_at && t.created_at)
      ? Math.round((new Date(t.resolved_at) - new Date(t.created_at)) / 60000)
      : null,
    behaviors:    [],
    color_chart:  false,
    home_contact: false,
    notes:        t.notes || '',
    submitted_by: t.submitted_by || '',
    needs_documentation: t.needs_documentation
  };
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
var NOTIF_SCHOOL_YEAR=import.meta.env.VITE_SCHOOL_YEAR||'2025-26';
var NOTIF_SCHOOL_ID=import.meta.env.VITE_SCHOOL_ID||'wayne-stem';


function scholarBarColor(count){
  var theme=document.documentElement.getAttribute('data-theme');
  var isDark=theme==='dark';
  if(count>=7) return isDark?'#8A7BE0':'#271A70';
  if(count>=4) return '#BFA95F';
  return isDark?'#6A7680':'#98A2AD';
}
function subjectBarColor(index){
  return index%2===0?'#271A70':'#BFA95F';
}
function colorFill(color){
  var fills = {Green:'#4ABFA3', Yellow:'#E8C547', Orange:'#E87D2B', Red:'#D63B3B'};
  return fills[color] || '#98A2AD';
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


var STATE={step:0,entry:null,logs:[],myDbLogs:[],myDbLoaded:false,adminTab:'overview',clsFilter:'all',liveRows:[],liveLoaded:false,liveError:false,currentScreen:'S-login',firstAidRows:[],firstAidLoaded:false,firstAidError:false,faFilterSpecials:'all',faFilterHome:'all',notifRows:[],notifLoaded:false,notifPollTimer:null};
var STU_PREV_SCREEN='S-detail';
var DET_PREV_SCREEN='S-classes';
var DET_PHYSICS = {
  Green:  {spd:0.30, maxSpd:0.55, r:11, wobble:0.018, fill:'#4ABFA3', glow:null,               trailAlpha:0.10, trailLen:8,  bounceSpin:0.07},
  Yellow: {spd:0.72, maxSpd:1.10, r:12, wobble:0.055, fill:'#E8C547', glow:null,               trailAlpha:0.14, trailLen:10, bounceSpin:0.12},
  Orange: {spd:1.35, maxSpd:2.00, r:13, wobble:0.110, fill:'#E87D2B', glow:'rgba(232,125,43,0.16)', trailAlpha:0.18, trailLen:12, bounceSpin:0.28},
  Red:    {spd:2.10, maxSpd:3.20, r:14, wobble:0.200, fill:'#D63B3B', glow:'rgba(214,59,59,0.22)',  trailAlpha:0.22, trailLen:14, bounceSpin:0.44},
};

function gradeFromHomeroom(homeroom) {
  if (!homeroom) return '';
  if (homeroom.indexOf('K-') === 0 || homeroom === 'K') return 'K';
  var m = homeroom.match(/^(\d)/);
  return m ? m[1] : '';
}

var DET_LIVE = {
  dots:             [],
  raf:              null,
  channel:          null,
  homeroom:         null,
  running:          false,
  _greenFloodCount: 0,
  _greenFloodStart: null
};

// ── SCHOOL-WIDE PHYSICS ──
var SW_PHYSICS = {
  Green:  {spd:0.22,maxSpd:0.40,wobble:0.010,fill:'#4ABFA3',glow:null,               trailA:0.08,trailL:5, bSpin:0.05},
  Yellow: {spd:0.58,maxSpd:0.92,wobble:0.042,fill:'#E8C547',glow:null,               trailA:0.13,trailL:8, bSpin:0.10},
  Orange: {spd:1.12,maxSpd:1.80,wobble:0.092,fill:'#E87D2B',glow:'rgba(232,125,43,0.13)',trailA:0.16,trailL:11,bSpin:0.26},
  Red:    {spd:1.85,maxSpd:2.95,wobble:0.180,fill:'#D63B3B',glow:'rgba(214,59,59,0.20)',trailA:0.21,trailL:14,bSpin:0.44}
};

var SW_GRADE_RING = {K:'#8B7BE0','1':'#4ABFA3','2':'#E8C547','3':'#E87D2B','4':'#D63B3B','5':'#BFA95F'};
var SW_GRADE_R    = {K:4,'1':4.5,'2':5,'3':5.5,'4':6,'5':6.5};

var SW_STATE = {
  allDots:          [],
  visibleDots:      [],
  activeGrade:      'all',
  raf:              null,
  channel:          null,
  running:          false,
  tickLog:          [],
  _greenFloodCount: 0,
  _greenFloodStart: null
};
function setStuPrevScreen(v){ STU_PREV_SCREEN=v||'S-detail'; }
function getStuPrevScreen(){ return STU_PREV_SCREEN||'S-detail'; }
function setDetPrevScreen(v){ DET_PREV_SCREEN=v||'S-classes'; }
function todayStr(){return new Date().toISOString().split('T')[0];}
function nowStr(){var d=new Date();return d.toTimeString().slice(0,5);}
function freshEntry(){return{studentName:'',homeroom:'',specials:'',behaviors:[],date:todayStr(),time:nowStr(),colorChart:false,colorTransition:'',colorResolved:false,homeContact:false,motivation:'',contactMethod:'',notes:''};}
function el(id){return document.getElementById(id);}
function pb(pct,col){return '<div class="pbar"><div style="--pw:'+Math.min(pct,100)+'%;background:'+col+'" class="pfill"></div></div>';}

// ── ACCORDION ──
var ACC_STATE = {};
function accKey(tab,id){return tab+':'+id;}
function isAccOpen(tab,id,def){var k=accKey(tab,id);return k in ACC_STATE?ACC_STATE[k]:(def!==false);}
function buildAcc(tab,id,title,meta,content,def){
  var open=isAccOpen(tab,id,def!==false);
  var bid='acc-body-'+tab+'-'+id, cid='acc-chev-'+tab+'-'+id;
  return '<div class="acc-hdr" onclick="handleAccClick(\''+tab+'\',\''+id+'\')">'+
    '<div class="acc-hdr-left"><span class="acc-title">'+escHtml(title)+'</span>'+
    (meta?'<span class="acc-meta">'+escHtml(meta)+'</span>':'')+
    '</div><span class="acc-chevron'+(open?' open':'')+'" id="'+cid+'">&#8250;</span></div>'+
    '<div class="acc-body '+(open?'expanded':'collapsed')+'" id="'+bid+'" style="max-height:'+(open?'9999px':'0')+'">'+
    '<div style="padding-top:12px">'+content+'</div></div>';
}
function handleAccClick(tab,id){
  var key=accKey(tab,id);
  var wasOpen=isAccOpen(tab,id,true);
  ACC_STATE[key]=!wasOpen;
  var bodyEl=document.getElementById('acc-body-'+tab+'-'+id);
  var chevEl=document.getElementById('acc-chev-'+tab+'-'+id);
  if(bodyEl){
    if(ACC_STATE[key]){
      bodyEl.classList.remove('collapsed');bodyEl.classList.add('expanded');
      bodyEl.style.maxHeight=(bodyEl.scrollHeight+200)+'px';
      if(bodyEl.querySelector('canvas')) setTimeout(drawCharts,60);
    } else {
      bodyEl.style.maxHeight=bodyEl.scrollHeight+'px';
      requestAnimationFrame(function(){bodyEl.classList.add('collapsed');bodyEl.classList.remove('expanded');});
    }
  }
  if(chevEl) chevEl.classList.toggle('open',!!ACC_STATE[key]);
}
if(typeof window!=='undefined') window.handleAccClick=handleAccClick;

function initSchoolWide() {
  if (SW_STATE.running) return;
  var cv = document.getElementById('sw-canvas');
  if (!cv) return;
  var W = cv.offsetWidth || 340;
  var H = 320;
  var today = todayStr();

  authedFetch('/rest/v1/students?active=eq.true' +
    '&grade_code=not.in.(EC)' +
    '&school_year=eq.' + encodeURIComponent(NOTIF_SCHOOL_YEAR) +
    '&select=student_name,homeroom,grade_code' +
    '&order=grade_code.asc,last_name.asc,first_name.asc')
    .then(function(r){ return r.json(); })
    .then(function(students){
      students = Array.isArray(students) ? students : [];
      authedFetch('/rest/v1/color_transitions?incident_date=eq.' + encodeURIComponent(today) +
        '&select=student,to_color,created_at,resolved_at&order=created_at.asc')
        .then(function(r){ return r.json(); })
        .then(function(transitions){
          var colorMap = {};
          var latestSwMap = {};
          (Array.isArray(transitions)?transitions:[]).forEach(function(t){
            if(t && t.student && SW_PHYSICS[t.to_color]) latestSwMap[t.student] = t;
          });
          Object.keys(latestSwMap).forEach(function(name){
            var t = latestSwMap[name];
            colorMap[name] = t.resolved_at ? 'Green' : t.to_color;
          });
          SW_STATE.allDots = students.map(function(s){
            var color = colorMap[s.student_name] || 'Green';
            var r = SW_GRADE_R[s.grade_code] || 5;
            var ph = SW_PHYSICS[color];
            var angle = Math.random()*Math.PI*2;
            return {
              name:  s.student_name,
              first: (s.student_name||'').split(' ')[0],
              grade: s.grade_code || '',
              color: color,
              x: r+4+Math.random()*(W-r*2-8),
              y: r+4+Math.random()*(H-r*2-8),
              vx: Math.cos(angle)*ph.spd*(0.5+Math.random()*0.8),
              vy: Math.sin(angle)*ph.spd*(0.5+Math.random()*0.8),
              r:   r,
              pulse: 0,
              trail: []
            };
          });
          swSetFilter(SW_STATE.activeGrade);
          SW_STATE.running = true;
          if (!SW_STATE.raf) SW_STATE.raf = requestAnimationFrame(tickSchoolWide);
          startSchoolWideChannel();
        });
    })
    .catch(function(err){ console.warn('initSchoolWide failed', err); });
}

function swSetFilter(grade) {
  SW_STATE.activeGrade = grade;
  SW_STATE.visibleDots = grade === 'all'
    ? SW_STATE.allDots
    : SW_STATE.allDots.filter(function(d){ return d.grade === grade; });
  document.querySelectorAll('.sw-fb').forEach(function(b){
    b.classList.toggle('on', b.dataset.g === grade);
  });
  var ct = document.getElementById('sw-count');
  if (ct) ct.textContent = SW_STATE.visibleDots.length;
}
if(typeof window!=='undefined') window.swSetFilter=swSetFilter;

function stopSchoolWide() {
  SW_STATE.running = false;
  if (SW_STATE.raf){ cancelAnimationFrame(SW_STATE.raf); SW_STATE.raf = null; }
  if (SW_STATE.channel){
    try { supabase.removeChannel(SW_STATE.channel); } catch(e){}
    SW_STATE.channel = null;
  }
  SW_STATE.allDots = [];
  SW_STATE.visibleDots = [];
  SW_STATE.tickLog = [];
}

function startSchoolWideChannel() {
  if (SW_STATE.channel) return;
  SW_STATE.channel = supabase
    .channel('sw-color-transitions')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'color_transitions'},
      function(payload){
        var rec = payload.new;
        if (!rec || !rec.student || !rec.to_color || !SW_PHYSICS[rec.to_color]) return;
        var dot = null;
        for (var i=0;i<SW_STATE.allDots.length;i++){
          if (SW_STATE.allDots[i].name === rec.student){ dot=SW_STATE.allDots[i]; break; }
        }
        if (!dot) return;
        dot.color  = rec.to_color;
        dot.pulse  = 1;
        dot.trail  = [];
        swPushTick(dot.first, dot.grade, rec.to_color);
      })
    .subscribe();
}

function swPushTick(first, grade, to) {
  var fill = SW_PHYSICS[to] ? SW_PHYSICS[to].fill : '#98A2AD';
  var now = Date.now();
  // Block reset flood detection: many Greens arriving within 3 seconds
  if (to === 'Green') {
    SW_STATE._greenFloodCount = (SW_STATE._greenFloodCount || 0) + 1;
    SW_STATE._greenFloodStart = SW_STATE._greenFloodStart || now;
    if (now - SW_STATE._greenFloodStart < 3000 && SW_STATE._greenFloodCount > 5) {
      var ticker = document.getElementById('sw-ticker');
      if (ticker) ticker.innerHTML =
        '<span style="color:#4ABFA3;font-weight:600">Block reset</span>' +
        '<span style="color:var(--text3);margin:0 6px">\u2014</span>' +
        '<span style="color:var(--text3)">All scholars returned to Green</span>';
      return;
    }
  } else {
    SW_STATE._greenFloodCount = 0;
    SW_STATE._greenFloodStart = null;
  }
  SW_STATE.tickLog.unshift({first:first, grade:grade, to:to, fill:fill});
  if (SW_STATE.tickLog.length > 8) SW_STATE.tickLog.pop();
  var tickerEl = document.getElementById('sw-ticker');
  if (!tickerEl) return;
  tickerEl.innerHTML = SW_STATE.tickLog.map(function(t){
    return '<span style="color:'+t.fill+';font-weight:600">'+escHtml(t.first)+'</span>'+
      '<span style="color:var(--text3);font-size:10px;margin:0 4px">'+escHtml(t.grade)+'</span>'+
      '<span style="color:'+t.fill+'">\u2192'+escHtml(t.to)+'</span>'+
      '<span style="color:var(--border);margin:0 8px">\u00B7</span>';
  }).join('');
}

function tickSchoolWide() {
  if (!SW_STATE.running){ SW_STATE.raf=null; return; }
  var cv = document.getElementById('sw-canvas');
  if (!cv){ SW_STATE.raf=null; SW_STATE.running=false; return; }

  var dpr = window.devicePixelRatio||1;
  var W = cv.offsetWidth||340, H = 320;
  cv.width=W*dpr; cv.height=H*dpr; cv.style.height=H+'px';
  var ctx = cv.getContext('2d');
  ctx.scale(dpr,dpr);

  // Temperature-based background -- warms subtly as school heats up
  var total = SW_STATE.allDots.length||1;
  var hot  = SW_STATE.allDots.filter(function(d){return d.color==='Red';}).length;
  var warm = SW_STATE.allDots.filter(function(d){return d.color==='Orange';}).length;
  var mild = SW_STATE.allDots.filter(function(d){return d.color==='Yellow';}).length;
  var heat = Math.min(1,(hot*3+warm*1.5+mild*0.5)/total/0.6);
  var br=Math.round(15+heat*8), bg=Math.round(14-heat*5), bb=Math.round(26-heat*16);
  ctx.fillStyle='rgb('+br+','+bg+','+bb+')';
  ctx.fillRect(0,0,W,H);

  // Dot grid texture
  ctx.fillStyle='rgba(255,255,255,0.020)';
  for(var gx=30;gx<W;gx+=42) for(var gy=30;gy<H;gy+=42){
    ctx.beginPath();ctx.arc(gx,gy,1,0,Math.PI*2);ctx.fill();
  }

  // Update temperature bar
  var tf = document.getElementById('sw-temp-fill');
  if(tf){
    tf.style.width=Math.round(heat*100)+'%';
    tf.style.background=heat<0.3?'#4ABFA3':heat<0.6?'#E8C547':heat<0.85?'#E87D2B':'#D63B3B';
  }
  var tl = document.getElementById('sw-temp-lbl');
  if(tl) tl.textContent=heat<0.15?'Calm':heat<0.4?'Some unrest':heat<0.7?'Elevated':'High alert';

  var counts={Green:0,Yellow:0,Orange:0,Red:0};
  var visSet = new Set(SW_STATE.visibleDots);

  // Physics -- runs on ALL dots so state stays consistent when switching grade filter
  SW_STATE.allDots.forEach(function(d){
    var ph=SW_PHYSICS[d.color];
    var r=d.r;
    var cs=Math.sqrt(d.vx*d.vx+d.vy*d.vy)||.01;
    var ns=cs+(ph.spd-cs)*0.032;
    d.vx=(d.vx/cs)*ns; d.vy=(d.vy/cs)*ns;
    d.vx+=(Math.random()-.5)*ph.wobble;
    d.vy+=(Math.random()-.5)*ph.wobble;
    var s2=Math.sqrt(d.vx*d.vx+d.vy*d.vy)||.01;
    if(s2>ph.maxSpd){d.vx=d.vx/s2*ph.maxSpd;d.vy=d.vy/s2*ph.maxSpd;}
    d.x+=d.vx; d.y+=d.vy;
    if(d.x<r){d.x=r;d.vx=Math.abs(d.vx);d.vy+=(Math.random()-.5)*ph.bSpin;}
    if(d.x>W-r){d.x=W-r;d.vx=-Math.abs(d.vx);d.vy+=(Math.random()-.5)*ph.bSpin;}
    if(d.y<r){d.y=r;d.vy=Math.abs(d.vy);d.vx+=(Math.random()-.5)*ph.bSpin;}
    if(d.y>H-r){d.y=H-r;d.vy=-Math.abs(d.vy);d.vx+=(Math.random()-.5)*ph.bSpin;}
    d.trail.push({x:d.x,y:d.y});
    if(d.trail.length>ph.trailL)d.trail.shift();
  });

  // Elastic collision -- visible dots only for performance
  var vd = SW_STATE.visibleDots;
  for(var i=0;i<vd.length;i++){
    for(var j=i+1;j<vd.length;j++){
      var a=vd[i],b=vd[j];
      var dx=b.x-a.x,dy=b.y-a.y;
      var dist=Math.sqrt(dx*dx+dy*dy);
      var minD=a.r+b.r+0.5;
      if(dist<minD&&dist>0.01){
        var overlap=(minD-dist)/2;
        var nx=dx/dist,ny=dy/dist;
        a.x-=nx*overlap;a.y-=ny*overlap;
        b.x+=nx*overlap;b.y+=ny*overlap;
        var dvx=a.vx-b.vx,dvy=a.vy-b.vy;
        var dot2=dvx*nx+dvy*ny;
        if(dot2>0){a.vx-=dot2*nx;a.vy-=dot2*ny;b.vx+=dot2*nx;b.vy+=dot2*ny;}
      }
    }
  }

  // Render
  SW_STATE.allDots.forEach(function(d){
    var ph=SW_PHYSICS[d.color];
    var r=d.r;
    var vis=visSet.has(d);

    if(!vis){
      // Dim ghost -- spatial presence but not the focus
      ctx.globalAlpha=0.10;
      ctx.beginPath();ctx.arc(d.x,d.y,r*.6,0,Math.PI*2);
      ctx.fillStyle=ph.fill;ctx.fill();
      ctx.globalAlpha=1;
      return;
    }

    // Trail
    if(d.trail.length>2){
      for(var ti=1;ti<d.trail.length;ti++){
        var tf2=ti/d.trail.length;
        var ta=Math.round(tf2*ph.trailA*255).toString(16).padStart(2,'0');
        ctx.beginPath();
        ctx.moveTo(d.trail[ti-1].x,d.trail[ti-1].y);
        ctx.lineTo(d.trail[ti].x,d.trail[ti].y);
        ctx.strokeStyle=ph.fill+ta;
        ctx.lineWidth=r*tf2*1.5;
        ctx.lineCap='round';ctx.stroke();
      }
    }
    // Pulse on transition
    if(d.pulse>0){
      var pr=r+(1-d.pulse)*16;
      var pa=Math.round(d.pulse*128).toString(16).padStart(2,'0');
      ctx.beginPath();ctx.arc(d.x,d.y,pr,0,Math.PI*2);
      ctx.strokeStyle=ph.fill+pa;ctx.lineWidth=1.5;ctx.stroke();
      d.pulse=Math.max(0,d.pulse-.032);
    }
    // Glow for hot colors
    if(ph.glow){
      ctx.beginPath();ctx.arc(d.x,d.y,r+5,0,Math.PI*2);
      ctx.fillStyle=ph.glow;ctx.fill();
    }
    // Grade ring -- identifies grade at a glance
    var ring=SW_GRADE_RING[d.grade]||'#ffffff';
    ctx.beginPath();ctx.arc(d.x,d.y,r+1.8,0,Math.PI*2);
    ctx.strokeStyle=ring+'60';ctx.lineWidth=1.3;ctx.stroke();
    // Main dot
    ctx.beginPath();ctx.arc(d.x,d.y,r,0,Math.PI*2);
    ctx.fillStyle=ph.fill;ctx.fill();
    // Highlight -- soft for cool, sharp for hot
    if(d.color==='Green'||d.color==='Yellow'){
      ctx.beginPath();ctx.arc(d.x-r*.3,d.y-r*.3,r*.46,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.22)';ctx.fill();
    } else {
      ctx.beginPath();ctx.arc(d.x-r*.2,d.y-r*.2,r*.19,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.36)';ctx.fill();
    }
    counts[d.color]++;
  });

  // Update stat counters
  var sg=document.getElementById('sw-sg');if(sg)sg.textContent=counts.Green;
  var sy=document.getElementById('sw-sy');if(sy)sy.textContent=counts.Yellow;
  var so2=document.getElementById('sw-so');if(so2)so2.textContent=counts.Orange;
  var sr=document.getElementById('sw-sr');if(sr)sr.textContent=counts.Red;

  SW_STATE.raf=requestAnimationFrame(tickSchoolWide);
}

// Hover/tap to reveal name
function initSWHover() {
  var wrap = document.getElementById('sw-canvas-wrap');
  var tip  = document.getElementById('sw-tip');
  if (!wrap||!tip) return;
  function findDot(mx,my){
    for(var i=SW_STATE.visibleDots.length-1;i>=0;i--){
      var d=SW_STATE.visibleDots[i];
      var dx=d.x-mx,dy=d.y-my;
      if(Math.sqrt(dx*dx+dy*dy)<d.r+5) return d;
    }
    return null;
  }
  wrap.addEventListener('mousemove',function(e){
    var rect=wrap.getBoundingClientRect();
    var d=findDot(e.clientX-rect.left,e.clientY-rect.top);
    if(d){
      tip.style.display='block';
      tip.style.left=(e.clientX-rect.left)+'px';
      tip.style.top=(e.clientY-rect.top)+'px';
      tip.textContent=d.first+' \u00B7 '+d.grade+(d.grade==='K'?'':d.grade==='1'?'st':d.grade==='2'?'nd':d.grade==='3'?'rd':'th')+' grade';
      wrap.style.cursor='pointer';
    } else {
      tip.style.display='none';
      wrap.style.cursor='default';
    }
  });
  wrap.addEventListener('mouseleave',function(){tip.style.display='none';});
  wrap.addEventListener('touchstart',function(e){
    var touch=e.touches[0];
    var rect=wrap.getBoundingClientRect();
    var d=findDot(touch.clientX-rect.left,touch.clientY-rect.top);
    if(d){
      tip.style.display='block';
      tip.style.left=(touch.clientX-rect.left)+'px';
      tip.style.top=(touch.clientY-rect.top)+'px';
      tip.textContent=d.first+' \u00B7 '+d.grade+' grade';
      setTimeout(function(){tip.style.display='none';},2200);
    }
  },{passive:true});
}

// ── PROFILE DROPDOWN ──
var _profileDropdownInited=false;
function maybeInitProfileDropdown(){
  if(_profileDropdownInited) return;
  _profileDropdownInited=true;
  initProfileDropdown();
}
function initProfileDropdown(){
  var btn=el('btn-profile'), dropdown=el('profile-dropdown');
  if(!btn||!dropdown) return;
  function updateDisplay(){
    var email=SESSION.email||'', short=email.split('@')[0]||'';
    var initial=short.charAt(0).toUpperCase();
    var name=short.replace(/\./g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});
    var pl=el('profile-label'),pi=el('profile-initial'),dn=el('dropdown-name'),de=el('dropdown-email');
    if(pl) pl.textContent=short;
    if(pi) pi.textContent=initial;
    if(dn) dn.textContent=name;
    if(de) de.textContent=email;
    var tl=el('dd-theme-label');
    if(tl) tl.textContent=document.documentElement.getAttribute('data-theme')==='dark'?'Light mode':'Dark mode';
  }
  function openDD(){
    dropdown.style.display='block';
    requestAnimationFrame(function(){dropdown.style.opacity='1';dropdown.style.transform='translateY(0)';});
  }
  function closeDD(){
    dropdown.style.opacity='0';dropdown.style.transform='translateY(-6px)';
    setTimeout(function(){dropdown.style.display='none';},180);
  }
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    var isOpen=dropdown.style.display!=='none'&&dropdown.style.opacity!=='0';
    if(isOpen){closeDD();}else{updateDisplay();openDD();}
  });
  document.addEventListener('click',function(e){
    if(!dropdown.contains(e.target)&&!btn.contains(e.target)&&dropdown.style.display!=='none') closeDD();
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&dropdown.style.display!=='none') closeDD();
  });
  var ddt=el('dd-theme');
  if(ddt) ddt.addEventListener('click',function(){
    toggleTheme();
    var tl=el('dd-theme-label');
    if(tl) tl.textContent=document.documentElement.getAttribute('data-theme')==='dark'?'Light mode':'Dark mode';
    closeDD();
  });
  var ddc=el('dd-csv');
  if(ddc) ddc.addEventListener('click',function(){closeDD();if(typeof exportCSV==='function') exportCSV();});
  var dda=el('dd-alerts');
  if(dda) dda.addEventListener('click',function(){closeDD();setTab('alerts');});
  var dds=el('dd-signout');
  if(dds) dds.addEventListener('click',function(){closeDD();signOut();});
  updateDisplay();
}
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


function skeletonRows(count, widths) {
  var out = '';
  for (var i = 0; i < count; i++) {
    var w = widths ? widths[i % widths.length] : Math.max(30, 90 - i * 5) + '%';
    out += '<div style="padding:10px 8px;border-bottom:1px solid var(--border)">' +
      '<div class="skeleton skeleton-text" style="width:38%;margin-bottom:8px"></div>' +
      '<div class="skeleton skeleton-bar" style="width:' + w + '"></div>' +
    '</div>';
  }
  return out;
}

function skeletonKpis(count) {
  var cards = '';
  for (var i = 0; i < count; i++) cards += '<div class="skeleton skeleton-kpi" style="margin:4px"></div>';
  return '<div class="kpi-grid" style="margin-bottom:12px">' + cards + '</div>';
}

function animateListIn(container) {
  if(!container) return;
  var items = container.querySelectorAll('.li');
  items.forEach(function(item, i) {
    item.classList.add('anim-in');
    item.style.animationDelay = (i * 0.025) + 's';
  });
}

function showToast(message, type, duration) {
  var t = document.getElementById('cp-toast');
  if (t) t.remove();
  t = document.createElement('div');
  t.id = 'cp-toast';
  t.className = 'toast' + (type ? ' toast-' + type : '');
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { t.classList.add('toast-visible'); });
  });
  setTimeout(function() {
    t.classList.remove('toast-visible');
    setTimeout(function() { if (t.parentNode) t.remove(); }, 300);
  }, duration || 3000);
}

function initPullToRefresh(scrollEl, onRefresh) {
  if (!scrollEl || scrollEl._pullRefreshInited) return;
  scrollEl._pullRefreshInited = true;
  var startY = 0, pulling = false, threshold = 80;
  var ind = document.getElementById('pull-indicator');
  scrollEl.addEventListener('touchstart', function(e) {
    if (scrollEl.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  scrollEl.addEventListener('touchmove', function(e) {
    if (!pulling) return;
    var d = e.touches[0].clientY - startY;
    if (d > 30 && ind) { ind.style.display = 'block'; ind.style.opacity = Math.min(d / threshold, 1); }
  }, { passive: true });
  scrollEl.addEventListener('touchend', function(e) {
    if (!pulling) return;
    pulling = false;
    if (ind) { ind.style.display = 'none'; ind.style.opacity = 0; }
    var d = e.changedTouches[0].clientY - startY;
    if (d > threshold) { showToast('Refreshing...', 'info', 1500); onRefresh(); }
    startY = 0;
  });
}

function initSwipeToDismiss(sheetEl, onDismiss) {
  if (!sheetEl || sheetEl._swipeDismissInited) return;
  sheetEl._swipeDismissInited = true;
  var startY = 0, dragging = false;
  sheetEl.addEventListener('touchstart', function(e) {
    startY = e.touches[0].clientY; dragging = true;
    sheetEl.style.transition = 'none';
  }, { passive: true });
  sheetEl.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    var d = e.touches[0].clientY - startY;
    if (d > 0) sheetEl.style.transform = 'translateY(' + d + 'px)';
  }, { passive: true });
  sheetEl.addEventListener('touchend', function(e) {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = 'transform 0.3s ease';
    var d = e.changedTouches[0].clientY - startY;
    if (d > 100) { onDismiss(); setTimeout(function() { sheetEl.style.transform = ''; }, 300); }
    else sheetEl.style.transform = '';
    startY = 0;
  });
}

function updateLogBadge() {
  var count = STATE.logs ? STATE.logs.length : 0;
  var badge = document.getElementById('log-nav-badge');
  if (!badge) {
    var logBtn = document.getElementById('TN-log') || document.getElementById('AN-log');
    if (!logBtn) return;
    logBtn.style.position = 'relative';
    badge = document.createElement('span');
    badge.id = 'log-nav-badge';
    badge.style.cssText = 'position:absolute;top:0;right:6px;background:#BFA95F;color:#271A70;font-size:9px;font-weight:800;border-radius:8px;padding:1px 5px;min-width:14px;text-align:center;line-height:14px;pointer-events:none';
    logBtn.appendChild(badge);
  }
  badge.style.display = count > 0 ? 'block' : 'none';
  badge.textContent = String(count);
}

function filterScholars(query) {
  var q = (query || '').toLowerCase().trim();
  document.querySelectorAll('#admin-body .li[data-stu]').forEach(function(row) {
    row.style.display = (!q || (row.dataset.stu || '').toLowerCase().indexOf(q) !== -1) ? '' : 'none';
  });
}

var _shortcutsInited = false;
function initKeyboardShortcuts() {
  if (_shortcutsInited) return;
  _shortcutsInited = true;
  document.addEventListener('keydown', function(e) {
    if (!SESSION || SESSION.role !== 'admin') return;
    var typing = document.activeElement && ['INPUT','TEXTAREA','SELECT'].indexOf(document.activeElement.tagName) !== -1;
    if (e.key === 'Escape') {
      var eo = document.getElementById('edit-overlay');
      if (eo && eo.classList.contains('show')) { closeEditSheet(); return; }
      var dc = document.getElementById('del-confirm');
      if (dc && dc.classList.contains('show')) { closeDelConfirm(); return; }
    }
    if (typing) return;
    var tabMap = {'1':'overview','2':'timing','3':'students','4':'firstaid','5':'alerts'};
    if (tabMap[e.key] && !e.metaKey && !e.ctrlKey) { setTab(tabMap[e.key]); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      var si = document.getElementById('scholar-search');
      if (si) { si.focus(); si.select(); }
    }
  });
}

function maybeInitShortcuts() {
  initKeyboardShortcuts();
}

function emptyState(message, sub) {
  return '<div style="text-align:center;padding:40px 20px">' +
    '<div style="width:32px;height:32px;border-radius:50%;border:2px solid var(--border);margin:0 auto 14px;opacity:0.4"></div>' +
    '<div style="font-size:14px;font-weight:600;color:var(--text2);margin-bottom:6px">' + escHtml(message) + '</div>' +
    (sub ? '<div style="font-size:12px;color:var(--text3);line-height:1.6">' + escHtml(sub) + '</div>' : '') +
  '</div>';
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
        maybeInitQCPicker();
        maybeInitShortcuts();
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
          maybeInitQCPicker();
          maybeInitShortcuts();
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
          fetchRole(data.user && data.user.id, function(err, role) {
            if (role === 'admin') goAdmin();
            else goTeacher();
          });
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
    'S-quick-color':'TN-qc',
    'S-log':'TN-log'
  };
  document.querySelectorAll('.ni').forEach(function(b){
    b.classList.remove('on');
  });
  var adminNav  = document.getElementById('admin-bnav');
  var teacherNav = document.getElementById('teacher-bnav');
  var isAdminScreen   = ['S-admin','S-classes','S-detail','S-student'].indexOf(screenId) !== -1;
  var isTeacherScreen = ['S-teacher','S-log','S-quick-color'].indexOf(screenId) !== -1;
  if(adminNav)   adminNav.style.display   = isAdminScreen   ? 'flex' : 'none';
  if(teacherNav) teacherNav.style.display = isTeacherScreen ? 'flex' : 'none';
  var activeId=navMap[screenId];
  if(activeId){
    var btn=document.getElementById(activeId);
    if(btn) btn.classList.add('on');
  }
}
function showScreen(id,back){
  var prevScreen=STATE.currentScreen;
  if(prevScreen==='S-admin'&&id!=='S-admin') stopSchoolWide();
  STATE.currentScreen=id;
  document.querySelectorAll('.screen').forEach(function(s){
    if(s.id===id){s.classList.remove('hidden','back');}
    else if(!s.classList.contains('hidden')){if(back)s.classList.add('back');s.classList.add('hidden');}
  });
  updateNavActive(id);
  if(id==='S-admin'&&STATE.adminTab==='overview') {
    setTimeout(function(){ if(!SW_STATE.running) { initSchoolWide(); initSWHover(); } }, 120);
  }
}
function goTeacher(){stopSchoolWide();STATE.entry=freshEntry();STATE.step=0;STATE.myDbLoaded=false;STATE.myDbLogs=[];updateUserDisplay();showScreen('S-teacher');showPane('log');renderStep();updateTeacherNav();updateLogBadge();renderPendingDocQueue();}

function updateTeacherNav(){
  var sw = el('btn-t-switch');
  if(sw) sw.style.display = SESSION.role === 'admin' ? '' : 'none';
}

function goAdmin(){updateUserDisplay();showScreen('S-admin');STATE.adminTab='overview';document.querySelectorAll('#admin-tabs .tab').forEach(function(b){b.classList.toggle('on',b.dataset.tab==='overview');});startNotifPolling();renderAdmin();updateLogBadge();maybeInitProfileDropdown();}
function showPane(pane){
  el('T-log').style.display  = pane==='log'  ? 'flex' : 'none';
  el('T-hist').style.display = pane==='hist' ? 'flex' : 'none';
  el('TN-log').className  = 'ni' + (pane==='log'  ? ' on' : '');
  el('TN-hist').className = 'ni' + (pane==='hist' ? ' on' : '');
  var tnQc = el('TN-qc');
  if (tnQc) tnQc.className = 'ni'; // always deactivate QC when switching panes
  if (pane==='hist') renderHistory();
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
    (STATE.entry.colorChart ?
      '<div class="fg" style="margin-top:10px">'+
        '<label class="fl">Color transition <span style="font-size:11px;color:var(--text3)">(required if chart used)</span></label>'+
        '<div class="chips" id="color-chips">'+
          ['Yellow','Orange','Red'].map(function(c){
            var colors={Yellow:'#BFA95F',Orange:'#d4622a',Red:'#c0392b'};
            var isOn=STATE.entry.colorTransition===c;
            return '<button type="button" class="chip'+(isOn?' on':'')+'" data-color="'+c+'" '+
              'style="border-color:'+colors[c]+';'+(isOn?'background:'+colors[c]+';color:#fff;':'color:'+colors[c]+';')+'">'+
              c+'</button>';
          }).join('')+
        '</div>'+
        '<div class="fg" style="margin-top:10px;'+(STATE.entry.colorTransition?'':'display:none')+'" id="resolved-wrap">'+
          '<div class="tog-row">'+
            '<div><div class="tog-lbl">Resolved — returned to Green</div>'+
            '<div class="tog-sub">Scholar de-escalated and re-engaged</div></div>'+
            '<label class="tog"><input type="checkbox" id="f-resolved"'+(STATE.entry.colorResolved?' checked':'')+'>'+
            '<div class="tog-track"></div><div class="tog-thumb"></div></label>'+
          '</div>'+
        '</div>'+
      '</div>'
    : '')+
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
  var q='select=student_name,homeroom,grade&active=eq.true'+
    (ROSTER_SCHOOL_YEAR?'&school_year=eq.'+encodeURIComponent(ROSTER_SCHOOL_YEAR):'')+
    '&student_name=ilike.*'+encodeURIComponent(query)+'*&order=homeroom.asc,student_name.asc&limit=50';
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

function checkAndNotify(entry, transitionId){
  if(!SESSION.token) return;
  var student=entry.studentName;
  var specials=entry.specials;
  var today=todayStr();
  var incQ='select=*&specials=eq.'+encodeURIComponent(specials)+
    '&incident_date=eq.'+today+'&order=created_at.desc&limit=100';
  var trQ='select=*&specials=eq.'+encodeURIComponent(specials)+
    '&incident_date=eq.'+today+'&order=created_at.desc&limit=100';
  Promise.all([
    authedFetch('/rest/v1/incidents?'+incQ).then(function(r){return r.json();}),
    authedFetch('/rest/v1/color_transitions?'+trQ).then(function(r){return r.json();}).catch(function(){return [];})
  ]).then(function(results){
    var incidents=Array.isArray(results[0])?results[0]:[];
    var transitions=dedupeTransitions(incidents, Array.isArray(results[1])?results[1]:[]);
    var totalToday=incidents.length+transitions.length;
      var notifications=[];
      if(totalToday===4||totalToday===6||totalToday===8){
        notifications.push({
          type:'threshold_alert',
          title:specials+' — '+totalToday+' records today',
          body:totalToday+' behavior records logged in '+specials+' today. Multiple scholars may need support. Consider checking in with '+getSubmitterDisplay(SESSION.email,specials)+'.',
          student:null,
          homeroom:entry.homeroom,
          specials:specials,
          severity:totalToday>=6?'critical':'warning',
          school_year:NOTIF_SCHOOL_YEAR,
          school_id:NOTIF_SCHOOL_ID
        });
      }
      if(entry.colorTransition==='Red'){
        notifications.push({
          type:'color_red',
          title:student+' — reached Red',
          body:student+' ('+entry.homeroom+') reached Red in '+specials+'. Write-up required. Consider preventative check-in before next class period.',
          student:student,
          homeroom:entry.homeroom,
          specials:specials,
          transition_id:transitionId||null,
          severity:'critical',
          school_year:NOTIF_SCHOOL_YEAR,
          school_id:NOTIF_SCHOOL_ID
        });
      }
      var hasPhysical=entry.behaviors&&entry.behaviors.some(function(b){
        return b==='Physical behavior'||b==='Rough Housing / Horseplay';
      });
      if(hasPhysical){
        notifications.push({
          type:'physical',
          title:student+' — physical behavior',
          body:student+' ('+entry.homeroom+') had a physical behavior incident in '+specials+'.',
          student:student,
          homeroom:entry.homeroom,
          specials:specials,
          severity:'warning',
          school_year:NOTIF_SCHOOL_YEAR,
          school_id:NOTIF_SCHOOL_ID
        });
      }
      notifications.forEach(function(n){
        authedFetch('/rest/v1/staff_notifications',{
          method:'POST',
          headers:{'Prefer':'return=minimal'},
          body:JSON.stringify(n)
        }).catch(function(err){console.warn('Notification insert failed',err);});
      });
      if(notifications.length&&SESSION.role==='admin'){
        notifications.forEach(function(n){
          showToast(n.title,n.severity==='critical'?'error':'info',5000);
        });
        fetchNotifications();
      }
    })
    .catch(function(err){console.warn('checkAndNotify fetch failed',err);});
}

function fetchNotifications(cb){
  if(!SESSION.token||SESSION.role!=='admin') return;
  var q='select=*&order=created_at.desc&limit=50&school_year=eq.'+encodeURIComponent(NOTIF_SCHOOL_YEAR);
  authedFetch('/rest/v1/staff_notifications?'+q)
    .then(function(r){return r.json();})
    .then(function(rows){
      STATE.notifRows=Array.isArray(rows)?rows:[];
      STATE.notifLoaded=true;
      updateNotifBadge();
      if(cb) cb(null,STATE.notifRows);
    })
    .catch(function(err){if(cb) cb(err,[]);});
}

function updateNotifBadge(){
  var unread=(STATE.notifRows||[]).filter(function(n){
    return (Array.isArray(n.read_by)?n.read_by:[]).indexOf(SESSION.email)===-1;
  }).length;
  var ddBadge=el('dropdown-notif-badge');
  if(ddBadge){ddBadge.style.display=unread>0?'inline-block':'none';ddBadge.textContent=unread>9?'9+':String(unread);}
  var dot=el('profile-alert-dot');
  if(dot) dot.style.display=unread>0?'block':'none';
  ['notif-badge','alerts-tab-badge'].forEach(function(id){var o=document.getElementById(id);if(o)o.remove();});
}

function startNotifPolling(){
  if(STATE.notifPollTimer) clearInterval(STATE.notifPollTimer);
  fetchNotifications();
  STATE.notifPollTimer=setInterval(fetchNotifications,60000);
}

function markAllNotifsRead(){
  (STATE.notifRows||[]).forEach(function(n){
    var readBy=Array.isArray(n.read_by)?n.read_by:[];
    if(readBy.indexOf(SESSION.email)!==-1) return;
    authedFetch('/rest/v1/staff_notifications?id=eq.'+n.id,{
      method:'PATCH',
      headers:{'Prefer':'return=minimal'},
      body:JSON.stringify({read_by:readBy.concat([SESSION.email])})
    }).catch(function(){});
  });
  (STATE.notifRows||[]).forEach(function(n){
    if(!Array.isArray(n.read_by)) n.read_by=[];
    if(n.read_by.indexOf(SESSION.email)===-1) n.read_by.push(SESSION.email);
  });
  updateNotifBadge();
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
  var fc=el('f-chart');if(fc)fc.addEventListener('change',function(){STATE.entry.colorChart=fc.checked;if(!fc.checked){STATE.entry.colorTransition='';STATE.entry.colorResolved=false;}renderStep();});
  document.querySelectorAll('[data-color]').forEach(function(btn){
    btn.addEventListener('click',function(){
      STATE.entry.colorTransition=btn.dataset.color;
      renderStep();
    });
  });
  var fres=el('f-resolved');if(fres)fres.addEventListener('change',function(){STATE.entry.colorResolved=fres.checked;});
  var fh=el('f-home');if(fh)fh.addEventListener('change',function(){STATE.entry.homeContact=fh.checked;renderStep();});
  document.querySelectorAll('[data-mot]').forEach(function(btn){btn.addEventListener('click',function(){STATE.entry.motivation=STATE.entry.motivation===btn.dataset.mot?'':btn.dataset.mot;renderStep();});});
  document.querySelectorAll('[data-contact]').forEach(function(btn){btn.addEventListener('click',function(){STATE.entry.contactMethod=STATE.entry.contactMethod===btn.dataset.contact?'':btn.dataset.contact;renderStep();});});
  var fn2=el('f-notes');if(fn2)fn2.addEventListener('input',function(){STATE.entry.notes=fn2.value;});
  var s4b=el('s4-back');if(s4b)s4b.addEventListener('click',function(){STATE.step=3;renderStep();});
  var sub=el('s4-sub');
  if(sub)sub.addEventListener('click',function(){
    var e=STATE.entry;
    if(e.colorChart&&!e.colorTransition){alert('Please select a color transition.');return;}
    var extra=[];
    if(e.motivation) extra.push('Motivation: '+e.motivation);
    if(e.homeContact&&e.contactMethod) extra.push('Contact method: '+e.contactMethod);
    var fullNotes=((e.notes||'').trim()+(extra.length?('\n'+extra.join('\n')):'')).trim();
    var row={student:e.studentName,homeroom:e.homeroom,specials:e.specials,subject:e.specials,teacher_role:SESSION.role||'specials',behaviors:e.behaviors.slice(),incident_date:e.date||null,incident_time:e.time||null,color_chart:e.colorChart,home_contact:e.homeContact,notes:fullNotes||null,submitted_by:SESSION.email||'specials-team'};
    var log=Object.assign({},row,{studentName:e.studentName,colorChart:e.colorChart,homeContact:e.homeContact,date:e.date,time:e.time,id:Date.now()});
    STATE.logs.unshift(log);
    updateLogBadge();
    showToast('Incident logged');
    el('sheet-detail').textContent=e.studentName+' · '+e.specials+' · '+(e.behaviors.length?e.behaviors.map(displayBehavior).join(', '):'—');
    el('T-sheet').classList.add('show');el('T-overlay').classList.add('show');
    authedInsert(row).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json().catch(function(){return null;}).then(function(insertedRows){
        var newIncidentId = insertedRows && insertedRows[0] && insertedRows[0].id;
        if(e.colorTransition){
          var transition={
            student:e.studentName,
            homeroom:e.homeroom,
            specials:e.specials,
            from_color:'Green',
            to_color:e.colorTransition,
            incident_date:e.date||todayStr(),
            notes:e.notes||'',
            needs_documentation:false,
            resolved_at:e.colorResolved?new Date().toISOString():null,
            incident_id:newIncidentId||null,
            submitted_by:SESSION.email||'unknown',
            school_year:NOTIF_SCHOOL_YEAR,
            school_id:NOTIF_SCHOOL_ID
          };
          return authedFetch('/rest/v1/color_transitions',{
            method:'POST',
            headers:{'Prefer':'return=representation'},
            body:JSON.stringify(transition)
          }).then(function(tr){
            if(!tr.ok) throw new Error('HTTP '+tr.status);
            return tr.json();
          }).then(function(rows){
            var transitionId=rows&&rows[0]&&rows[0].id;
            checkAndNotify(e,transitionId);
          }).catch(function(err){
            console.warn('Transition insert failed',err);
            checkAndNotify(e,null);
          });
        }
        checkAndNotify(e,null);
      });
    }).catch(function(err){console.warn('Supabase insert failed',err);showToast('Could not connect', 'error');});
  });
}
function closeSheet(){el('T-sheet').classList.remove('show');el('T-overlay').classList.remove('show');STATE.entry=freshEntry();STATE.step=0;renderStep();}

// ── QUICK COLOR ──
var QC_STATE = {
  specials: null,
  roster: [],
  transitions: [],
  activeStudent: null,
  activeTransitionId: null,
};


function goQuickColor(){
  showScreen('S-quick-color');
  updateNavActive('S-quick-color');
  renderQCClassPicker();
  renderPendingDocQueue();
}

function renderQCClassPicker(){
  var wrap = el('qc-class-chips');
  if(!wrap) return;
  var classes = getSubjects().filter(function(c){ return c && c !== 'Support'; });
  wrap.innerHTML = classes.map(function(c){
    var on = QC_STATE.specials === c;
    return '<button class="chip' + (on ? ' on' : '') + '" data-qc-class="' + escAttr(c) + '" ' +
      'style="font-size:12px;padding:6px 14px">' + escHtml(c) + '</button>';
  }).join('');
  wrap.querySelectorAll('[data-qc-class]').forEach(function(btn){
    btn.addEventListener('click', function(){ selectQCClass(btn.dataset.qcClass); });
  });
}

function selectQCClass(specials){
  QC_STATE.specials = specials;
  var sub = el('qc-sub');
  if(sub) sub.textContent = specials + ' \u00B7 ' + todayStr();
  renderQCClassPicker();
  loadQCRoster();
}

function loadQCRoster(){
  var body = el('qc-roster-body');
  if(!body) return;
  if(!QC_STATE.specials){
    body.innerHTML = emptyState('Select a class', 'Choose the class you are currently teaching.');
    return;
  }
  body.innerHTML = skeletonRows(8);

  var today = todayStr();
  authedFetch('/rest/v1/color_transitions?specials=eq.' +
    encodeURIComponent(QC_STATE.specials) +
    '&incident_date=eq.' + today +
    '&select=id,student,to_color,created_at,needs_documentation&order=created_at.asc')
    .then(function(r){ return r.json(); })
    .then(function(transitions){
      var colorMap = {};
      (Array.isArray(transitions) ? transitions : []).forEach(function(t){
        colorMap[t.student] = t.to_color;
      });
      QC_STATE.transitions = Array.isArray(transitions) ? transitions : [];
      updatePendingDocBadge();

      authedFetch('/rest/v1/students?active=eq.true&select=student_name,homeroom&order=last_name.asc,first_name.asc')
        .then(function(r){ return r.json(); })
        .then(function(students){
          QC_STATE.roster = (Array.isArray(students) ? students : []).map(function(s){
            return {
              name: s.student_name,
              homeroom: s.homeroom,
              currentColor: colorMap[s.student_name] || 'Green'
            };
          });
          renderQCRoster();
        });
    })
    .catch(function(){
      if(body) body.innerHTML = emptyState('Could not load roster', 'Check your connection and try again.');
    });
}

function renderQCRoster(){
  var body = el('qc-roster-body');
  if(!body || !QC_STATE.roster.length){
    if(body) body.innerHTML = emptyState('No students found', 'Select a class above to load the roster.');
    return;
  }

  var colorHex = { Green: '#1e7e44', Yellow: '#BFA95F', Orange: '#d4622a', Red: '#c0392b' };

  var searchBar = '<div style="padding:10px 0 12px">' +
    '<input id="qc-search" type="text" placeholder="Search students..." autocomplete="off" autocorrect="off" ' +
    'style="width:100%;padding:11px 14px;border-radius:8px;border:1.5px solid var(--border);font-size:14px;background:var(--panel);color:var(--text);box-sizing:border-box">' +
    '</div>';

  var sorted = QC_STATE.roster.slice().sort(function(a, b){
    var aEsc = a.currentColor !== 'Green' ? 0 : 1;
    var bEsc = b.currentColor !== 'Green' ? 0 : 1;
    if(aEsc !== bEsc) return aEsc - bEsc;
    return a.name.localeCompare(b.name);
  });

  var rows = sorted.map(function(s){
    var dot = colorHex[s.currentColor] || colorHex.Green;
    var esc = s.currentColor !== 'Green';
    return '<div class="li qc-row" data-stu="' + escAttr(s.name) + '" ' +
      'style="padding:12px 8px;display:flex;align-items:center;gap:12px;cursor:pointer;border-bottom:1px solid var(--border)">' +
      '<div style="width:14px;height:14px;border-radius:50%;background:' + dot + ';flex-shrink:0;transition:background 0.2s ease"></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:14px;font-weight:' + (esc ? '700' : '500') + ';color:' + (esc ? 'var(--indigo)' : 'var(--text2)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(s.name) + '</div>' +
        '<div style="font-size:11px;color:var(--text3)">' + escHtml(s.homeroom) + '</div>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;color:' + dot + ';flex-shrink:0">' + escHtml(s.currentColor) + '</div>' +
    '</div>';
  }).join('');

  body.innerHTML = searchBar + '<div id="qc-list">' + rows + '</div>';
  body.querySelectorAll('.qc-row').forEach(function(row){
    row.addEventListener('click', function(){ openQCPicker(row.dataset.stu || ''); });
  });

  var si = el('qc-search');
  if(si){
    si.addEventListener('input', function(){
      var q = this.value.toLowerCase().trim();
      body.querySelectorAll('.qc-row').forEach(function(row){
        row.style.display = (!q || (row.dataset.stu || '').toLowerCase().indexOf(q) !== -1) ? '' : 'none';
      });
    });
    if(window.innerWidth > 768) si.focus();
  }

  animateListIn(body);
}

function openQCPicker(studentName){
  QC_STATE.activeStudent = studentName;
  var student = QC_STATE.roster.find(function(s){ return s.name === studentName; });
  var currentColor = student ? student.currentColor : 'Green';

  var nameEl = el('qc-picker-name');
  var curEl = el('qc-picker-current');
  if(nameEl) nameEl.textContent = studentName;
  if(curEl) curEl.textContent = 'Currently on ' + currentColor;

  var colorHex = { Yellow: '#BFA95F', Orange: '#d4622a', Red: '#c0392b', Green: '#1e7e44' };
  document.querySelectorAll('.qc-color-btn').forEach(function(btn){
    var c = btn.dataset.qc;
    var hex = colorHex[c];
    var isCurrent = c === currentColor;
    btn.style.background = isCurrent ? hex : 'none';
    btn.style.color = isCurrent ? '#ffffff' : hex;
    btn.style.opacity = isCurrent ? '0.45' : '1';
    btn.disabled = isCurrent;
  });

  var picker = el('qc-picker');
  var overlay = el('qc-picker-overlay');
  if(picker) picker.style.display = 'block';
  if(overlay) overlay.style.display = 'block';
}

function closeQCPicker(){
  var picker = el('qc-picker');
  var overlay = el('qc-picker-overlay');
  if(picker) picker.style.display = 'none';
  if(overlay) overlay.style.display = 'none';
  QC_STATE.activeStudent = null;
}

function logQCColor(toColor){
  var studentName = QC_STATE.activeStudent;
  if(!studentName || !QC_STATE.specials) return;

  var student = QC_STATE.roster.find(function(s){ return s.name === studentName; });
  var fromColor = student ? student.currentColor : 'Green';
  closeQCPicker();
  if(toColor === fromColor) return;

  if(student) student.currentColor = toColor;
  renderQCRoster();
  showToast(studentName.split(' ')[0] + ' \u2192 ' + toColor, toColor === 'Green' ? 'success' : 'info', 2000);

  var today = todayStr();
  var autoNote = null;
  var resolvedAt = null;
  if (toColor === 'Green') {
    var now = new Date();
    var timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    autoNote = 'Returned to Green at ' + timeStr + '.' +
      (fromColor && fromColor !== 'Green'
        ? ' De-escalated from ' + fromColor + ' during ' + QC_STATE.specials + '.'
        : '');
    resolvedAt = now.toISOString();
  }

  var transition = {
    student:             studentName,
    homeroom:            student ? student.homeroom : '',
    specials:            QC_STATE.specials,
    from_color:          fromColor,
    to_color:            toColor,
    incident_date:       today,
    notes:               autoNote,
    resolved_at:         resolvedAt,
    needs_documentation: toColor !== 'Green',
    submitted_by:        SESSION.email || 'unknown',
    school_year:         NOTIF_SCHOOL_YEAR,
    school_id:           NOTIF_SCHOOL_ID
  };

  authedFetch('/rest/v1/color_transitions', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(transition)
  }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(rows){
      if(rows && rows[0]){
        QC_STATE.transitions.push(rows[0]);
        // When returning to Green, stamp resolved_at on the most recent
        // open (unresolved, non-green) transition for this student today
        if (toColor === 'Green') {
          var priorOpen = null;
          var priorIdx  = -1;
          QC_STATE.transitions.forEach(function(t, idx) {
            if (t.student === studentName &&
                t.to_color !== 'Green' &&
                !t.resolved_at) {
              priorOpen = t;
              priorIdx  = idx;
            }
          });
          if (priorOpen && priorOpen.id) {
            var resolveTs = new Date().toISOString();
            authedFetch('/rest/v1/color_transitions?id=eq.' + priorOpen.id, {
              method: 'PATCH',
              headers: { 'Prefer': 'return=minimal' },
              body: JSON.stringify({ resolved_at: resolveTs })
            }).then(function() {
              if (priorIdx !== -1) QC_STATE.transitions[priorIdx].resolved_at = resolveTs;
            }).catch(function(err) {
              console.warn('Could not close prior transition', err);
            });
          }
        }
        updatePendingDocBadge();
        renderPendingDocQueue();
        if(toColor === 'Red'){
          checkAndNotify({
            studentName: studentName,
            homeroom: student ? student.homeroom : '',
            specials: QC_STATE.specials,
            behaviors: [],
            colorTransition: 'Red'
          }, rows[0].id);
        }
      }
    })
    .catch(function(){
      showToast('Could not save color change', 'error');
      if(student) student.currentColor = fromColor;
      renderQCRoster();
    });
}

function updatePendingDocBadge(count){
  var pending = typeof count === 'number' ? count : QC_STATE.transitions.filter(function(t){
    return t.needs_documentation;
  }).length;
  var badge = el('qc-doc-badge');
  if(badge){
    badge.style.display = pending > 0 ? 'inline-flex' : 'none';
    badge.textContent = String(pending);
  }
}

// ── PENDING DOCUMENTATION QUEUE ──
function renderPendingDocQueue(){
  var wrap = el('pending-doc-wrap');
  if(!wrap || !SESSION.email) return;

  var today = todayStr();
  authedFetch('/rest/v1/color_transitions?needs_documentation=eq.true' +
    '&submitted_by=eq.' + encodeURIComponent(SESSION.email) +
    '&incident_date=eq.' + today +
    '&select=id,student,specials,to_color,from_color,created_at,homeroom' +
    '&order=created_at.asc')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      rows = Array.isArray(rows) ? rows : [];
      updatePendingDocBadge(rows.length);
      if(!rows.length){ wrap.style.display = 'none'; wrap.innerHTML = ''; return; }

      var colorHex = { Green: '#1e7e44', Yellow: '#BFA95F', Orange: '#d4622a', Red: '#c0392b' };
      wrap.style.display = 'block';
      wrap.innerHTML =
        '<div class="sec" style="margin-top:16px">' +
          'Needs documentation' +
          '<span style="font-size:9px;font-weight:400;color:var(--text3);text-transform:none;letter-spacing:0;margin-left:6px">' +
            rows.length + ' transition' + (rows.length > 1 ? 's' : '') +
          '</span>' +
        '</div>' +
        '<div style="background:var(--gold-lt);border-radius:8px;overflow:hidden;margin-top:8px">' +
        rows.map(function(t){
          var dot = colorHex[t.to_color] || '#98A2AD';
          var time = t.created_at
            ? new Date(t.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '';
          return '<div class="li qc-doc-row" data-transition-id="' + escAttr(t.id) + '" ' +
            'style="padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid rgba(191,169,95,0.2)">' +
            '<div style="width:10px;height:10px;border-radius:50%;background:' + dot + ';flex-shrink:0"></div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:600;color:var(--indigo)">' + escHtml(t.student) + '</div>' +
              '<div style="font-size:11px;color:var(--text3)">' + escHtml(t.specials) + ' \u00B7 ' + escHtml(t.to_color) + ' \u00B7 ' + escHtml(time) + '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--gold-dim);font-weight:600;flex-shrink:0">Add note &#8250;</div>' +
          '</div>';
        }).join('') +
        '</div>';
      wrap.querySelectorAll('.qc-doc-row').forEach(function(row){
        row.addEventListener('click', function(){ openQCDocSheet(row.dataset.transitionId); });
      });
    })
    .catch(function(){ wrap.style.display = 'none'; });
}

// ── RETROACTIVE DOC SHEET ──
function openQCDocSheet(transitionId){
  authedFetch('/rest/v1/color_transitions?id=eq.' + encodeURIComponent(transitionId) + '&select=*&limit=1')
    .then(function(r){ return r.json(); })
    .then(function(rows){
      if(!rows || !rows.length) return;
      var t = rows[0];
      var time = t.created_at
        ? new Date(t.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
      var colorHex = { Green: '#1e7e44', Yellow: '#BFA95F', Orange: '#d4622a', Red: '#c0392b' };

      QC_STATE.activeTransitionId = transitionId;

      var dot = el('qcd-color-dot');
      var stu = el('qcd-student');
      var meta = el('qcd-meta');
      var notes = el('qcd-notes');
      var promote = el('qcd-promote');

      if(dot) dot.style.background = colorHex[t.to_color] || '#98A2AD';
      if(stu) stu.textContent = t.student;
      if(meta) meta.textContent = t.specials + ' \u00B7 moved to ' + t.to_color + ' at ' + time;
      if(notes) notes.value = t.notes || '';
      if(promote){
        promote.dataset.student = t.student;
        promote.dataset.homeroom = t.homeroom || '';
        promote.dataset.specials = t.specials;
        promote.dataset.color = t.to_color;
      }

      var sheet = el('qc-doc-sheet');
      var overlay = el('qcd-overlay');
      if(sheet) sheet.style.display = 'block';
      if(overlay) overlay.style.display = 'block';
      if(notes) setTimeout(function(){ notes.focus(); }, 100);
    })
    .catch(function(){ showToast('Could not load transition', 'error'); });
}

function closeQCDocSheet(){
  var sheet = el('qc-doc-sheet');
  var overlay = el('qcd-overlay');
  if(sheet) sheet.style.display = 'none';
  if(overlay) overlay.style.display = 'none';
  QC_STATE.activeTransitionId = null;
}

function saveQCDoc(){
  var notes = (el('qcd-notes') && el('qcd-notes').value || '').trim();
  if(!notes){ showToast('Write a note before saving', 'error'); return; }
  var id = QC_STATE.activeTransitionId;
  if(!id) return;

  authedFetch('/rest/v1/color_transitions?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ notes: notes, needs_documentation: false })
  }).then(function(r){
    if(!r.ok) throw new Error('HTTP ' + r.status);
    QC_STATE.transitions.forEach(function(t){
      if(String(t.id) === String(id)) t.needs_documentation = false;
    });
    closeQCDocSheet();
    showToast('Note saved');
    renderPendingDocQueue();
  }).catch(function(){ showToast('Could not save note', 'error'); });
}

function promoteToIncident(){
  var btn = el('qcd-promote');
  if(!btn) return;
  var notes = (el('qcd-notes') && el('qcd-notes').value || '').trim();

  closeQCDocSheet();
  goTeacher();

  STATE.entry = freshEntry();
  STATE.entry.studentName = btn.dataset.student || '';
  STATE.entry.homeroom = btn.dataset.homeroom || '';
  STATE.entry.specials = btn.dataset.specials || '';
  STATE.entry.colorChart = true;
  STATE.entry.colorTransition = btn.dataset.color || '';
  STATE.entry.notes = notes;
  STATE.step = 3;
  renderStep();
}

// ── INIT QC PICKER EVENTS (call once) ──
var _qcPickerInited = false;
function maybeInitQCPicker(){
  if(_qcPickerInited) return;
  _qcPickerInited = true;
  document.querySelectorAll('.qc-color-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ logQCColor(btn.dataset.qc); });
  });
  var cancel = el('qc-picker-cancel');
  if(cancel) cancel.addEventListener('click', closeQCPicker);
  var pickerOverlay = el('qc-picker-overlay');
  if(pickerOverlay) pickerOverlay.addEventListener('click', closeQCPicker);
  var qcdOverlay = el('qcd-overlay');
  if(qcdOverlay) qcdOverlay.addEventListener('click', closeQCDocSheet);
}


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
    showToast('Could not connect', 'error');
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
    body.innerHTML='<div class="empty"><div class="empty-t">No logs yet</div><div class="empty-s">Your behavior records will appear here as you log them.</div></div>';
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

  function syncColorWrap(){
    var wrap=el('es-color-wrap');
    var chart=el('es-chart');
    if(wrap&&chart) wrap.style.display=chart.checked?'block':'none';
  }

  var existingTransition=l.colorTransition||'';
  if(!existingTransition&&l.notes){
    var tm=(l.notes||'').match(/Color transition:\s*(Yellow|Orange|Red)/i);
    if(tm) existingTransition=tm[1];
  }
  if(existingTransition) el('es-chart').checked=true;

  var existingResolved=!!(l.colorResolved);
  if(!existingResolved&&l.notes){
    existingResolved=/Returned to Green/i.test(l.notes);
  }

  var colorMap={Yellow:'#BFA95F',Orange:'#d4622a',Red:'#c0392b'};
  ['Yellow','Orange','Red'].forEach(function(color){
    var chip=el('es-color-'+color.toLowerCase());
    if(!chip) return;
    chip.classList.toggle('on',existingTransition===color);
    chip.style.background=existingTransition===color?colorMap[color]:'';
    chip.style.color=existingTransition===color?'#ffffff':colorMap[color];
  });

  var resolvedRow=el('es-resolved-row');
  if(resolvedRow) resolvedRow.style.display=existingTransition?'flex':'none';
  var esResolved=el('es-resolved');
  if(esResolved) esResolved.checked=existingResolved;

  var esChart=el('es-chart');
  if(esChart){
    var newChart=esChart.cloneNode(true);
    newChart.checked=esChart.checked;
    esChart.parentNode.replaceChild(newChart,esChart);
    newChart.addEventListener('change',function(){
      syncColorWrap();
      if(!newChart.checked){
        ['Yellow','Orange','Red'].forEach(function(c){
          var chip=el('es-color-'+c.toLowerCase());
          if(chip){chip.classList.remove('on');chip.style.background='';chip.style.color=colorMap[c];}
        });
        if(resolvedRow) resolvedRow.style.display='none';
        if(esResolved) esResolved.checked=false;
      }
    });
  }

  ['Yellow','Orange','Red'].forEach(function(color){
    var oldChip=el('es-color-'+color.toLowerCase());
    if(!oldChip) return;
    var chip=oldChip.cloneNode(true);
    chip.classList.toggle('on',oldChip.classList.contains('on'));
    chip.style.background=oldChip.style.background;
    chip.style.color=oldChip.style.color;
    oldChip.parentNode.replaceChild(chip,oldChip);
    chip.addEventListener('click',function(){
      var wasOn=chip.classList.contains('on');
      ['Yellow','Orange','Red'].forEach(function(c){
        var ch=el('es-color-'+c.toLowerCase());
        if(ch){ch.classList.remove('on');ch.style.background='';ch.style.color=colorMap[c];}
      });
      if(!wasOn){
        chip.classList.add('on');
        chip.style.background=colorMap[color];
        chip.style.color='#ffffff';
      }
      var anySelected=!!document.querySelector('#es-color-wrap .edit-chip.on');
      if(resolvedRow) resolvedRow.style.display=anySelected?'flex':'none';
      if(!anySelected&&esResolved) esResolved.checked=false;
    });
  });

  syncColorWrap();
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
// Fetches incidents AND color_transitions in parallel and returns a unified
// row list where transitions deduplicated against incidents appear as
// _type='transition' rows. Downstream (buildLiveStats) treats incidents and
// transitions appropriately per metric.
function fetchLiveData(cb){
  var incPromise = authedSelect('select=*&order=created_at.desc&limit=500')
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
  var trPromise = authedFetch('/rest/v1/color_transitions?select=*&order=created_at.desc&limit=500')
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .catch(function(){ return []; });
  Promise.all([incPromise, trPromise])
    .then(function(results){
      var incidents = Array.isArray(results[0]) ? results[0] : [];
      var transitionsRaw = Array.isArray(results[1]) ? results[1] : [];
      var transitions = dedupeTransitions(incidents, transitionsRaw)
        .map(transitionToUnifiedRow);
      // Tag incidents so buildLiveStats can distinguish them.
      incidents.forEach(function(r){ r._type = 'incident'; });
      var merged = incidents.concat(transitions);
      STATE.liveRows = merged;
      STATE.liveLoaded = true;
      STATE.liveError = false;
      updateFreshnessPill();
      if(cb) cb(null, merged);
    })
    .catch(function(err){
      STATE.liveError = true;
      STATE.liveLoaded = true;
      showToast('Could not connect', 'error');
      if(err && err.message && err.message.indexOf('401')>=0) return;
      if(cb) cb(err, null);
    });
}

function buildLiveStats(rows){
  var total = rows.length;
  if(!total) return null;
  // Split: incidents are the source of truth for documentation metrics
  // (chart%, home%) and behavior taxonomy. Transitions count toward
  // overall volume (total, top students/classes, specials, DOW, weekly).
  var incRows = rows.filter(function(r){ return r._type !== 'transition'; });
  var incTotal = incRows.length;
  var chartYes = incRows.filter(function(r){return r.color_chart;}).length;
  var homeYes = incRows.filter(function(r){return r.home_contact;}).length;
  // behavior counts (incidents only — transitions have no behavior taxonomy)
  var behCounts = {};
  incRows.forEach(function(r){
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
    if(!clsMap[k]) clsMap[k]={total:0,incTotal:0,chartY:0,homeY:0,behCounts:{},spCounts:{},stuCounts:{},wkCounts:{}};
    var c=clsMap[k];
    c.total++;
    var isIncident = r._type !== 'transition';
    if(isIncident){
      c.incTotal++;
      if(r.color_chart) c.chartY++;
      if(r.home_contact) c.homeY++;
      (r.behaviors||[]).forEach(function(b){var mapped=displayBehavior(b);c.behCounts[mapped]=(c.behCounts[mapped]||0)+1;});
    }
    if(r.specials) c.spCounts[r.specials]=(c.spCounts[r.specials]||0)+1;
    if(r.student) c.stuCounts[r.student]=(c.stuCounts[r.student]||0)+1;
    var ds=r.incident_date || (r.created_at||'').slice(0,10);
    var d=new Date(ds+'T12:00:00');
    if(!isNaN(d)){var day=d.getDay();var mon=new Date(d);mon.setDate(d.getDate()-(day===0?6:day-1));var lbl=mon.toISOString().slice(0,10);c.wkCounts[lbl]=(c.wkCounts[lbl]||0)+1;}
  });
  var classrooms = {};
  Object.keys(clsMap).forEach(function(k){
    var c=clsMap[k];
    var denom=c.incTotal||1; // avoid /0 when a class has only transitions
    classrooms[k]={
      total:c.total,
      inc_total:c.incTotal,
      chart:c.incTotal?Math.round(c.chartY/denom*100):0,
      home:c.incTotal?Math.round(c.homeY/denom*100):0,
      behaviors:Object.keys(c.behCounts).sort(function(a,b){return c.behCounts[b]-c.behCounts[a];}).map(function(b){return{t:b,n:c.behCounts[b]};}),
      specials:c.spCounts,
      students:Object.keys(c.stuCounts).sort(function(a,b){return c.stuCounts[b]-c.stuCounts[a];}).map(function(s){return{name:s,n:c.stuCounts[s]};}),
      weekly:Object.keys(c.wkCounts).sort().map(function(w){var d=new Date(w+'T12:00:00');var label=isNaN(d)?w:(d.toLocaleString('en-US',{month:'short'})+' '+d.getDate());return{w:label,n:c.wkCounts[w]};})
    };
  });
  var topCls = Object.keys(clsMap).sort(function(a,b){return clsMap[b].total-clsMap[a].total;}).slice(0,15).map(function(k){return{cls:k,n:clsMap[k].total};});
  return {total:total,inc_total:incTotal,chart_yes:chartYes,home_yes:homeYes,behaviors:behaviors,grades:grades,specials:specials,dow:dow,weekly:weekly,top_students:topStudents,classrooms:classrooms,top_cls:topCls,date_range:dateRange,unique_days:uniqueDays,per_day:perDay};
}

// ── ADMIN ──
function setTab(t){var prev=STATE.adminTab;if(prev==='overview'&&t!=='overview') stopSchoolWide();STATE.adminTab=t;document.querySelectorAll('#admin-tabs .tab').forEach(function(b){b.classList.toggle('on',b.dataset.tab===t);});renderAdmin();if(t==='overview') setTimeout(function(){ if(!SW_STATE.running) { initSchoolWide(); initSWHover(); } },100);}

// Interpretation note shown once at top of admin, persists across tabs

function renderAdmin(){
  var body=el('admin-body'),t=STATE.adminTab;
  // Stop school-wide widget when switching away from overview
  if (STATE.adminTab !== 'overview') stopSchoolWide();
  if(!STATE.liveLoaded){
    body.innerHTML=skeletonKpis(4)+skeletonRows(8);
    fetchLiveData(function(){renderAdmin();});
    return;
  }
  var live=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;
  var content='';
  if(t==='overview') content=bOV(live);
  else if(t==='timing'){ content=bTM(live); setTimeout(function(){ wireHeat('all'); },50); }
  else if(t==='students') content=bST(live);
  else if(t==='firstaid') content=bFA();
  else if(t==='alerts') content=bAL();
  else content=bCL(live);
  body.innerHTML=content;
  if(STATE.liveError) body.innerHTML='<div class="alert" style="margin:0">Error: Could not reach Supabase — showing cached data</div>'+body.innerHTML;
  if(t==='students') {
    wireStudentLinks(body,'S-admin');
    if(STATE.liveLoaded) animateListIn(body);
    var si = document.getElementById('scholar-search');
    if (si) {
      si.addEventListener('input', function() { filterScholars(this.value); });
      if (window.innerWidth > 768) si.focus();
    }
  }
  if(t==='alerts') {
    wireStudentLinks(body,'S-admin');
  }
  body.querySelectorAll('[data-alert-tab]').forEach(function(btn){
    btn.addEventListener('click',function(){setTab(btn.dataset.alertTab);});
  });
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
  if(t === 'overview') {
    setTimeout(function() {
      if(!SW_STATE.running) {
        initSchoolWide();
        initSWHover();
      }
    }, 80);
  }
  body.querySelectorAll('[data-cls]').forEach(function(r){r.addEventListener('click',function(){openDet(r.dataset.cls,live);});});
  if(t==='classes') animateListIn(body);
  initPullToRefresh(body, function() {
    STATE.liveLoaded = false;
    STATE.liveError = false;
    renderAdmin();
  });
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
    showToast('Could not load first aid records', 'error');
    if(cb) cb(err, []);
  });
}
function bFA() {
  if (!STATE.firstAidLoaded) {
    fetchFirstAid(function () { renderAdmin(); });
    return skeletonRows(4);
  }
  if (STATE.firstAidError) {
    return '<div class="card">' + emptyState('Could not load records', 'Check your connection and try again.') + '<div style="text-align:center;padding-bottom:20px"><button class="pill" onclick="STATE.firstAidLoaded=false;STATE.firstAidError=false;renderAdmin()">Retry</button></div></div>';
  }

  var all = STATE.firstAidRows || [];
  if (!all.length) return '<div class="card">' + emptyState('No first aid records', 'First aid events will appear here when logged.') + '</div>';

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
              '<span class="fa-chevron log-chevron">▾</span>' +
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

  var kpiContent='<div class="kpi-grid" style="margin-bottom:12px">' +
      kpiH('Total incidents', total, 'all time', false) +
      kpiH('Home contacted', homePct + '%', homeYes + ' of ' + total, homePct < 50) +
      kpiH('Returned to activity', returnPct + '%', returnedYes + ' of ' + total, returnPct < 80) +
    '</div>';
  return buildAcc('fa','kpis','Summary',total+' records',kpiContent,true) +
    buildAcc('fa','log','Incident log','',filterBar + cards,true);
}

// Toggle expand/collapse for a first aid card
function toggleFA(id) {
  var card = document.getElementById(id);
  if (!card) return;
  var detail  = card.querySelector('.fa-detail');
  var chevron = card.querySelector('.fa-chevron');
  var open    = detail.style.display !== 'none';
  detail.style.display  = open ? 'none' : 'block';
  if (chevron) chevron.classList.toggle('open', !open);
  card.style.borderLeft = open ? '' : '2px solid var(--indigo)';
}


function bAL(){
  if(!STATE.notifLoaded){
    fetchNotifications(function(){renderAdmin();});
    return skeletonRows(5);
  }
  var rows=STATE.notifRows||[];
  if(!rows.length) return emptyState('No alerts','Alerts appear here when behavior records cross notification thresholds.');
  markAllNotifsRead();
  var severityColor={critical:'#c0392b',warning:'#BFA95F',info:'#271A70'};
  var severityLabel={critical:'Critical',warning:'Warning',info:'Info'};
  function renderNotifCards(list){
    return list.map(function(n){
      var color=severityColor[n.severity]||'#271A70';
      var label=severityLabel[n.severity]||'Info';
      var time=n.created_at?new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
      var isRead=Array.isArray(n.read_by)&&n.read_by.indexOf(SESSION.email)!==-1;
      return '<div class="card" style="margin-bottom:8px;border-left:3px solid '+color+';opacity:'+(isRead?'0.65':'1')+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">'+
          '<div>'+
            '<span style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:'+color+'">'+escHtml(label)+'</span>'+
            (n.student?'<span style="font-size:10px;color:var(--text3);margin-left:8px">'+escHtml(n.student)+' · '+escHtml(n.homeroom||'')+'</span>':'')+
          '</div>'+
          '<span style="font-size:10px;color:var(--text3);white-space:nowrap;margin-left:8px">'+escHtml(time)+'</span>'+
        '</div>'+
        '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">'+escHtml(n.title)+'</div>'+
        '<div style="font-size:12px;color:var(--text2);line-height:1.6">'+escHtml(n.body)+'</div>'+
        (n.student?
          '<div style="margin-top:10px">'+
            '<button class="pill" style="font-size:10px;padding:4px 10px" data-stu="'+escAttr(n.student)+'">'+
              'View '+escHtml(String(n.student).split(' ')[0])+'\'s profile'+
            '</button>'+
          '</div>'
        :'')+
      '</div>';
    }).join('');
  }
  var critical=rows.filter(function(n){return n.severity==='critical';});
  var warning=rows.filter(function(n){return n.severity==='warning';});
  var info=rows.filter(function(n){return n.severity!=='critical'&&n.severity!=='warning';});
  return (critical.length ? buildAcc('al','critical','Critical',critical.length+' alerts',renderNotifCards(critical),true) : '')+
    (warning.length ? buildAcc('al','warning','Warnings',warning.length+' alerts',renderNotifCards(warning),true) : '')+
    (info.length ? buildAcc('al','info','Info',info.length+' alerts',renderNotifCards(info),false) : '');
}
function bOV(live){
  var criticalUnread=(STATE.notifRows||[]).filter(function(n){
    var readBy=Array.isArray(n.read_by)?n.read_by:[];
    return n.severity==='critical'&&readBy.indexOf(SESSION.email)===-1;
  });
  var alertStrip=criticalUnread.length?
    '<div data-alert-tab="alerts" style="background:#fdf0ef;border-left:3px solid #c0392b;border-radius:8px;padding:10px 14px;margin-bottom:12px;cursor:pointer">'+
      '<div style="font-size:11px;font-weight:700;color:#c0392b;letter-spacing:.04em;margin-bottom:3px">'+
        criticalUnread.length+' unread critical alert'+(criticalUnread.length>1?'s':'')+
      '</div>'+
      '<div style="font-size:12px;color:var(--text2)">'+escHtml(criticalUnread[0].title)+(criticalUnread.length>1?' and '+(criticalUnread.length-1)+' more...':'')+'</div>'+
    '</div>':'';
  var LD=live||{};
  var incTotal=LD.inc_total||0;
  var tot=(LD.total||0)+STATE.logs.length;
  var chartPct=incTotal?Math.round((LD.chart_yes||0)/incTotal*100):0;
  var homePct=incTotal?Math.round((LD.home_yes||0)/incTotal*100):0;
  var dateRange=LD.date_range||'No data';
  var uniqueDays=LD.unique_days||0;
  var perDay=LD.per_day||'—';
  var kpiGrid='<div class="kpi-grid">' +
    kpiH('Behavior records',tot,dateRange,false)+
    kpiH('Per logged day',perDay,uniqueDays+' logged days',false)+
    kpiH('Color chart used',chartPct+'%',(LD.chart_yes||0)+' of '+incTotal+' incidents',false)+
    kpiH('Home contacted',homePct+'%',(LD.home_yes||0)+' of '+incTotal+' incidents',true)+
    '</div>';
  var weeklyCard='<div class="card"><div style="font-size:12px;color:var(--text2);margin-bottom:8px">Weekly records / logged day</div>'+
    '<canvas id="c-wk" height="80" style="width:100%;display:block" data-live="1"></canvas>'+
    '<div style="display:flex;gap:12px;margin-top:8px">'+
    '<span style="font-size:10px;color:var(--text2);display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:2px;background:#271A70;border-radius:1px"></span>Records/logged day</span>'+
    '</div></div>';
  var gradeCard='<div class="card"><canvas id="c-gr" height="100" style="width:100%;display:block"></canvas></div>';
  var behaviorCard='<div class="card">'+
    (function(){var beh=LD.behaviors||[];if(!beh.length)return '<div style="font-size:11px;color:var(--text3);padding:8px 0">No live data yet.</div>';var mx=beh.reduce(function(a,b){return Math.max(a,b.n);},0)||1;return beh.map(function(b,i){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+displayBehavior(b.t)+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;color:'+(b.t==='Unspecified'?'var(--text3)':'var(--text2)')+'">'+b.n+'</span></div>'+pb((b.n/mx)*100,b.t==='Unspecified'?'#98A2AD':BEHAVIOR_COLORS[i%BEHAVIOR_COLORS.length])+'</div>';}).join('');}())+'</div>';
  var subjectCard='<div class="card">'+
    (function(){
      var specList=LD.specials&&LD.specials.length?LD.specials:[];
      if(!specList.length) return '<div style="font-size:11px;color:var(--text3);padding:8px 0">No live data yet.</div>';
      var mx=specList[0].total||1;
      return specList.map(function(s,i){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+subjectBarColor(i)+'">'+s.n+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">'+s.total+'</span></div>'+pb((s.total/mx)*100,subjectBarColor(i))+'</div>';}).join('');
    }())+'</div>';
  var swCard =
    '<div id="sw-canvas-wrap" style="border-radius:10px;overflow:hidden;border:0.5px solid var(--border);position:relative">' +
      '<canvas id="sw-canvas" style="display:block;width:100%" height="320"></canvas>' +
      '<div id="sw-tip" style="display:none;position:absolute;pointer-events:none;' +
        'background:rgba(20,14,60,0.95);border:0.5px solid rgba(191,169,95,0.5);' +
        'color:#fff;font-size:11px;font-weight:600;padding:5px 12px;border-radius:20px;' +
        'white-space:nowrap;transform:translate(-50%,-140%)"></div>' +
    '</div>' +
    '<div style="margin-top:6px;height:3px;border-radius:3px;background:var(--border);overflow:hidden">' +
      '<div id="sw-temp-fill" style="height:100%;border-radius:3px;transition:width .5s ease,background .5s ease;width:0%"></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);padding:2px 0 8px">' +
      '<span>Cool</span><span id="sw-temp-lbl">Calm</span><span>Hot</span>' +
    '</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<div style="flex:1;background:var(--panel);border-radius:8px;padding:5px 8px;text-align:center;border:0.5px solid var(--border)">' +
        '<div style="font-size:15px;font-weight:600;color:#4ABFA3" id="sw-sg">0</div>' +
        '<div style="font-size:9px;color:var(--text3)">Green</div></div>' +
      '<div style="flex:1;background:var(--panel);border-radius:8px;padding:5px 8px;text-align:center;border:0.5px solid var(--border)">' +
        '<div style="font-size:15px;font-weight:600;color:#E8C547" id="sw-sy">0</div>' +
        '<div style="font-size:9px;color:var(--text3)">Yellow</div></div>' +
      '<div style="flex:1;background:var(--panel);border-radius:8px;padding:5px 8px;text-align:center;border:0.5px solid var(--border)">' +
        '<div style="font-size:15px;font-weight:600;color:#E87D2B" id="sw-so">0</div>' +
        '<div style="font-size:9px;color:var(--text3)">Orange</div></div>' +
      '<div style="flex:1;background:var(--panel);border-radius:8px;padding:5px 8px;text-align:center;border:0.5px solid var(--border)">' +
        '<div style="font-size:15px;font-weight:600;color:#D63B3B" id="sw-sr">0</div>' +
        '<div style="font-size:9px;color:var(--text3)">Red</div></div>' +
    '</div>' +
    '<div style="height:26px;border-radius:7px;border:0.5px solid var(--border);background:var(--panel);' +
      'display:flex;align-items:center;padding:0 10px;gap:8px;overflow:hidden">' +
      '<span style="font-size:9px;font-weight:700;color:#BFA95F;text-transform:uppercase;letter-spacing:.08em;flex-shrink:0">Live</span>' +
      '<div style="flex:1;overflow:hidden;white-space:nowrap;font-size:11px" id="sw-ticker">' +
        '<span style="color:var(--text3)">Waiting\u2026</span>' +
      '</div>' +
    '</div>';

  // Grade filter buttons -- built as a string for the accordion meta area
  var swFilters =
    '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-bottom:8px">' +
    ['all','K','1','2','3','4','5'].map(function(g){
      var label = g==='all' ? 'All' : g==='K' ? 'K' : g==='1' ? '1st' : g==='2' ? '2nd' : g==='3' ? '3rd' : g+'th';
      return '<button class="chip sw-fb'+(g==='all'?' on':'')+'" data-g="'+g+'" '+
        'onclick="swSetFilter(\''+g+'\')" style="font-size:11px;padding:3px 10px">'+
        label+
        '</button>';
    }).join('') +
    '<span id="sw-count" style="font-size:10px;color:var(--text3);margin-left:4px"></span>' +
    '</div>';

  return alertStrip +
    buildAcc('ov','live','Live class energy','school-wide \u00B7 real-time', swFilters+swCard, true) +
    buildAcc('ov','kpi','Summary',tot+' records',kpiGrid,false) +
    buildAcc('ov','weekly','Weekly trend','',weeklyCard,false) +
    buildAcc('ov','grade','By grade','',gradeCard,false) +
    buildAcc('ov','behavior','Behavior types','tagged \u00B7 multi-select',behaviorCard,false) +
    buildAcc('ov','subject','By subject','',subjectCard,false);
}
function bTM(live){
  // Data-quality view: only meaningful for full incidents. Quick-color
  // transitions don't carry behavior/chart/home/time fields by design.
  var rows=(STATE.liveRows||[]).filter(function(r){ return r._type !== 'transition'; });
  if(!rows.length){
    return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  }
  var total=rows.length;
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
  var dowContent='<div class="card"><div style="font-size:12px;color:var(--text2);margin-bottom:6px">Incidents per logged incident day · by weekday</div><canvas id="c-dow" height="90" style="width:100%;display:block"></canvas></div>';
  var weeklyContent='<div class="card"><canvas id="c-tm-wk" height="80" style="width:100%;display:block"></canvas></div>';
  var monthContent='<div class="card"><canvas id="c-tm-mo" height="90" style="width:100%;display:block"></canvas></div>';
  var periodContent='<div class="card"><canvas id="c-tm-pd" height="90" style="width:100%;display:block"></canvas></div>';
  var heatContent='<div class="card" id="heat-card" style="overflow-x:auto">'+bHeat('all')+'</div>';
  var compContent='<div class="card">'+fields.map(function(f){
      var p=Math.round(f.n/total*100);
      var c=p>=90?'#271A70':p>=50?'#BFA95F':'#98A2AD';
      return '<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">'+
        '<span>'+f.f+'</span>'+
        '<span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;color:'+c+'">'+p+'%</span>'+
        '</div>'+pb(p,c)+'</div>';
    }).join('')+'</div>';
  return buildAcc('tm','heat','When it happens','by period and day',heatContent,true) +
    buildAcc('tm','dow','Day of week','',dowContent,true) +
    buildAcc('tm','weekly','Weekly trend','',weeklyContent,true) +
    buildAcc('tm','monthly','Monthly totals','',monthContent,true) +
    buildAcc('tm','period','By class block','',periodContent,true) +
    buildAcc('tm','complete','Field completeness','',compContent,false);
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
        ' title="'+p.label+' '+d+': '+v+' record'+(v===1?'':'s')+'">'+
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
      hdr.textContent=period+' · '+HEAT_DAY_FULL[HEAT_DAYS.indexOf(day)]+' — '+list.length+' record'+(list.length===1?'':'s');
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
function bST(live){
  if(!STATE.liveLoaded) return skeletonRows(10, ['95%','87%','80%','73%','65%','57%','50%','43%','36%','28%']);
  var LD=live||{};
  var stuList=LD.top_students&&LD.top_students.length?LD.top_students.filter(function(s){return s.n>=4;}):[];
  var searchHtml='<div style="padding:0 0 14px">' +
    '<input id="scholar-search" type="text" placeholder="Search scholars..." ' +
      'autocomplete="off" autocorrect="off" spellcheck="false" ' +
      'style="width:100%;padding:11px 14px;border-radius:8px;border:1.5px solid var(--border);' +
             'font-size:14px;background:var(--panel);color:var(--text);box-sizing:border-box">' +
  '</div>';
  if(!stuList.length) return searchHtml + '<div class="card">' + emptyState('No scholars meet this threshold', 'Incidents will appear here as data accumulates.') + '</div>';
  var mx=stuList[0].n||1;
  var listContent='<div class="card">'+
    stuList.map(function(s){return '<div class="li" data-scholar-row="1" data-stu="'+escAttr(s.name)+'"><div class="li-c"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><span class="scholar-name">'+stuNameLink(s.name)+'</span><span class="inc-count" style="color:'+scholarBarColor(s.n)+'">'+s.n+'</span></div>'+pb((s.n/mx)*100,scholarBarColor(s.n))+'</div></div>';}).join('')+'</div>';
  return buildAcc('st','list','Scholars with 4+ records',stuList.length+' scholars',searchHtml+listContent,true) +
    buildAcc('st','system','System notes','','',false);
}
function bCL(live){
  var LD=live||{};
  var sorted=(LD.top_cls&&LD.top_cls.length?LD.top_cls:[]).slice().sort(function(a,b){return b.n-a.n;});
  if(!sorted.length) return '<div class="card" style="text-align:center;padding:32px 0;color:var(--text3);font-size:12px">No live data loaded yet.</div>';
  var mx=sorted[0].n||1;
  return '<div class="sec">All classrooms · sorted by record count</div><div class="card">'+
    sorted.map(function(c,i){var det=(LD.classrooms&&LD.classrooms[c.cls])||{};return '<div class="li" data-cls="'+c.cls+'"><div class="li-c"><div class="li-t">'+c.cls+'</div><div class="li-s">Chart: '+(det.chart!=null?det.chart:'—')+'% · Home: '+(det.home!=null?det.home:0)+'%</div>'+pb((c.n/mx)*100,scholarBarColor(c.n))+'</div><div class="li-r inc-count" style="margin-left:10px">'+c.n+'</div><div style="color:var(--text3);font-size:18px"></div></div>';}).join('')+'</div>';
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
    {k:'zero',lb:'Zero records'},
    {k:'four',lb:'4+ records'},
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
      var specHtml=isZero?'<span style="font-size:10px;color:var(--text3)">No records this window</span>':Object.keys(c.specials).filter(function(s){return c.specials[s]>0;}).map(function(s){return '<span style="font-size:10px;background:'+(SC[s]||'var(--text2)')+'22;color:'+(SC[s]||'var(--text3)')+';border-radius:10px;padding:2px 8px">'+s+': '+c.specials[s]+'</span>';}).join('');
      return '<div class="'+cardClass+'" style="cursor:pointer;margin-bottom:8px" data-cls="'+k+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div><div style="font-size:15px;font-weight:600">'+k+'</div><div style="font-size:11px;color:var(--text2);margin-top:2px">'+(isZero?'No records':''+tot+' records')+'</div></div>'+
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
// Exports both full incidents and (deduped) quick-color transitions in
// one CSV with a 'type' column. Transition-specific columns are empty for
// incident rows and vice-versa, so consumers can filter on `type`.
function exportCSV(){
  var btn=el('btn-export');
  if(btn){btn.textContent='[ Exporting… ]';btn.disabled=true;}
  function done(){ if(btn){btn.textContent='Export CSV';btn.disabled=false;} }

  var incPromise = authedFetch('/rest/v1/incidents?select=*&order=incident_date.asc,created_at.asc&limit=2000')
    .then(function(r){ return r.json(); });
  var trPromise = authedFetch('/rest/v1/color_transitions?select=*&order=created_at.asc&limit=2000')
    .then(function(r){ return r.json(); })
    .catch(function(){ return []; });

  Promise.all([incPromise, trPromise]).then(function(results){
    var incidents = Array.isArray(results[0]) ? results[0] : [];
    var transitions = dedupeTransitions(incidents, Array.isArray(results[1]) ? results[1] : []);

    var cols = [
      'type','id','student','homeroom','specials',
      'behaviors','color_chart','home_contact',
      'from_color','to_color','needs_documentation','resolved_at',
      'incident_date','incident_time','notes','submitted_by','created_at'
    ];

    var incRows = incidents.map(function(r){
      return Object.assign({type:'incident'}, r);
    });
    var trRows = transitions.map(function(t){
      return {
        type: 'transition',
        id: t.id,
        student: t.student,
        homeroom: t.homeroom,
        specials: t.specials || '',
        from_color: t.from_color,
        to_color: t.to_color,
        needs_documentation: t.needs_documentation,
        resolved_at: t.resolved_at,
        incident_date: t.incident_date || (t.created_at||'').slice(0,10),
        incident_time: (t.created_at||'').slice(11,16),
        notes: t.notes || '',
        submitted_by: t.submitted_by || '',
        created_at: t.created_at
      };
    });
    var allRows = incRows.concat(trRows);
    allRows.sort(function(a,b){
      var da = new Date(a.created_at||a.incident_date||0);
      var db = new Date(b.created_at||b.incident_date||0);
      return da - db;
    });

    var csv = cols.join(',') + '\n' + allRows.map(function(r){
      return cols.map(function(c){
        var v = r[c];
        if(Array.isArray(v)) v = v.join('; ');
        if(v===null || v===undefined) v = '';
        v = String(v).replace(/"/g, '""');
        return '"' + v + '"';
      }).join(',');
    }).join('\n');

    var blob = new Blob([csv], {type:'text/csv'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'classpulse-records-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    done();
  }).catch(done);
}


// ── FETCH INCIDENTS FOR A CLASSROOM ──
var _homeroomAliasCache = null;

function resolveHomeroom(incidentHomeroom, cb) {
  if (_homeroomAliasCache) {
    cb(_homeroomAliasCache[incidentHomeroom] || incidentHomeroom);
    return;
  }
  authedFetch('/rest/v1/homeroom_aliases?select=incident_homeroom,student_homeroom')
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      _homeroomAliasCache = {};
      (Array.isArray(rows) ? rows : []).forEach(function(row) {
        _homeroomAliasCache[row.incident_homeroom] = row.student_homeroom;
      });
      cb(_homeroomAliasCache[incidentHomeroom] || incidentHomeroom);
    })
    .catch(function() {
      cb(incidentHomeroom);
    });
}

function fetchClassRoster(homeroom, cb){
  resolveHomeroom(homeroom, function(resolvedHomeroom) {
    var q='select=student_name,first_name,last_name&homeroom=eq.'+
      encodeURIComponent(resolvedHomeroom)+
      '&active=eq.true&school_year=eq.'+encodeURIComponent(NOTIF_SCHOOL_YEAR)+
      '&order=last_name.asc,first_name.asc';
    authedFetch('/rest/v1/students?'+q)
      .then(function(r){return r.json();})
      .then(function(rows){cb(null,Array.isArray(rows)?rows:[]);})
      .catch(function(err){cb(err,[]);});
  });
}

function rosterRow(name, incCount, maxCount, hasInc){
  var barWidth=maxCount>0?Math.round((incCount/maxCount)*100):0;
  var barColor=scholarBarColor(incCount);
  return '<div class="li" style="padding:10px 8px">'+
    '<div class="li-c">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
        '<span class="stu-name-link" data-stu="'+escAttr(name)+'" '+
          'style="font-size:14px;font-weight:'+(hasInc?'700':'500')+';'+
          'color:'+(hasInc?'var(--indigo)':'var(--text3)')+'">'+
          escHtml(name)+
        '</span>'+
        '<span style="font-size:13px;font-weight:800;font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;'+
          'color:'+(hasInc?barColor:'var(--text3)')+';flex-shrink:0;margin-left:8px">'+
          (hasInc?incCount+(incCount===1?' record':' records'):'No records')+
        '</span>'+
      '</div>'+
      (hasInc?
        '<div class="pbar" style="height:3px">'+
          '<div class="pfill" style="--pw:'+barWidth+'%;width:var(--pw);background:'+barColor+'"></div>'+
        '</div>':
        '<div style="height:3px;background:var(--border);border-radius:3px;opacity:0.3"></div>')+
    '</div>'+
  '</div>';
}

// Normalize a full incident row to the unified shape consumed by
// renderIncidentList and aggregation code. Mirrors transitionToUnifiedRow.
function incidentToUnifiedRow(r){
  return {
    _type:         'incident',
    id:            r.id,
    student:       r.student,
    homeroom:      r.homeroom,
    specials:      r.specials || r.subject || '',
    subject:       r.subject || r.specials || '',
    date:          r.incident_date || (r.created_at || '').slice(0, 10),
    time:          r.incident_time || (r.created_at || '').slice(11, 16),
    incident_date: r.incident_date || (r.created_at || '').slice(0, 10),
    incident_time: r.incident_time || (r.created_at || '').slice(11, 16),
    created_at:    r.created_at,
    behaviors:     r.behaviors || [],
    color_chart:   r.color_chart,
    home_contact:  r.home_contact,
    notes:         r.notes || '',
    submitted_by:  r.submitted_by || ''
  };
}

// Fetch incidents + color_transitions filtered by a single PostgREST
// predicate (e.g. 'student=eq.Foo' or 'homeroom=eq.K-1'), deduplicate
// transitions against incidents, and return one timeline sorted newest-first.
function fetchUnifiedRecords(predicate, cb){
  if(!SESSION.token){ if(cb) cb(new Error('not authenticated'),[]); return; }
  var incPromise = authedFetch('/rest/v1/incidents?select=*&'+predicate+
    '&order=incident_date.desc,created_at.desc&limit=200')
    .then(function(r){ return r.json(); });
  var trPromise = authedFetch('/rest/v1/color_transitions?select=*&'+predicate+
    '&order=created_at.desc&limit=200')
    .then(function(r){ return r.json(); })
    .catch(function(){ return []; });
  Promise.all([incPromise, trPromise]).then(function(results){
    var incidents = Array.isArray(results[0]) ? results[0] : [];
    var transitionsRaw = Array.isArray(results[1]) ? results[1] : [];
    var transitions = dedupeTransitions(incidents, transitionsRaw);
    var unified = incidents.map(incidentToUnifiedRow)
      .concat(transitions.map(transitionToUnifiedRow));
    unified.sort(function(a, b){
      var da = new Date(a.created_at || a.date);
      var db = new Date(b.created_at || b.date);
      return db - da;
    });
    if(cb) cb(null, unified);
  }).catch(function(err){ if(cb) cb(err, []); });
}

function fetchClassIncidents(homeroom, cb){
  fetchUnifiedRecords('homeroom=eq.'+encodeURIComponent(homeroom), cb);
}

function fetchStudentIncidents(name, cb){
  fetchUnifiedRecords('student=eq.'+encodeURIComponent(name), cb);
}

// ── RENDER INCIDENT LOG LIST (reusable) ──
function renderIncidentList(rows, container, onAfterEdit){
  if(!rows||!rows.length){
    container.innerHTML=emptyState('No behavior records', 'This scholar has no logged specials behavior records.');
    return;
  }
  // group by date
  var grouped={};
  rows.forEach(function(r){
    var k=r.incident_date||r.date||(r.created_at||'').slice(0,10)||'Unknown';
    if(!grouped[k])grouped[k]=[];
    grouped[k].push(r);
  });
  var dates=Object.keys(grouped).sort(function(a,b){return b>a?1:-1;});
  var html=dates.map(function(d){
    var pretty=(function(){try{var dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}catch(e){return d;}})();
    return '<div class="date-grp-hdr">'+pretty+'</div>'+
      grouped[d].map(function(r){
        if(r._type === 'transition'){
          return '<div class="inc-row" style="border-left:3px solid ' + colorFill(r.to_color) + ';padding:10px 12px;margin-bottom:8px;border-radius:0 8px 8px 0;background:var(--panel)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
              '<div style="font-size:12px;font-weight:600;color:var(--text)">' +
                escHtml(r.from_color) + ' \u2192 ' +
                '<span style="color:' + colorFill(r.to_color) + '">' + escHtml(r.to_color) + '</span>' +
              '</div>' +
              '<div style="font-size:11px;color:var(--text3)">' + escHtml(r.specials) + ' \u00B7 ' + escHtml(r.date) + '</div>' +
            '</div>' +
            (r.duration_mins !== null
              ? '<div style="font-size:11px;color:var(--text3);margin-bottom:3px">Duration: ' + r.duration_mins + ' min</div>'
              : '') +
            (r.notes
              ? '<div style="font-size:11px;color:var(--text2)">' + escHtml(r.notes) + '</div>'
              : '') +
            (r.needs_documentation
              ? '<div style="font-size:10px;color:#E87D2B;margin-top:4px;font-weight:600">Needs documentation</div>'
              : '') +
          '</div>';
        }
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
            '<div class="log-time">'+(r.incident_time||r.time||(r.created_at||'').slice(11,16))+'</div>'+
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
  animateListIn(container);
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
        behaviors:row.behaviors||[],date:row.incident_date||row.date,time:row.incident_time||row.time,
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

function initLiveDots(homeroom, rosterRows) {
  var cv = document.getElementById('det-live-canvas');
  if (!cv) return;
  var W = cv.offsetWidth || 320;
  var H = 260;
  var today = todayStr();
  var rows = Array.isArray(rosterRows) ? rosterRows : [];

  authedFetch('/rest/v1/color_transitions?homeroom=eq.' +
    encodeURIComponent(homeroom) +
    '&incident_date=eq.' + encodeURIComponent(today) +
    '&select=student,to_color,created_at,resolved_at&order=created_at.asc')
    .then(function(r) { return r.json(); })
    .then(function(transitions) {
      if (DET_LIVE.homeroom !== homeroom) return;
      // Build colorMap using latest transition per student.
      // resolved_at set = student returned to Green, treat as Green.
      var colorMap = {};
      var latestMap = {};
      (Array.isArray(transitions) ? transitions : []).forEach(function(t) {
        if(t && t.student && DET_PHYSICS[t.to_color]) latestMap[t.student] = t;
      });
      Object.keys(latestMap).forEach(function(name) {
        var t = latestMap[name];
        colorMap[name] = t.resolved_at ? 'Green' : t.to_color;
      });

      var cols = Math.ceil(Math.sqrt((rows.length || 1) * 1.6));
      var cellW = W / cols;
      var cellH = H / Math.ceil((rows.length || 1) / cols);

      DET_LIVE.dots = rows.map(function(s, i) {
        var studentName = s.student_name || '';
        var col = i % cols;
        var row = Math.floor(i / cols);
        var cx  = cellW * col + cellW / 2 + (Math.random() - .5) * cellW * .5;
        var cy  = cellH * row + cellH / 2 + (Math.random() - .5) * cellH * .5;
        var color = colorMap[studentName] || 'Green';
        var ph = DET_PHYSICS[color] || DET_PHYSICS.Green;
        var angle = Math.random() * Math.PI * 2;
        return {
          name:   studentName,
          first:  (studentName.split(' ')[0] || 'Scholar'),
          color:  DET_PHYSICS[color] ? color : 'Green',
          grade:  gradeFromHomeroom(homeroom),
          r:      DET_PHYSICS[color] ? DET_PHYSICS[color].r : 11,
          x:      Math.max(16, Math.min(W - 16, cx)),
          y:      Math.max(16, Math.min(H - 16, cy)),
          vx:     Math.cos(angle) * ph.spd,
          vy:     Math.sin(angle) * ph.spd,
          pulse:  0,
          trail:  []
        };
      });

      // Seed ticker with today's transitions newest-first
      var sorted = (Array.isArray(transitions) ? transitions : []).slice().reverse();
      sorted.slice(0, 8).forEach(function(t) {
        if (t && t.student && t.to_color) addLiveLog(t.student, null, t.to_color);
      });

      DET_LIVE.running = true;
      if (!DET_LIVE.raf) DET_LIVE.raf = requestAnimationFrame(tickLive);
    })
    .catch(function(err) { console.warn('initLiveDots failed', err); });
}

function tickLive() {
  if (!DET_LIVE.running) { DET_LIVE.raf = null; return; }
  var cv = document.getElementById('det-live-canvas');
  if (!cv) { DET_LIVE.raf = null; DET_LIVE.running = false; return; }

  var dpr = window.devicePixelRatio || 1;
  var W = cv.offsetWidth || 320;
  var H = 260;
  cv.width  = W * dpr;
  cv.height = H * dpr;
  cv.style.height = H + 'px';
  var ctx = cv.getContext('2d');
  if (!ctx) { DET_LIVE.raf = requestAnimationFrame(tickLive); return; }
  ctx.scale(dpr, dpr);

  // Temperature-based background - warms as class heats up
  var total = DET_LIVE.dots.length || 1;
  var hot   = DET_LIVE.dots.filter(function(d){ return d.color === 'Red'; }).length;
  var warm  = DET_LIVE.dots.filter(function(d){ return d.color === 'Orange'; }).length;
  var mild  = DET_LIVE.dots.filter(function(d){ return d.color === 'Yellow'; }).length;
  var heat  = Math.min(1, (hot * 3 + warm * 1.5 + mild * 0.5) / total / 0.6);
  var br = Math.round(15 + heat * 8);
  var bg = Math.round(14 - heat * 5);
  var bb = Math.round(26 - heat * 16);
  ctx.fillStyle = 'rgb(' + br + ',' + bg + ',' + bb + ')';
  ctx.fillRect(0, 0, W, H);

  // Dot grid texture
  ctx.fillStyle = 'rgba(255,255,255,0.022)';
  for (var gx = 20; gx < W; gx += 36) {
    for (var gy = 20; gy < H; gy += 36) {
      ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  var counts = { Green: 0, Yellow: 0, Orange: 0, Red: 0 };

  // Physics update
  DET_LIVE.dots.forEach(function(d) {
    var ph = DET_PHYSICS[d.color] || DET_PHYSICS.Green;
    var r  = ph.r;

    var curSpd = Math.sqrt(d.vx * d.vx + d.vy * d.vy) || 0.01;
    var newSpd = curSpd + (ph.spd - curSpd) * 0.04;
    d.vx = (d.vx / curSpd) * newSpd;
    d.vy = (d.vy / curSpd) * newSpd;

    d.vx += (Math.random() - .5) * ph.wobble;
    d.vy += (Math.random() - .5) * ph.wobble;

    var spd2 = Math.sqrt(d.vx * d.vx + d.vy * d.vy) || .01;
    if (spd2 > ph.maxSpd) { d.vx = d.vx / spd2 * ph.maxSpd; d.vy = d.vy / spd2 * ph.maxSpd; }

    d.x += d.vx; d.y += d.vy;

    if (d.x < r)     { d.x = r;     d.vx =  Math.abs(d.vx); d.vy += (Math.random() - .5) * ph.bounceSpin; }
    if (d.x > W - r) { d.x = W - r; d.vx = -Math.abs(d.vx); d.vy += (Math.random() - .5) * ph.bounceSpin; }
    if (d.y < r)     { d.y = r;     d.vy =  Math.abs(d.vy); d.vx += (Math.random() - .5) * ph.bounceSpin; }
    if (d.y > H - r) { d.y = H - r; d.vy = -Math.abs(d.vy); d.vx += (Math.random() - .5) * ph.bounceSpin; }

    d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > ph.trailLen) d.trail.shift();
  });

  // Elastic collision - class-level has fewer dots so full O(n^2) is fine
  var dots = DET_LIVE.dots;
  for (var i = 0; i < dots.length; i++) {
    for (var j = i + 1; j < dots.length; j++) {
      var a = dots[i], b = dots[j];
      var ph_a = DET_PHYSICS[a.color] || DET_PHYSICS.Green;
      var ph_b = DET_PHYSICS[b.color] || DET_PHYSICS.Green;
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var minD = ph_a.r + ph_b.r + 0.5;
      if (dist < minD && dist > 0.01) {
        var overlap = (minD - dist) / 2;
        var nx = dx / dist, ny = dy / dist;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        var dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        var dot = dvx * nx + dvy * ny;
        if (dot > 0) {
          a.vx -= dot * nx; a.vy -= dot * ny;
          b.vx += dot * nx; b.vy += dot * ny;
        }
      }
    }
  }

  // Render
  var GRADE_RING = {K:'#8B7BE0','1':'#4ABFA3','2':'#E8C547','3':'#E87D2B','4':'#D63B3B','5':'#BFA95F'};

  DET_LIVE.dots.forEach(function(d) {
    var ph = DET_PHYSICS[d.color] || DET_PHYSICS.Green;
    var r  = ph.r;

    // Trail
    if (d.trail.length > 2) {
      for (var ti = 1; ti < d.trail.length; ti++) {
        var tf = ti / d.trail.length;
        var alpha = Math.round(tf * ph.trailAlpha * 255).toString(16).padStart(2, '0');
        ctx.beginPath();
        ctx.moveTo(d.trail[ti - 1].x, d.trail[ti - 1].y);
        ctx.lineTo(d.trail[ti].x, d.trail[ti].y);
        ctx.strokeStyle = ph.fill + alpha;
        ctx.lineWidth = r * tf * 1.5;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // Pulse on color change
    if (d.pulse > 0) {
      var pr = r + (1 - d.pulse) * 20;
      var palpha = Math.round(d.pulse * 160).toString(16).padStart(2, '0');
      ctx.beginPath();
      ctx.arc(d.x, d.y, pr, 0, Math.PI * 2);
      ctx.strokeStyle = ph.fill + palpha;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      d.pulse = Math.max(0, d.pulse - 0.035);
    }

    // Hot glow for orange and red
    if (ph.glow) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, r + 5, 0, Math.PI * 2);
      ctx.fillStyle = ph.glow;
      ctx.fill();
    }

    // Grade ring - tells you which grade at a glance
    var ring = GRADE_RING[d.grade] || 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, r + 1.8, 0, Math.PI * 2);
    ctx.strokeStyle = ring + '60';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Main dot
    ctx.beginPath();
    ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
    ctx.fillStyle = ph.fill;
    ctx.fill();

    // Highlight - soft for cool, sharp for hot
    if (d.color === 'Green' || d.color === 'Yellow') {
      ctx.beginPath();
      ctx.arc(d.x - r * .3, d.y - r * .3, r * .46, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(d.x - r * .22, d.y - r * .22, r * .2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fill();
    }

    counts[d.color] = (counts[d.color] || 0) + 1;
  });

  DET_LIVE.raf = requestAnimationFrame(tickLive);
}

function initDetLiveHover() {
  var wrap = document.getElementById('det-live-wrap');
  var cv   = document.getElementById('det-live-canvas');
  if (!wrap || !cv) return;
  if (wrap._hoverInited) return;
  wrap._hoverInited = true;

  if (!wrap.style.position) wrap.style.position = 'relative';

  // Build a floating tooltip inside det-live-wrap
  var tip = document.createElement('div');
  tip.style.cssText = 'display:none;position:absolute;pointer-events:none;' +
    'background:rgba(20,14,60,0.95);border:0.5px solid rgba(191,169,95,0.5);' +
    'color:#fff;font-size:11px;font-weight:600;padding:5px 12px;' +
    'border-radius:20px;white-space:nowrap;transform:translate(-50%,-140%);z-index:10';
  wrap.appendChild(tip);

  function findDot(mx, my) {
    var dots = DET_LIVE.dots;
    for (var i = dots.length - 1; i >= 0; i--) {
      var d = dots[i];
      var ph = DET_PHYSICS[d.color] || DET_PHYSICS.Green;
      var dx = d.x - mx, dy = d.y - my;
      if (Math.sqrt(dx * dx + dy * dy) < ph.r + 6) return d;
    }
    return null;
  }

  cv.addEventListener('mousemove', function(e) {
    var rect = cv.getBoundingClientRect();
    var d = findDot(e.clientX - rect.left, e.clientY - rect.top);
    if (d) {
      tip.style.display = 'block';
      tip.style.left = (e.clientX - rect.left) + 'px';
      tip.style.top  = (e.clientY - rect.top) + 'px';
      tip.textContent = d.name;
      cv.style.cursor = 'pointer';
    } else {
      tip.style.display = 'none';
      cv.style.cursor = 'default';
    }
  });
  cv.addEventListener('mouseleave', function() { tip.style.display = 'none'; });
  cv.addEventListener('touchstart', function(e) {
    var touch = e.touches[0];
    var rect  = cv.getBoundingClientRect();
    var d = findDot(touch.clientX - rect.left, touch.clientY - rect.top);
    if (d) {
      tip.style.display = 'block';
      tip.style.left = (touch.clientX - rect.left) + 'px';
      tip.style.top  = (touch.clientY - rect.top) + 'px';
      tip.textContent = d.name;
      setTimeout(function() { tip.style.display = 'none'; }, 2200);
    }
  }, { passive: true });
}

function startLiveColorChannel(homeroom) {
  if (typeof supabase.setAuthToken === 'function') supabase.setAuthToken(SESSION.token);
  if (DET_LIVE.channel) {
    try { supabase.removeChannel(DET_LIVE.channel); } catch (e) {}
    DET_LIVE.channel = null;
  }

  var channel = supabase
    .channel('color-transitions-' + homeroom)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'color_transitions'
      },
      function(payload) {
        var rec = payload.new;
        if (!rec || !rec.student || !rec.to_color || !DET_PHYSICS[rec.to_color]) return;
        // Filter client-side — same pattern as school-wide channel
        if (rec.homeroom !== DET_LIVE.homeroom) return;

        var dot = null;
        for (var i = 0; i < DET_LIVE.dots.length; i++) {
          if (DET_LIVE.dots[i].name === rec.student) { dot = DET_LIVE.dots[i]; break; }
        }
        if (!dot) return;

        var prev = dot.color;
        dot.color = rec.to_color;
        dot.pulse = 1;

        addLiveLog(rec.student, prev, rec.to_color);

        var first = rec.student.split(' ')[0];
        showToast(first + ' \u2192 ' + rec.to_color,
          rec.to_color === 'Red' ? 'error' : rec.to_color === 'Green' ? 'success' : 'info',
          3000);
      }
    )
    .subscribe();

  DET_LIVE.channel = channel;
}

function stopLiveColorChannel() {
  if (DET_LIVE.channel) {
    try { supabase.removeChannel(DET_LIVE.channel); } catch (e) {}
    DET_LIVE.channel = null;
  }
  DET_LIVE.running = false;
  if (DET_LIVE.raf) { cancelAnimationFrame(DET_LIVE.raf); DET_LIVE.raf = null; }
  DET_LIVE.dots = [];
  DET_LIVE.homeroom = null;
}

function addLiveLog(student, from, to) {
  var log = document.getElementById('det-live-log');
  if (!log) return;

  // Block reset flood detection — many Greens arriving within 3 seconds
  if (to === 'Green') {
    DET_LIVE._greenFloodCount = (DET_LIVE._greenFloodCount || 0) + 1;
    DET_LIVE._greenFloodStart = DET_LIVE._greenFloodStart || Date.now();
    if (Date.now() - DET_LIVE._greenFloodStart < 3000 && DET_LIVE._greenFloodCount > 3) {
      log.textContent = '';
      log.dataset.seeded = '1';
      var summary = document.createElement('span');
      summary.style.cssText = 'display:inline-flex;align-items:center;gap:5px;color:#4ABFA3;font-weight:600';
      summary.textContent = 'Block reset \u2014 class returned to Green';
      log.appendChild(summary);
      return;
    }
  } else {
    DET_LIVE._greenFloodCount = 0;
    DET_LIVE._greenFloodStart = null;
  }

  var fill = DET_PHYSICS[to] ? DET_PHYSICS[to].fill : '#98A2AD';
  var first = escHtml((student || '').split(' ')[0]);

  // Clear placeholder text on first real entry
  if (log.dataset.seeded !== '1') {
    log.textContent = '';
    log.dataset.seeded = '1';
  }

  // Inline ticker entry — newest first
  var entry = document.createElement('span');
  entry.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:10px;flex-shrink:0';
  entry.innerHTML =
    '<span style="font-weight:600;color:' + fill + '">' + first + '</span>' +
    '<span style="color:var(--text3)">\u2192</span>' +
    '<span style="color:' + fill + ';font-weight:600">' + escHtml(to) + '</span>';

  log.insertBefore(entry, log.firstChild);
  while (log.children.length > 12) log.removeChild(log.lastChild);
}


function openDet(id,live){
  stopLiveColorChannel();
  var LD=live||{};
  var c=LD.classrooms&&LD.classrooms[id];
  var isZero=!c||c.total===0;
  var backBtn=el('btn-det-back');
  if(backBtn) backBtn.textContent=DET_PREV_SCREEN==='S-teacher'?'‹ My Logs':'‹ Classes';
  el('det-title').textContent=id;
  el('det-sub').textContent=isZero?'No records logged':c.total+' records · Chart: '+c.chart+'% · Home: '+c.home+'%';

  if(isZero){
    el('det-body').innerHTML=
      buildAcc('det', 'live', 'Live class view', 'real-time color states',
        '<div id="det-live-wrap" style="border-radius:10px;overflow:hidden;border:0.5px solid var(--border);position:relative">' +
          '<canvas id="det-live-canvas" style="width:100%;display:block" height="260"></canvas>' +
        '</div>' +
        '<div id="det-live-ticker" style="margin-top:6px;height:26px;border-radius:7px;' +
          'border:0.5px solid var(--border);background:var(--panel);' +
          'display:flex;align-items:center;padding:0 10px;gap:8px;overflow:hidden">' +
          '<span style="font-size:9px;font-weight:700;color:#BFA95F;text-transform:uppercase;' +
            'letter-spacing:.08em;flex-shrink:0">Live</span>' +
          '<div id="det-live-log" style="flex:1;overflow:hidden;white-space:nowrap;font-size:11px;' +
            'color:var(--text3)">Waiting\u2026</div>' +
        '</div>',
        true
      )+
      '<div class="card">' + emptyState('No records for this class', 'Behavior records will appear as teachers log them.') + '</div>'+
      '<div style="height:16px"></div>';
    wireStudentLinks(el('det-body'),'S-detail');
    animateListIn(el('det-body'));
    showScreen('S-detail');
    setTimeout(function(){
      fetchClassRoster(id,function(err,rosterRows){
        if(err) return;
        resolveHomeroom(id, function(resolvedId) {
          DET_LIVE.homeroom = resolvedId;
          initLiveDots(resolvedId, rosterRows);
          startLiveColorChannel(resolvedId);
          initDetLiveHover();
        });
      });
    },60);
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
    kpiH('Behavior records',c.total,'specials logs',false)+
    kpiH('Chart used',c.chart+'%','',c.chart<30)+
    kpiH('Home contact',c.home+'%','',c.home===0)+
    '<div class="kpi"><div class="lbl">Subjects logged</div><div class="val">'+Object.keys(c.specials).filter(function(k){return c.specials[k]>0;}).length+'</div></div></div>'+
    '<div class="sec">Behavior types</div><div class="card">'+
    c.behaviors.map(function(b,i){return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+displayBehavior(b.t)+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">'+b.n+'</span></div>'+pb((b.n/mxB)*100,BEHAVIOR_COLORS[i%BEHAVIOR_COLORS.length])+'</div>';}).join('')+'</div>'+
    buildAcc('det', 'live', 'Live class view', 'real-time color states',
      '<div id="det-live-wrap" style="border-radius:10px;overflow:hidden;border:0.5px solid var(--border);position:relative">' +
        '<canvas id="det-live-canvas" style="width:100%;display:block" height="260"></canvas>' +
      '</div>' +
      '<div id="det-live-ticker" style="margin-top:6px;height:26px;border-radius:7px;' +
        'border:0.5px solid var(--border);background:var(--panel);' +
        'display:flex;align-items:center;padding:0 10px;gap:8px;overflow:hidden">' +
        '<span style="font-size:9px;font-weight:700;color:#BFA95F;text-transform:uppercase;' +
          'letter-spacing:.08em;flex-shrink:0">Live</span>' +
        '<div id="det-live-log" style="flex:1;overflow:hidden;white-space:nowrap;font-size:11px;' +
          'color:var(--text3)">Waiting\u2026</div>' +
      '</div>',
      true
    )+
    buildAcc('det','roster','Class roster','Loading...','<div id="det-roster-wrap">'+skeletonRows(8)+'</div>',true)+
    '<div class="sec">By subject</div><div class="card">'+
    Object.keys(c.specials).map(function(s,i){var n=c.specials[s],col=subjectBarColor(i);return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+col+'">'+s+'</span><span style="font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">'+n+'</span></div>'+pb((n/mxSP)*100,col)+'</div>';}).join('')+'</div>'+
    '<div class="sec">Weekly trend</div><div class="card"><canvas id="c-det-wk" height="80" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec" style="display:flex;justify-content:space-between;align-items:center">'+
    'All behavior records'+
    '<span style="font-size:10px;color:var(--text3);font-family:Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;letter-spacing:.04em" id="det-inc-count">loading…</span>'+
    '</div>'+
  '<div id="det-inc-list" style="margin-bottom:16px">' + skeletonRows(6) + '</div>'+
  '<div style="height:16px"></div>';

  wireStudentLinks(el('det-body'),'S-detail');
  showScreen('S-detail');
  setTimeout(function(){
    drawLine('c-det-wk',c.weekly.map(function(w){return w.w;}),c.weekly.map(function(w){return w.n;}));
    fetchClassRoster(id,function(err,rosterRows){
      var wrap=document.getElementById('det-roster-wrap');
      if(!wrap) return;
      // c.students now includes transitions via the unified live data
      // pipeline (buildLiveStats), so no separate transition fetch needed.
      var counts={};
      var maxInc=0;
      if(c&&c.students){
        c.students.forEach(function(s){
          counts[s.name]=s.n;
          if(s.n>maxInc) maxInc=s.n;
        });
      }
      if(err||!rosterRows.length){
        var fallback=c&&c.students?c.students:[];
        wrap.innerHTML='<div class="card">'+
          (fallback.length?fallback.map(function(s){return rosterRow(s.name,s.n,maxInc,true);}).join(''):emptyState('No scholars on record',''))+
          '</div>';
        var fallbackMeta=document.querySelector('#acc-chev-det-roster');
        if(fallbackMeta){
          var fallbackHdr=fallbackMeta.closest('.acc-hdr')&&fallbackMeta.closest('.acc-hdr').querySelector('.acc-meta');
          if(fallbackHdr) fallbackHdr.textContent=fallback.length+' scholars with behavior records';
        }
        wireStudentLinks(wrap,'S-detail');
        return;
      }
      var totalInClass=rosterRows.length;
      var withRecords=rosterRows.filter(function(r){return counts[r.student_name]>0;}).length;
      var rosterHeader='<div style="display:flex;justify-content:space-between;align-items:center;'+
        'padding:0 0 10px;border-bottom:1px solid var(--border);margin-bottom:8px">'+
        '<div style="font-size:12px;color:var(--text2)">'+totalInClass+' scholars in class</div>'+
        '<div style="font-size:12px;color:var(--text2)">'+withRecords+' with behavior records · '+
          (totalInClass-withRecords)+' record-free</div>'+
        '</div>';
      rosterRows.sort(function(a,b){
        var an=counts[a.student_name]||0;
        var bn=counts[b.student_name]||0;
        if(bn!==an) return bn-an;
        return (a.last_name||'').localeCompare(b.last_name||'');
      });
      wrap.innerHTML='<div class="card">'+rosterHeader+
        rosterRows.map(function(r){
          var n=counts[r.student_name]||0;
          return rosterRow(r.student_name,n,maxInc,n>0);
        }).join('')+
        '</div>';
      var accMeta=document.querySelector('#acc-chev-det-roster');
      if(accMeta){
        var hdrLeft=accMeta.closest('.acc-hdr')&&accMeta.closest('.acc-hdr').querySelector('.acc-meta');
        if(hdrLeft) hdrLeft.textContent=totalInClass+' scholars · '+withRecords+' with behavior records';
      }
      wireStudentLinks(wrap,'S-detail');
      animateListIn(wrap);
      resolveHomeroom(id, function(resolvedId) {
        DET_LIVE.homeroom = resolvedId;
        initLiveDots(resolvedId, rosterRows);
        startLiveColorChannel(resolvedId);
        initDetLiveHover();
      });
    });
    // fetch and render individual incidents
    fetchClassIncidents(id, function(err, rows){
      var countEl=el('det-inc-count');
      var listEl=el('det-inc-list');
      if(!listEl)return;
      if(err||!rows){
        if(listEl) listEl.innerHTML=emptyState('Could not load records', 'Check your connection and try again.');
        showToast('Could not connect', 'error');
        return;
      }
      if(countEl) countEl.textContent=rows.length+' records';
      if(!rows.length){
        listEl.innerHTML=emptyState('No records for this class', 'Behavior records will appear as teachers log them.');
        return;
      }
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
var bae=el('btn-a-signout');    if(bae) bae.addEventListener('click',signOut);
var btt=el('btn-theme-toggle'); if(btt) btt.addEventListener('click',toggleTheme);
var bte=el('btn-export');       if(bte) bte.addEventListener('click',exportCSV);
var btn2=el('btn-notif');       if(btn2) btn2.addEventListener('click',function(){setTab('alerts');});
var bal=el('btn-a-log');        if(bal) bal.addEventListener('click',goTeacher);
var anDash=el('AN-dash');       if(anDash) anDash.addEventListener('click',function(){ if(SESSION.role!=='admin') return; goAdmin(); });
el('btn-t-switch').addEventListener('click',function(){ if(SESSION.role==='admin') goAdmin(); });
el('btn-th-switch').addEventListener('click',function(){ if(SESSION.role==='admin') goAdmin(); });
el('TN-log').addEventListener('click',function(){
  if (STATE.currentScreen !== 'S-teacher') {
    goTeacher();
  } else {
    showPane('log');
  }
});
var tnQc = el('TN-qc');
if(tnQc) tnQc.addEventListener('click', goQuickColor);
var btnQcBack = el('btn-qc-back');
if (btnQcBack) btnQcBack.addEventListener('click', function() {
  showPane('log');
  showScreen('S-teacher', true);
});
el('TN-hist').addEventListener('click',function(){
  if (STATE.currentScreen !== 'S-teacher') {
    showScreen('S-teacher');
    showPane('hist');
  } else {
    showPane('hist');
  }
});
el('T-overlay').addEventListener('click',closeSheet);
el('btn-log-another').addEventListener('click',closeSheet);
el('AN-classes').addEventListener('click',function(){ if(SESSION.role!=='admin') return; STATE.clsFilter='all';showScreen('S-classes');renderClsExplorer(STATE.liveRows.length?buildLiveStats(STATE.liveRows):null);});
el('AN-log').addEventListener('click',goTeacher);
el('btn-cls-back').addEventListener('click',function(){showScreen('S-admin',true);if(STATE.adminTab==='overview') setTimeout(function(){ if(!SW_STATE.running) { initSchoolWide(); initSWHover(); } },100);});
el('btn-det-back').addEventListener('click',function(){
  stopLiveColorChannel();
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
initSwipeToDismiss(document.getElementById('edit-sheet'), closeEditSheet);
initSwipeToDismiss(document.getElementById('del-confirm'), closeDelConfirm);

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
  var selectedColorChip=document.querySelector('#es-color-wrap .edit-chip.on');
  var editColorTransition=selectedColorChip?selectedColorChip.dataset.ec:'';
  var editColorResolved=!!(el('es-resolved')&&el('es-resolved').checked);
  if(editColorTransition){
    var colorNote='Color transition: '+editColorTransition;
    if(editColorResolved) colorNote+=' → Returned to Green';
    var existingNotes=(updates.notes||'').replace(/\nColor transition:.*$/m,'').trim();
    updates.notes=(existingNotes?existingNotes+'\n':'')+colorNote;
  }
  if(!updates.student){status.textContent='Scholar name required';status.style.color='var(--red)';return;}

  function resetSaveBtn(){saveBtn.textContent='Save changes';saveBtn.disabled=false;}
  function onSaved(){
    var cb=EDIT_STATE.onAfterEdit;
    resetSaveBtn();
    closeEditSheet();
    showToast('Changes saved');
    if(editColorTransition&&EDIT_STATE.dbId){
      var transition={
        student:updates.student,
        homeroom:updates.homeroom,
        specials:updates.specials,
        from_color:'Green',
        to_color:editColorTransition,
        resolved_at:editColorResolved?new Date().toISOString():null,
        incident_id:parseInt(EDIT_STATE.dbId,10),
        notes:updates.notes||'',
        submitted_by:SESSION.email||'unknown',
        school_year:NOTIF_SCHOOL_YEAR,
        school_id:NOTIF_SCHOOL_ID
      };
      authedFetch('/rest/v1/color_transitions',{
        method:'POST',
        headers:{'Prefer':'return=minimal'},
        body:JSON.stringify(transition)
      }).catch(function(err){console.warn('Transition insert from edit failed',err);});
    }
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
      showToast('Could not connect', 'error');
    });
  } else {
    // session-only log
    STATE.logs=STATE.logs.map(function(l){
      if(('s-'+l.id)===EDIT_STATE.uid){
        return Object.assign({},l,{studentName:updates.student,homeroom:updates.homeroom,specials:updates.specials,behaviors:updates.behaviors,date:updates.incident_date,time:updates.incident_time,colorChart:updates.color_chart,colorTransition:editColorTransition,colorResolved:editColorResolved,homeContact:updates.home_contact,notes:updates.notes});
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
    showToast('Incident deleted', 'info');
    if(cb){ try{cb();}catch(e){console.error(e);} }
    else renderHistory();
  }).catch(function(){
    resetDeleteBtn();
    closeDelConfirm();
    showToast('Could not connect', 'error');
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
      SESSION.role = role;
      maybeInitQCPicker();
      maybeInitShortcuts();
      if(role==='admin') goAdmin(); else goTeacher();
    });
  }).catch(function(err){
    errEl.textContent = err.message||'Something went wrong';
    btn.textContent='Activate account'; btn.disabled=false;
  });
});

if(typeof window !== 'undefined'){
  window.saveQCDoc = saveQCDoc;
  window.promoteToIncident = promoteToIncident;
  window.closeQCDocSheet = closeQCDocSheet;
}

initPwa();
initFreshness();

export {
  SESSION, STATE, ALL_CLASSES, BAND_LABELS, BEHAVIORS, HOMEROOMS, SER, SC,
  todayStr, nowStr, freshEntry,
  saveSession, loadSession, refreshSession, signOut,
  initLogin, fetchRole,
  authedFetch, authedInsert, authedSelect,
  fetchLiveData, buildLiveStats, fetchClassIncidents, fetchStudentIncidents, renderIncidentList,
  drawLine, drawBar, wireChartTooltip, pb, subjectBarColor,
  wireHeatCard, buildAcc, handleAccClick,
  openEditSheet, closeEditSheet, populateEditSheet, openDelConfirm, closeDelConfirm,
  renderStep, goTeacher, showPane, closeSheet, renderHistory, fetchMyLogs,
  goAdmin, renderAdmin, setTab, bOV, bAL, bTM, bST, bCL,
  initSchoolWide, swSetFilter, stopSchoolWide, startSchoolWideChannel, swPushTick, tickSchoolWide, initSWHover,
  renderClsExplorer, filterClasses, openDet, showScreen, escHtml,
  openStudent, wireStudentLinks, stuNameLink, setStuPrevScreen, getStuPrevScreen, displayBehavior,
  skeletonRows, skeletonKpis, animateListIn, showToast, emptyState,
  goQuickColor, renderQCClassPicker, selectQCClass, loadQCRoster, renderQCRoster,
  openQCPicker, closeQCPicker, logQCColor, updatePendingDocBadge, renderPendingDocQueue,
  openQCDocSheet, closeQCDocSheet, saveQCDoc, promoteToIncident, maybeInitQCPicker
};
