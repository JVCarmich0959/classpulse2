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
    sessionStorage.setItem('sb_token', token);
    sessionStorage.setItem('sb_email', email);
    if(userId) sessionStorage.setItem('sb_uid', userId);
    if(refresh) sessionStorage.setItem('sb_refresh', refresh);
  }catch(e){}
}
function loadSession(){
  try{
    var t=sessionStorage.getItem('sb_token');
    var e=sessionStorage.getItem('sb_email');
    var u=sessionStorage.getItem('sb_uid');
    var rf=sessionStorage.getItem('sb_refresh');
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
var D = {"total":248,"weekly":[{"w":"Jan W4","r":7.67,"n":23},{"w":"Jan W5","r":8.75,"n":35},{"w":"Feb W6","r":2.0,"n":6},{"w":"Feb W7","r":5.6,"n":28},{"w":"Feb W8","r":3.5,"n":14},{"w":"Feb W9","r":5.25,"n":21},{"w":"Mar W10","r":7.2,"n":36},{"w":"Mar W11","r":2.4,"n":12},{"w":"Mar W12","r":5.0,"n":20},{"w":"Mar W13","r":7.4,"n":37},{"w":"Apr W14","r":5.33,"n":16}],"grades":[{"g":"Kinder","n":60},{"g":"5th","n":49},{"g":"2nd","n":37},{"g":"4th","n":37},{"g":"1st","n":29},{"g":"3rd","n":29}],"specials":[{"n":"PE","total":99},{"n":"Technology","total":95},{"n":"Art","total":34},{"n":"Music","total":19}],"behaviors":[{"t":"Verbal disruption","n":76},{"t":"Noncompliance","n":65},{"t":"Off-task","n":61},{"t":"Emotional distress","n":59},{"t":"Peer conflict","n":51},{"t":"Physical behavior","n":36},{"t":"Out of seat","n":29},{"t":"Device misuse","n":12},{"t":"Sleeping/disengaged","n":8},{"t":"Unspecified","n":6}],"dow":[{"d":"Monday","r":5.89},{"d":"Tuesday","r":4.78},{"d":"Wednesday","r":8.0},{"d":"Thursday","r":4.11},{"d":"Friday","r":5.38}],"chart_yes":102,"home_yes":35,"top_students":[{"name":"London German","n":9},{"name":"Austin Crowder","n":8},{"name":"Eternity Deitz-Hutchison","n":5},{"name":"Gabriel Smith","n":5},{"name":"Jaxon Anderson","n":5},{"name":"Kaiden Horlback","n":4},{"name":"Osiel Lopez","n":4},{"name":"Ibrie Stanley","n":4},{"name":"Chester King","n":4},{"name":"Kamarri Douglas","n":4},{"name":"Dominic Hardy","n":4},{"name":"Lafayette Joyner","n":4},{"name":"Vincent Newberry","n":4},{"name":"Mila Moran","n":4},{"name":"Foster Langdon","n":4}],"top_cls":[{"cls":"5th-Smith","n":22},{"cls":"4th-Edwards","n":22},{"cls":"2nd-Clark","n":22},{"cls":"K-Wing","n":19},{"cls":"5th-Davis","n":18},{"cls":"K-Fortner","n":17},{"cls":"1st-Smith","n":12},{"cls":"3rd-Mello","n":12},{"cls":"3rd-Danis/McClain","n":11},{"cls":"2nd-Kennedy","n":11},{"cls":"5th-Coles","n":9},{"cls":"2nd-Ham","n":8},{"cls":"4th-Dohar","n":8},{"cls":"4th-Bridgers","n":7},{"cls":"K-McCormick","n":7}],"classrooms":{"1st-Beckett":{"total":5,"chart":60,"home":0,"behaviors":[{"t":"Verbal disruption","n":2},{"t":"Noncompliance","n":1},{"t":"Out of seat","n":1},{"t":"Sleeping/disengaged","n":1},{"t":"Peer conflict","n":1}],"specials":{"Technology":2,"PE":2,"Art":1},"students":[{"name":"Lucas Pulley","n":2},{"name":"Seneca Jackson","n":2},{"name":"Infinity Deitz-Hutchison","n":1}],"weekly":[{"w":"Jan W4","n":2},{"w":"Mar W13","n":2},{"w":"Apr W14","n":1}]},"1st-Cosetti":{"total":6,"chart":33,"home":17,"behaviors":[{"t":"Noncompliance","n":3},{"t":"Verbal disruption","n":2},{"t":"Sleeping/disengaged","n":1},{"t":"Off-task","n":1},{"t":"Device misuse","n":1}],"specials":{"Technology":3,"Art":3},"students":[{"name":"Tyon Buckner","n":3},{"name":"James Champion","n":1},{"name":"Zayana Fisher","n":1}],"weekly":[{"w":"Jan W4","n":1},{"w":"Feb W8","n":1},{"w":"Feb W9","n":1},{"w":"Mar W10","n":1},{"w":"Mar W13","n":1},{"w":"Apr W14","n":1}]},"1st-Smith":{"total":12,"chart":25,"home":17,"behaviors":[{"t":"Verbal disruption","n":4},{"t":"Peer conflict","n":4},{"t":"Noncompliance","n":3},{"t":"Emotional distress","n":2},{"t":"Off-task","n":1},{"t":"Physical behavior","n":1}],"specials":{"PE":6,"Technology":4,"Music":2},"students":[{"name":"Sophia Cherry","n":3},{"name":"Tiwuan Hardy","n":3},{"name":"Reigna Prensa","n":1},{"name":"Other","n":5}],"weekly":[{"w":"Jan W4","n":1},{"w":"Jan W5","n":3},{"w":"Feb W9","n":3},{"w":"Mar W10","n":3},{"w":"Mar W11","n":1},{"w":"Apr W14","n":1}]},"1st-Worsely":{"total":6,"chart":17,"home":17,"behaviors":[{"t":"Off-task","n":4},{"t":"Noncompliance","n":2},{"t":"Peer conflict","n":1},{"t":"Out of seat","n":1},{"t":"Verbal disruption","n":1}],"specials":{"Art":3,"Technology":2,"Music":1},"students":[{"name":"Juelz Crawford","n":2},{"name":"Kailee Williams","n":2},{"name":"Delilah Zeigler","n":1},{"name":"Barrett Boutte","n":1}],"weekly":[{"w":"Feb W7","n":2},{"w":"Mar W10","n":1},{"w":"Apr W14","n":3}]},"2nd-Clark":{"total":22,"chart":59,"home":18,"behaviors":[{"t":"Verbal disruption","n":8},{"t":"Off-task","n":8},{"t":"Emotional distress","n":8},{"t":"Noncompliance","n":7},{"t":"Physical behavior","n":4},{"t":"Peer conflict","n":3}],"specials":{"PE":10,"Technology":10,"Music":1,"Art":1},"students":[{"name":"Austin Crowder","n":8},{"name":"Mila Moran","n":4},{"name":"Noah Hartman","n":2},{"name":"Eli Gonzalez","n":2},{"name":"Other","n":6}],"weekly":[{"w":"Jan W5","n":4},{"w":"Feb W7","n":1},{"w":"Feb W8","n":1},{"w":"Feb W9","n":3},{"w":"Mar W10","n":2},{"w":"Mar W11","n":4},{"w":"Mar W12","n":1},{"w":"Mar W13","n":5},{"w":"Apr W14","n":1}]},"2nd-Ham":{"total":8,"chart":62,"home":25,"behaviors":[{"t":"Peer conflict","n":2},{"t":"Emotional distress","n":2},{"t":"Physical behavior","n":2},{"t":"Out of seat","n":1},{"t":"Off-task","n":1},{"t":"Noncompliance","n":1}],"specials":{"Technology":4,"PE":4},"students":[{"name":"Kaiden Horlback","n":4},{"name":"Aurelia Gonzalez","n":1},{"name":"Travis Oates","n":1},{"name":"Ava Cumberlander","n":1},{"name":"Isaiah Calcek","n":1}],"weekly":[{"w":"Jan W4","n":1},{"w":"Jan W5","n":1},{"w":"Feb W6","n":1},{"w":"Feb W7","n":1},{"w":"Mar W10","n":3},{"w":"Mar W11","n":1}]},"2nd-Kennedy":{"total":11,"chart":18,"home":9,"behaviors":[{"t":"Emotional distress","n":5},{"t":"Peer conflict","n":5},{"t":"Verbal disruption","n":3},{"t":"Physical behavior","n":3},{"t":"Out of seat","n":2},{"t":"Noncompliance","n":2}],"specials":{"PE":5,"Art":3,"Music":2,"Technology":1},"students":[{"name":"Lafayette Joyner","n":4},{"name":"Avangeline King","n":1},{"name":"Avalynn Lawson","n":1},{"name":"Other","n":5}],"weekly":[{"w":"Feb W7","n":3},{"w":"Feb W9","n":1},{"w":"Mar W10","n":3},{"w":"Mar W12","n":2},{"w":"Mar W13","n":2}]},"2nd-Pollard":{"total":5,"chart":0,"home":0,"behaviors":[{"t":"Verbal disruption","n":2},{"t":"Emotional distress","n":1},{"t":"Off-task","n":1},{"t":"Noncompliance","n":1},{"t":"Peer conflict","n":1}],"specials":{"PE":3,"Technology":2},"students":[{"name":"Brandon Richardson","n":2},{"name":"Travis","n":1},{"name":"Henry Brown","n":1},{"name":"Jordan Jones","n":1}],"weekly":[{"w":"Jan W4","n":2},{"w":"Mar W10","n":1},{"w":"Mar W13","n":1},{"w":"Apr W14","n":1}]},"3rd-Danis/McClain":{"total":11,"chart":18,"home":27,"behaviors":[{"t":"Off-task","n":2},{"t":"Out of seat","n":2},{"t":"Verbal disruption","n":1},{"t":"Peer conflict","n":1},{"t":"Emotional distress","n":1}],"specials":{"Technology":5,"PE":3,"Music":1,"Art":1},"students":[{"name":"Ayden Bazemore","n":2},{"name":"Trace Corum","n":2},{"name":"Colton Whitt","n":1},{"name":"Alexia Hernandez","n":1},{"name":"Travis Oates","n":1}],"weekly":[{"w":"Jan W4","n":6},{"w":"Feb W7","n":1},{"w":"Feb W9","n":1},{"w":"Mar W13","n":2},{"w":"Apr W14","n":1}]},"3rd-Jones":{"total":6,"chart":50,"home":0,"behaviors":[{"t":"Noncompliance","n":3},{"t":"Verbal disruption","n":1},{"t":"Device misuse","n":1},{"t":"Off-task","n":1},{"t":"Peer conflict","n":1}],"specials":{"Technology":3,"PE":2,"Art":1},"students":[{"name":"King Artist","n":2},{"name":"Kameron Batts","n":1},{"name":"Harper Hall","n":1},{"name":"Arayah Boutte","n":1},{"name":"Oliva Sugg","n":1}],"weekly":[{"w":"Jan W5","n":1},{"w":"Feb W7","n":1},{"w":"Mar W12","n":3},{"w":"Mar W13","n":1}]},"3rd-Mello":{"total":12,"chart":33,"home":25,"behaviors":[{"t":"Peer conflict","n":7},{"t":"Verbal disruption","n":6},{"t":"Noncompliance","n":5},{"t":"Emotional distress","n":4},{"t":"Physical behavior","n":2},{"t":"Out of seat","n":2}],"specials":{"PE":4,"Music":3,"Art":3,"Technology":2},"students":[{"name":"Chester King","n":4},{"name":"Ezra Morado","n":3},{"name":"Maya Spriggs","n":2},{"name":"Noah Thomas","n":1},{"name":"Issac Uzzell","n":1}],"weekly":[{"w":"Jan W5","n":2},{"w":"Feb W6","n":2},{"w":"Feb W7","n":3},{"w":"Feb W8","n":1},{"w":"Mar W10","n":1},{"w":"Mar W12","n":2},{"w":"Mar W13","n":1}]},"4th-Bridgers":{"total":7,"chart":14,"home":0,"behaviors":[{"t":"Emotional distress","n":4},{"t":"Peer conflict","n":3},{"t":"Noncompliance","n":1}],"specials":{"PE":3,"Art":2,"Technology":1,"Music":1},"students":[{"name":"Indi Coley","n":2},{"name":"Kymere McCoy","n":1},{"name":"Gideon Allen","n":1},{"name":"Other","n":3}],"weekly":[{"w":"Jan W4","n":3},{"w":"Feb W6","n":1},{"w":"Mar W10","n":3}]},"4th-Dohar":{"total":8,"chart":88,"home":38,"behaviors":[{"t":"Physical behavior","n":4},{"t":"Verbal disruption","n":3},{"t":"Emotional distress","n":2},{"t":"Noncompliance","n":1},{"t":"Peer conflict","n":1},{"t":"Off-task","n":1}],"specials":{"PE":6,"Technology":2},"students":[{"name":"Braxton Wrestler","n":3},{"name":"Declan Costello","n":2},{"name":"Mattix Mooring","n":1},{"name":"Travonte Coley","n":1},{"name":"Chavar Prince","n":1}],"weekly":[{"w":"Jan W5","n":4},{"w":"Mar W10","n":3},{"w":"Apr W14","n":1}]},"4th-Edwards":{"total":22,"chart":36,"home":14,"behaviors":[{"t":"Verbal disruption","n":7},{"t":"Off-task","n":6},{"t":"Peer conflict","n":5},{"t":"Noncompliance","n":4},{"t":"Emotional distress","n":4},{"t":"Out of seat","n":2}],"specials":{"Technology":10,"Art":6,"PE":6},"students":[{"name":"London German","n":9},{"name":"Ibrie Stanley","n":4},{"name":"Doll Brown","n":2},{"name":"Connor Sigmund","n":1},{"name":"Other","n":6}],"weekly":[{"w":"Jan W4","n":2},{"w":"Jan W5","n":1},{"w":"Feb W7","n":4},{"w":"Feb W9","n":3},{"w":"Mar W11","n":3},{"w":"Mar W12","n":3},{"w":"Mar W13","n":3},{"w":"Apr W14","n":3}]},"5th-Coles":{"total":9,"chart":33,"home":0,"behaviors":[{"t":"Off-task","n":4},{"t":"Emotional distress","n":3},{"t":"Verbal disruption","n":2},{"t":"Physical behavior","n":2},{"t":"Noncompliance","n":2},{"t":"Sleeping/disengaged","n":1}],"specials":{"PE":6,"Technology":1,"Art":1,"Music":1},"students":[{"name":"Elijah Sanders","n":2},{"name":"Lacey Musser","n":1},{"name":"Kendra Champion","n":1},{"name":"Other","n":5}],"weekly":[{"w":"Jan W5","n":1},{"w":"Feb W6","n":1},{"w":"Feb W7","n":2},{"w":"Mar W10","n":5}]},"5th-Davis":{"total":18,"chart":28,"home":0,"behaviors":[{"t":"Verbal disruption","n":7},{"t":"Peer conflict","n":6},{"t":"Off-task","n":6},{"t":"Noncompliance","n":5},{"t":"Physical behavior","n":3},{"t":"Out of seat","n":2}],"specials":{"Technology":9,"PE":8,"Music":1},"students":[{"name":"Osiel Lopez","n":4},{"name":"Liam Howell","n":4},{"name":"Jeremiah Edwards","n":2},{"name":"Sophia Ponce","n":2},{"name":"Kaitlyn Sigmon","n":2}],"weekly":[{"w":"Jan W4","n":1},{"w":"Jan W5","n":6},{"w":"Feb W8","n":4},{"w":"Mar W12","n":3},{"w":"Mar W13","n":2},{"w":"Apr W14","n":2}]},"5th-Smith":{"total":22,"chart":32,"home":23,"behaviors":[{"t":"Verbal disruption","n":9},{"t":"Noncompliance","n":6},{"t":"Off-task","n":5},{"t":"Peer conflict","n":4},{"t":"Emotional distress","n":3},{"t":"Device misuse","n":2}],"specials":{"Technology":11,"PE":8,"Art":3},"students":[{"name":"Gabriel Smith","n":6},{"name":"Reagan Best","n":3},{"name":"Braiden Roa","n":1},{"name":"Bentley Coletrane","n":1},{"name":"Other","n":11}],"weekly":[{"w":"Jan W4","n":1},{"w":"Jan W5","n":1},{"w":"Feb W7","n":3},{"w":"Feb W8","n":2},{"w":"Feb W9","n":4},{"w":"Mar W10","n":2},{"w":"Mar W12","n":2},{"w":"Mar W13","n":7}]},"EC":{"total":6,"chart":67,"home":17,"behaviors":[{"t":"Emotional distress","n":3},{"t":"Off-task","n":2},{"t":"Noncompliance","n":2},{"t":"Physical behavior","n":2},{"t":"Sleeping/disengaged","n":1},{"t":"Verbal disruption","n":1}],"specials":{"PE":4,"Art":2},"students":[{"name":"Vincent Newberry","n":4},{"name":"Cally Boseman","n":1},{"name":"Wizdom Grantham","n":1}],"weekly":[{"w":"Feb W6","n":1},{"w":"Feb W7","n":2},{"w":"Mar W10","n":1},{"w":"Mar W11","n":1},{"w":"Mar W13","n":1}]},"K-Fortner":{"total":17,"chart":47,"home":6,"behaviors":[{"t":"Emotional distress","n":8},{"t":"Off-task","n":6},{"t":"Noncompliance","n":6},{"t":"Verbal disruption","n":5},{"t":"Physical behavior","n":5},{"t":"Out of seat","n":4}],"specials":{"Technology":7,"PE":7,"Art":2,"Music":1},"students":[{"name":"Jaxon Anderson","n":5},{"name":"Kamarri Douglas","n":4},{"name":"Knowledge Grantham","n":3},{"name":"Jaxson Anderson","n":3},{"name":"Caleb Carter","n":1}],"weekly":[{"w":"Jan W4","n":1},{"w":"Jan W5","n":3},{"w":"Feb W7","n":1},{"w":"Feb W9","n":2},{"w":"Mar W10","n":2},{"w":"Mar W11","n":2},{"w":"Mar W12","n":1},{"w":"Mar W13","n":5}]},"K-Helms":{"total":6,"chart":50,"home":0,"behaviors":[{"t":"Verbal disruption","n":4},{"t":"Noncompliance","n":4},{"t":"Emotional distress","n":2},{"t":"Device misuse","n":2},{"t":"Sleeping/disengaged","n":1},{"t":"Out of seat","n":1}],"specials":{"Technology":3,"PE":2,"Music":1},"students":[{"name":"Trayvon Williams","n":4},{"name":"Acestin Britton","n":1},{"name":"Dontae Champion","n":1}],"weekly":[{"w":"Feb W7","n":1},{"w":"Feb W8","n":1},{"w":"Feb W9","n":1},{"w":"Mar W10","n":2},{"w":"Mar W12","n":1}]},"K-McCormick":{"total":7,"chart":57,"home":0,"behaviors":[{"t":"Off-task","n":4},{"t":"Verbal disruption","n":2},{"t":"Emotional distress","n":1},{"t":"Physical behavior","n":1}],"specials":{"PE":5,"Music":1,"Technology":1},"students":[{"name":"Monroe Bush","n":2},{"name":"Emilia Fishman","n":1},{"name":"Brielle Haskill","n":1},{"name":"Christopher Jackson","n":1},{"name":"Montonio Hall","n":1}],"weekly":[{"w":"Jan W5","n":2},{"w":"Mar W10","n":3},{"w":"Mar W13","n":1},{"w":"Apr W14","n":1}]},"K-Wing":{"total":19,"chart":63,"home":21,"behaviors":[{"t":"Verbal disruption","n":6},{"t":"Out of seat","n":6},{"t":"Off-task","n":5},{"t":"Noncompliance","n":5},{"t":"Device misuse","n":3},{"t":"Physical behavior","n":3}],"specials":{"Technology":12,"Music":3,"PE":3,"Art":1},"students":[{"name":"Eternity Deitz-Hutchison","n":5},{"name":"Dominic Hardy","n":4},{"name":"Foster Langdon","n":4},{"name":"Alivia Best","n":1},{"name":"Nathaniel Freedman","n":1}],"weekly":[{"w":"Jan W4","n":2},{"w":"Jan W5","n":3},{"w":"Feb W7","n":3},{"w":"Feb W8","n":4},{"w":"Feb W9","n":2},{"w":"Mar W12","n":2},{"w":"Mar W13","n":3}]}}};

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

var BEHAVIORS=['Verbal disruption','Noncompliance','Off-task','Emotional distress','Peer conflict','Physical behavior','Out of seat','Device misuse'];
var SPECIALS=['PE','Technology','Art','Music']; // fallback only — use getSpecials()
var HOMEROOMS=ALL_CLASSES;
var SER=['#00e6c8','#f0c040','#ff4466','#a78bfa','#34d399','#f97316','#60a5fa','#4d6490'];
var SC={'PE':'#00e6c8','Technology':'#a78bfa','Art':'#f0c040','Music':'#ff4466','P.E.':'#00e6c8'};

var STATE={step:0,entry:null,logs:[],myDbLogs:[],myDbLoaded:false,adminTab:'overview',clsFilter:'all',liveRows:[],liveLoaded:false,liveError:false,currentScreen:'S-login'};
var STU_PREV_SCREEN='S-detail';
function setStuPrevScreen(v){ STU_PREV_SCREEN=v||'S-detail'; }
function getStuPrevScreen(){ return STU_PREV_SCREEN||'S-detail'; }
function todayStr(){return new Date().toISOString().split('T')[0];}
function nowStr(){var d=new Date();return d.toTimeString().slice(0,5);}
function freshEntry(){return{studentName:'',homeroom:'',specials:'',behaviors:[],date:todayStr(),time:nowStr(),colorChart:false,homeContact:false,notes:''};}
function el(id){return document.getElementById(id);}
function pb(pct,col){return '<div class="pbar"><div style="--pw:'+Math.min(pct,100)+'%;background:'+col+'" class="pfill"></div></div>';}
function alrt(t){return '<div class="alert"><span style="flex-shrink:0">⚠</span><span>'+t+'</span></div>';}
function kpiH(lb,v,sub,flag){return '<div class="kpi'+(flag?' flag':'')+'"><div class="lbl">'+lb+'</div><div class="val" style="color:'+(flag?'var(--red)':'var(--text)')+'">'+v+'</div><div class="sub">'+sub+'</div></div>';}

// ── FRESHNESS STRIP ──
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
      if(p) p.textContent=rows.length+' rows';
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
    updateUserDisplay();
    fetchRole(SESSION.userId, function(err, role){
      SESSION.role = role;
      if(role === 'admin'){ goAdmin(); } else { goTeacher(); }
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
        btnLogin.textContent='[ Authenticate ]';
        btnLogin.disabled=false;
      }
    }).catch(function(){
      errEl.textContent = 'Network error — check connection';
      btnLogin.textContent = '[ Authenticate ]';
      btnLogin.disabled = false;
    });
  });

  fPass.addEventListener('keydown', function(e){ if(e.key==='Enter') btnLogin.click(); });
}


// ── SIGN OUT ──
function signOut(){
  SESSION.token = null; SESSION.email = null; SESSION.userId = null; SESSION.role = null; SESSION.refresh = null;
  try{sessionStorage.removeItem('sb_token');sessionStorage.removeItem('sb_email');sessionStorage.removeItem('sb_uid');sessionStorage.removeItem('sb_refresh');}catch(e){}
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
    fresh.textContent = '[ Authenticate ]';
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
          fresh.textContent='[ Authenticate ]'; fresh.disabled=false;
        }
      }).catch(function(){
        errEl.textContent = 'Network error — check connection';
        fresh.textContent = '[ Authenticate ]'; fresh.disabled = false;
      });
    });
    fPass.addEventListener('keydown', function(e){ if(e.key==='Enter') fresh.click(); });
  }
}

function showScreen(id,back){
  STATE.currentScreen=id;
  document.querySelectorAll('.screen').forEach(function(s){
    if(s.id===id){s.classList.remove('hidden','back');}
    else if(!s.classList.contains('hidden')){if(back)s.classList.add('back');s.classList.add('hidden');}
  });
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
var SLBL=['Step 1 of 4 · Student & class','Step 2 of 4 · Behavior type','Step 3 of 4 · Timing','Step 4 of 4 · Response & notes'];
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
  var chips=SPECIALS.map(function(s){return '<button type="button" class="chip'+(STATE.entry.specials===s?' on':'')+'" data-sp="'+s+'">'+s+'</button>';}).join('');
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">Who is this about?</h3>'+
    '<div class="fg"><label class="fl">Student name <span class="req">*</span></label><input type="text" id="f-name" placeholder="First Last" value="'+STATE.entry.studentName+'" autocomplete="off"></div>'+
    '<div class="fg"><label class="fl">Homeroom class <span class="req">*</span></label><select id="f-hr"><option value="">Select homeroom...</option>'+opts+'</select></div>'+
    '<div class="fg"><label class="fl">Your specials class <span class="req">*</span></label><div class="chips" id="sp-chips">'+chips+'</div></div>'+
    '<button type="button" class="btn-p" id="s1-next">Next →</button></div>';
}
function bS2(){
  var chips=BEHAVIORS.map(function(b){return '<button type="button" class="chip'+(STATE.entry.behaviors.indexOf(b)>=0?' on':'')+'" data-beh="'+b+'">'+b+'</button>';}).join('');
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">What happened?</h3>'+
    '<div class="fg"><label class="fl">Behavior type(s) <span class="req">*</span></label><div class="chips">'+chips+'</div></div>'+
    '<div class="brow"><button type="button" class="btn-s" id="s2-back">← Back</button><button type="button" class="btn-p" id="s2-next">Next →</button></div></div>';
}
function bS3(){
  return '<div style="padding:2px 0 14px"><h3 style="font-size:15px;font-weight:600;margin-bottom:14px">When did this happen?</h3>'+
    '<div class="fg"><label class="fl">Date</label><input type="date" id="f-date" value="'+STATE.entry.date+'"></div>'+
    '<div class="fg"><label class="fl">Incident time <span style="font-size:11px;color:var(--text3)">(best estimate ok)</span></label><input type="time" id="f-time" value="'+STATE.entry.time+'"></div>'+
    '<div class="brow"><button type="button" class="btn-s" id="s3-back">← Back</button><button type="button" class="btn-p" id="s3-next">Next →</button></div></div>';
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
    '<div class="fg"><label class="fl">Additional notes <span style="font-size:11px;color:var(--text3)">(optional)</span></label>'+
    '<textarea id="f-notes" placeholder="Context, what was tried, follow-up needed...">'+STATE.entry.notes+'</textarea></div>'+
    '<div class="brow"><button type="button" class="btn-s" id="s4-back">← Back</button><button type="button" class="btn-ok" id="s4-sub">✓ Submit log</button></div></div>';
}
function attachSL(){
  var fn=el('f-name');if(fn)fn.addEventListener('input',function(){STATE.entry.studentName=fn.value;});
  var fhr=el('f-hr');if(fhr)fhr.addEventListener('change',function(){STATE.entry.homeroom=fhr.value;});
  document.querySelectorAll('[data-sp]').forEach(function(btn){btn.addEventListener('click',function(){STATE.entry.specials=btn.dataset.sp;document.querySelectorAll('[data-sp]').forEach(function(b){b.classList.toggle('on',b.dataset.sp===STATE.entry.specials);});});});
  var s1n=el('s1-next');
  if(s1n)s1n.addEventListener('click',function(){if(!STATE.entry.studentName.trim()||!STATE.entry.homeroom||!STATE.entry.specials){alert('Please fill in student name, homeroom, and subject.');return;}STATE.step=1;renderStep();});
  document.querySelectorAll('[data-beh]').forEach(function(btn){btn.addEventListener('click',function(){var b=btn.dataset.beh,idx=STATE.entry.behaviors.indexOf(b);if(idx>=0)STATE.entry.behaviors.splice(idx,1);else STATE.entry.behaviors.push(b);document.querySelectorAll('[data-beh]').forEach(function(c){c.classList.toggle('on',STATE.entry.behaviors.indexOf(c.dataset.beh)>=0);});});});
  var s2b=el('s2-back');if(s2b)s2b.addEventListener('click',function(){STATE.step=0;renderStep();});
  var s2n=el('s2-next');if(s2n)s2n.addEventListener('click',function(){if(!STATE.entry.behaviors.length){alert('Please select at least one behavior type.');return;}STATE.step=2;renderStep();});
  var fd=el('f-date');if(fd)fd.addEventListener('change',function(){STATE.entry.date=fd.value;});
  var ft=el('f-time');if(ft)ft.addEventListener('change',function(){STATE.entry.time=ft.value;});
  var s3b=el('s3-back');if(s3b)s3b.addEventListener('click',function(){STATE.step=1;renderStep();});
  var s3n=el('s3-next');if(s3n)s3n.addEventListener('click',function(){STATE.step=3;renderStep();});
  var fc=el('f-chart');if(fc)fc.addEventListener('change',function(){STATE.entry.colorChart=fc.checked;});
  var fh=el('f-home');if(fh)fh.addEventListener('change',function(){STATE.entry.homeContact=fh.checked;});
  var fn2=el('f-notes');if(fn2)fn2.addEventListener('input',function(){STATE.entry.notes=fn2.value;});
  var s4b=el('s4-back');if(s4b)s4b.addEventListener('click',function(){STATE.step=3;renderStep();});
  var sub=el('s4-sub');
  if(sub)sub.addEventListener('click',function(){
    var e=STATE.entry;
    var row={student:e.studentName,homeroom:e.homeroom,specials:e.specials,subject:e.specials,teacher_role:SESSION.role||'specials',behaviors:e.behaviors.slice(),incident_date:e.date||null,incident_time:e.time||null,color_chart:e.colorChart,home_contact:e.homeContact,notes:e.notes||null,submitted_by:SESSION.email||'specials-team'};
    var log=Object.assign({},row,{studentName:e.studentName,colorChart:e.colorChart,homeContact:e.homeContact,date:e.date,time:e.time,id:Date.now()});
    STATE.logs.unshift(log);
    el('sheet-detail').textContent=e.studentName+' · '+e.specials+' · '+(e.behaviors.length?e.behaviors.join(', '):'—');
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
  allLogs.forEach(function(l){(l.behaviors||[]).forEach(function(b){behMap[b]=(behMap[b]||0)+1;});});
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
  var maxWk=Math.max.apply(null,wkVals)||1;
  var wkW=280,wkH=44,pts=wkVals.map(function(v,i){
    var x=wkVals.length<2?wkW/2:(i/(wkVals.length-1))*(wkW-20)+10;
    var y=wkH-4-((v/maxWk)*(wkH-12));
    return x+','+y;
  }).join(' ');

  function barRow(name,n,max,color){
    var pct=Math.round((n/max)*100);
    return '<div style="margin-bottom:7px">'+
      '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">'+
      '<span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">'+escHtml(name)+'</span>'+
      '<span style="font-family:DM Mono,monospace;color:'+color+'">'+n+'</span></div>'+
      '<div style="height:3px;background:var(--bg3);border-radius:2px">'+
      '<div style="height:3px;width:'+pct+'%;background:'+color+';border-radius:2px"></div>'+
      '</div></div>';
  }

  var summ=
    '<div class="sess-strip" style="margin-bottom:12px">'+
      '<div class="ss-item"><div class="ss-val" style="color:var(--text)">'+allLogs.length+'</div><div class="ss-lbl">Total logged</div></div>'+
      '<div class="ss-item"><div class="ss-val" style="color:var(--accent)">'+chartPct+'%</div><div class="ss-lbl">Chart used</div></div>'+
      '<div class="ss-item"><div class="ss-val" style="color:var(--amber)">'+homePct+'%</div><div class="ss-lbl">Home contact</div></div>'+
    '</div>'+
    (wkVals.length>1?
      '<div class="sec">Weekly trend</div>'+
      '<div class="card" style="margin-bottom:10px;padding:10px 12px">'+
        '<svg width="100%" height="'+wkH+'px" viewBox="0 0 '+wkW+' '+wkH+'" preserveAspectRatio="xMidYMid meet" style="display:block">'+
          '<polyline points="'+pts+'" fill="none" stroke="#00e6c8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
        '</svg>'+
        '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);font-family:DM Mono,monospace;margin-top:4px">'+
          '<span>'+(wkKeys[0]||'')+'</span><span>'+(wkKeys[wkKeys.length-1]||'')+'</span>'+
        '</div>'+
      '</div>'
    :'')+
    (topStus.length?
      '<div class="sec">Your students</div>'+
      '<div class="card" style="margin-bottom:10px">'+
        topStus.map(function(s){return barRow(s.name,s.n,maxStu,'var(--accent)');}).join('')+
      '</div>'
    :'')+
    (topBehs.length?
      '<div class="sec">Behavior types</div>'+
      '<div class="card" style="margin-bottom:10px">'+
        topBehs.map(function(b){return barRow(b.name,b.n,maxBeh,'var(--amber)');}).join('')+
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
        return '<div class="log-item" data-uid="'+uid+'" style="'+(isDb?'border-color:rgba(0,230,200,.1)':'')+'">'+
          '<div class="log-hdr" data-toggle="'+uid+'">'+
            '<div class="log-name">'+stuNameLink(l.studentName)+
              '<span class="log-chevron" id="chev-'+uid+'">▾</span>'+
            '</div>'+
            '<div class="log-time">'+(isDb?'<span style="color:var(--text3);margin-right:4px;font-size:9px">db</span>':'')+l.time+'</div>'+
          '</div>'+
          '<div class="log-tags">'+
            '<span class="tag blue">'+l.specials+'</span>'+
            '<span class="tag gray">'+l.homeroom+'</span>'+
            behs.map(function(b){return '<span class="tag amber">'+b+'</span>';}).join('')+
            ((l.colorChart||l.color_chart)?'<span class="tag green">Chart</span>':'')+
            ((l.homeContact||l.home_contact)?'<span class="tag red">Home</span>':'')+
          '</div>'+
          '<div class="log-detail" id="det-'+uid+'">'+
            '<div class="log-detail-inner">'+
              (hasNotes?'<div class="log-notes">'+escHtml(l.notes)+'</div>':
                '<div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:DM Mono,monospace;letter-spacing:.04em">— no notes —</div>')+
              '<div class="log-actions">'+
                '<button class="log-act-btn edit" data-edit="'+uid+'">[ Edit ]</button>'+
                (isDb?'<button class="log-act-btn del" data-del="'+uid+'" data-dbid="'+(l.dbId||'')+'">[ Delete ]</button>':'')+
              '</div>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');
  }).join('');
  body.innerHTML=summ+logHtml;
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
    spChips.innerHTML=getSpecials().map(function(s){
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
  behDiv.innerHTML=BEHAVIORS.map(function(b){
    return '<button type="button" class="edit-chip'+(curBehs.indexOf(b)>=0?' on':'')+'" data-eb="'+b+'">'+b+'</button>';
  }).join('');
  behDiv.querySelectorAll('[data-eb]').forEach(function(c){c.addEventListener('click',function(){c.classList.toggle('on');});});
  el('es-status').textContent='';
  el('es-save').disabled=false;
  el('es-save').textContent='[ Save changes ]';
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
    behs.forEach(function(b){behCounts[b]=(behCounts[b]||0)+1;});
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
  // DOW
  var dowCounts = {};var dowDays = {Monday:9,Tuesday:9,Wednesday:9,Thursday:9,Friday:8};
  rows.forEach(function(r){
    if(!r.incident_date) return;
    var d = new Date(r.incident_date+'T12:00:00');
    var name=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
    dowCounts[name]=(dowCounts[name]||0)+1;
  });
  var dowOrder=['Monday','Tuesday','Wednesday','Thursday','Friday'];
  var dow = dowOrder.map(function(d){return{d:d,r:dowCounts[d]?parseFloat((dowCounts[d]/(dowDays[d]||9)).toFixed(2)):0};});
  // weekly
  var wkCounts = {};
  rows.forEach(function(r){
    var d = new Date((r.incident_date||r.created_at||'').slice(0,10)+'T12:00:00');
    if(isNaN(d)) return;
    var m=d.getMonth()+1,day=d.getDate();
    var lbl=m===1?(day<=25?'Jan W4':'Jan W5'):m===2?(day<=8?'Feb W6':day<=15?'Feb W7':day<=22?'Feb W8':'Feb W9'):m===3?(day<=8?'Mar W10':day<=15?'Mar W11':day<=22?'Mar W12':'Mar W13'):'Apr W14';
    wkCounts[lbl]=(wkCounts[lbl]||0)+1;
  });
  var wkOrder=['Jan W4','Jan W5','Feb W6','Feb W7','Feb W8','Feb W9','Mar W10','Mar W11','Mar W12','Mar W13','Apr W14'];
  var wkDays={  'Jan W4':3,'Jan W5':4,'Feb W6':3,'Feb W7':5,'Feb W8':4,'Feb W9':4,'Mar W10':5,'Mar W11':5,'Mar W12':4,'Mar W13':5,'Apr W14':3};
  var weekly = wkOrder.map(function(w){var n=wkCounts[w]||0;return{w:w,r:parseFloat((n/(wkDays[w]||5)).toFixed(2)),n:n};});
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
    (r.behaviors||[]).forEach(function(b){c.behCounts[b]=(c.behCounts[b]||0)+1;});
    if(r.specials) c.spCounts[r.specials]=(c.spCounts[r.specials]||0)+1;
    if(r.student) c.stuCounts[r.student]=(c.stuCounts[r.student]||0)+1;
    var d=new Date((r.incident_date||r.created_at||'').slice(0,10)+'T12:00:00');
    if(!isNaN(d)){var m=d.getMonth()+1,day=d.getDate();var lbl=m===1?(day<=25?'Jan W4':'Jan W5'):m===2?(day<=8?'Feb W6':day<=15?'Feb W7':day<=22?'Feb W8':'Feb W9'):m===3?(day<=8?'Mar W10':day<=15?'Mar W11':day<=22?'Mar W12':'Mar W13'):'Apr W14';c.wkCounts[lbl]=(c.wkCounts[lbl]||0)+1;}
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
      weekly:wkOrder.filter(function(w){return c.wkCounts[w];}).map(function(w){return{w:w,n:c.wkCounts[w]};})
    };
  });
  var topCls = Object.keys(clsMap).sort(function(a,b){return clsMap[b].total-clsMap[a].total;}).slice(0,15).map(function(k){return{cls:k,n:clsMap[k].total};});
  return {total:total,chart_yes:chartYes,home_yes:homeYes,behaviors:behaviors,grades:grades,specials:specials,dow:dow,weekly:weekly,top_students:topStudents,classrooms:classrooms,top_cls:topCls};
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
  else content=bCL(live);
  body.innerHTML=content;
  if(STATE.liveError) body.innerHTML='<div class="alert" style="margin:0">⚠ Could not reach Supabase — showing cached data</div>'+body.innerHTML;
  if(t==='students') wireStudentLinks(body,'S-admin');
  setTimeout(drawCharts,60);
  body.querySelectorAll('[data-cls]').forEach(function(r){r.addEventListener('click',function(){openDet(r.dataset.cls,live);});});
}

function bOV(live){
  var LD=live||{};
  var tot=(LD.total!=null?LD.total:D.total)+STATE.logs.length;
  var chartPct=Math.round((LD.chart_yes!=null?LD.chart_yes:D.chart_yes)/(LD.total||D.total)*100);
  var homePct=Math.round((LD.home_yes!=null?LD.home_yes:D.home_yes)/(LD.total||D.total)*100);
  return '<div class="kpi-grid">'+
    kpiH('Total incidents',tot,'Jan 21 – Apr 1, 2026',false)+
    kpiH('Per school day','5.5','45 logged days',false)+
    kpiH('Color chart used',chartPct+'%',D.chart_yes+' of '+D.total+' incidents',false)+
    kpiH('Home contacted',homePct+'%',D.home_yes+' of '+D.total+' incidents',true)+
    '</div>'+
    '<div class="card"><div style="font-size:12px;color:var(--text2);margin-bottom:8px">Weekly incident rate / school day</div>'+
    '<canvas id="c-wk" height="80" style="width:100%;display:block" data-live="1"></canvas>'+
    '<div style="font-size:9px;color:var(--text3);margin-top:4px;letter-spacing:.04em;font-family:DM Mono,monospace">▓ EOG testing window May 19–21 · shaded region is projected, not logged data</div>'+
    '<div style="display:flex;gap:12px;margin-top:8px">'+
    '<span style="font-size:10px;color:var(--text2);display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:2px;background:#4d8bff;border-radius:1px"></span>Rate/day</span>'+
    '</div></div>'+
    '<div class="sec">Incidents by grade</div><div class="card"><canvas id="c-gr" height="100" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec">Behavior types <span style="font-weight:400;color:var(--text3);font-size:10px;text-transform:none;letter-spacing:0">(tagged incidents · multi-select)</span></div><div class="card">'+
    (LD.behaviors||D.behaviors).map(function(b,i){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+b.t+'</span><span style="font-family:DM Mono,monospace;color:'+(b.t==='Unspecified'?'var(--text3)':'var(--text2)')+'">'+b.n+'</span></div>'+pb((b.n/76)*100,b.t==='Unspecified'?'var(--text3)':SER[i%SER.length])+'</div>';}).join('')+'</div>'+
    '<div class="sec">Specials class totals</div><div class="card">'+
    (LD.specials||D.specials).map(function(s,i){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+(SC[s.n]||'var(--text)')+'">'+s.n+'</span><span style="font-family:DM Mono,monospace">'+s.total+'</span></div>'+pb((s.total/99)*100,SC[s.n]||SER[i])+'</div>';}).join('')+'</div>';
}
function bTM(live){
  var LD=live||{};
  return '<div class="card"><div style="font-size:12px;color:var(--text2);margin-bottom:6px">Incidents per school day · by weekday</div><canvas id="c-dow" height="90" style="width:100%;display:block"></canvas></div>'+
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
    if(!r.incident_date&&!r.created_at) return;
    var dateStr=r.incident_date||r.created_at.slice(0,10);
    var d=new Date(dateStr+'T12:00:00');
    var dow=d.getDay();
    if(dow===0||dow===6) return;
    var dayLabel=HEAT_DAYS[dow-1];
    var period=getPeriod(r.incident_time||r.created_at.slice(11,16));
    if(!period) return;
    grid[period][dayLabel]++;
    incidents[period][dayLabel].push(r);
  });
  return {grid:grid,incidents:incidents};
}

function bHeat(subjectFilter){
  var rows=STATE.liveRows||[];
  var data=buildHeatGrid(rows,subjectFilter||'all');
  var grid=data.grid;
  var mx=0;
  PERIODS.forEach(function(p){HEAT_DAYS.forEach(function(d){if(grid[p.label][d]>mx)mx=grid[p.label][d];});});

  var subjects=['all'].concat(Object.keys(rows.reduce(function(a,r){var s=r.subject||r.specials;if(s)a[s]=1;return a;},{})));
  var filterHtml='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">'+
    subjects.map(function(s){
      var on=(subjectFilter||'all')===s;
      return '<button type="button" data-hf="'+escHtml(s)+'" style="'+
        'font-size:10px;font-family:DM Mono,monospace;letter-spacing:.06em;padding:4px 10px;'+
        'border-radius:10px;border:1px solid '+(on?'var(--accent)':'rgba(0,230,200,.25)')+';'+
        'background:'+(on?'rgba(0,230,200,.12)':'transparent')+';'+
        'color:'+(on?'var(--accent)':'var(--text3)')+';cursor:pointer">'+(s==='all'?'All':escHtml(s))+'</button>';
    }).join('')+'</div>';

  var h='<table class="htable" style="width:100%;border-collapse:collapse">'+
    '<thead><tr>'+
    '<th style="text-align:left;font-size:9px;color:var(--text3);padding:4px 8px 4px 0;font-weight:400;min-width:48px">Period</th>'+
    HEAT_DAYS.map(function(d){return '<th style="font-size:9px;color:var(--text3);padding:4px 6px;font-weight:400;text-align:center">'+d+'</th>';}).join('')+
    '</tr></thead><tbody>';

  PERIODS.forEach(function(p){
    h+='<tr>';
    h+='<td style="font-size:9px;color:var(--text3);padding:6px 8px 6px 0;white-space:nowrap;font-family:DM Mono,monospace;vertical-align:middle">'+
      '<div style="font-weight:600;color:var(--text2)">'+p.label+'</div>'+
      '<div style="font-size:8px;opacity:.6">'+p.start+'</div></td>';
    HEAT_DAYS.forEach(function(d){
      var v=grid[p.label][d];
      var a=mx?v/mx:0;
      var bg=v===0?'transparent':'rgba(0,230,200,'+(0.08+a*0.5).toFixed(2)+')';
      if(a>0.7) bg='rgba(255,68,102,'+(0.3+a*0.4).toFixed(2)+')';
      var txt=v===0?'<span style="color:var(--text3);font-size:10px">·</span>':
        '<span style="font-size:12px;font-weight:600;color:'+(a>0.5?'var(--text)':'var(--text2)')+'">'+v+'</span>';
      h+='<td style="text-align:center;padding:4px 2px;cursor:'+(v>0?'pointer':'default')+'"'+
        (v>0?' data-hp="'+escHtml(p.label)+'" data-hd="'+escHtml(d)+'"':'')+
        ' title="'+p.label+' '+d+': '+v+' incident'+(v===1?'':'s')+'">'+
        '<div style="background:'+bg+';border-radius:4px;padding:6px 4px;min-width:32px">'+txt+'</div></td>';
    });
    h+='</tr>';
  });

  h+='</tbody></table>';
  var drillHtml='<div id="heat-drill" style="display:none;margin-top:12px;border-top:1px solid rgba(0,230,200,.15);padding-top:12px">'+
    '<div id="heat-drill-hdr" style="font-size:11px;color:var(--accent);font-family:DM Mono,monospace;margin-bottom:8px"></div>'+
    '<div id="heat-drill-list"></div></div>';

  return filterHtml+h+drillHtml;
}

function wireHeat(subjectFilter){
  var card=document.getElementById('heat-card');
  if(!card) return;
  card.addEventListener('click',function(e){
    // filter chip
    var hf=e.target.closest('[data-hf]');
    if(hf){
      var s=hf.dataset.hf;
      card.innerHTML=bHeat(s);
      wireHeat(s);
      return;
    }
    // cell click
    var hp=e.target.closest('[data-hp]');
    if(hp){
      var period=hp.dataset.hp, day=hp.dataset.hd;
      var data=buildHeatGrid(STATE.liveRows||[],subjectFilter||'all');
      var list=(data.incidents[period]&&data.incidents[period][day])||[];
      var drill=document.getElementById('heat-drill');
      var hdr=document.getElementById('heat-drill-hdr');
      var ul=document.getElementById('heat-drill-list');
      if(!drill) return;
      if(!list.length){drill.style.display='none';return;}
      hdr.textContent=period+' · '+HEAT_DAY_FULL[HEAT_DAYS.indexOf(day)]+' — '+list.length+' incident'+(list.length===1?'':'s');
      ul.innerHTML=list.map(function(r){
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,230,200,.08);font-size:11px">'+
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

  function cc(c){return c>=60?'var(--green)':c<25?'var(--red)':'var(--amber)';}
  function pc(p){return p>=80?'var(--green)':p>=50?'var(--amber)':'var(--red)';}
  function lc(l){return l<=2?'var(--green)':l<=5?'var(--amber)':'var(--red)';}

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
        '<td style="font-family:DM Mono,monospace;text-align:center">'+n+'</td>'+
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
    {f:'Student name',n:hasStudent},
    {f:'Subject',n:hasSubject},
    {f:'Behavior type',n:hasBehavior},
    {f:'Time logged',n:hasTime},
    {f:'Color chart response',n:hasChart},
    {f:'Home contact',n:hasHome}
  ];

  var completenessHtml='<div class="sec">Field completeness · '+total+' records</div><div class="card">'+
    fields.map(function(f){
      var p=Math.round(f.n/total*100);
      var c=p>=90?'var(--green)':p>=50?'var(--amber)':'var(--red)';
      return '<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">'+
        '<span>'+f.f+'</span>'+
        '<span style="font-family:DM Mono,monospace;color:'+c+'">'+p+'%</span>'+
        '</div>'+pb(p,c)+'</div>';
    }).join('')+'</div>';

  return '<div class="sec">By subject · '+total+' total incidents</div>'+
    tableHtml+completenessHtml;
}
function bST(live){
  var LD=live||{};
  var stuList=LD.top_students&&LD.top_students.length?LD.top_students:D.top_students;
  var mx=stuList[0].n;
  return '<div style="background:#1a0010;border:0.5px solid var(--red);border-radius:var(--r);padding:10px 14px;font-size:11px;color:#ff9a9a;margin-bottom:12px;display:flex;gap:8px;line-height:1.5">'+
    '<span>🔒</span><span><strong>Restricted.</strong> For administrator use only. Do not distribute without redacting names.</span></div>'+
    '<div class="sec">Students with 4+ logged incidents</div><div class="card">'+
    stuList.map(function(s){return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+s.name+'</span><span style="font-family:DM Mono,monospace;font-weight:500;color:'+(s.n>=7?'var(--red)':s.n>=5?'var(--amber)':'var(--text2)')+'">'+s.n+'</span></div>'+pb((s.n/mx)*100,s.n>=7?'var(--red)':s.n>=5?'var(--amber)':'var(--accent)')+'</div>';}).join('')+'</div>'+
    '<div class="sec">System improvements needed</div><div class="card">'+
    [{t:'EOG testing window (May 19–21)',b:'Mark testing windows to separate stress spikes from baseline classroom patterns.'},{t:'Normalize by class meetings',b:'Replace calendar days with actual class meeting counts for fair comparisons.'},{t:'Coded consequence field',b:'Free-text consequences make intervention analysis impossible — use a controlled list.'},{t:'Stable student ID',b:'Name spelling variants (Jaxon/Jaxson, Lafayette/Lafeyette) undercount repeat students.'}].map(function(r){return '<div style="padding:10px 0;border-bottom:0.5px solid var(--border)"><div style="font-size:12px;font-weight:600;margin-bottom:3px">'+r.t+'</div><div style="font-size:11px;color:var(--text2);line-height:1.4">'+r.b+'</div></div>';}).join('')+'</div>';
}
function bCL(live){
  var LD=live||{};
  var sorted=(LD.top_cls&&LD.top_cls.length?LD.top_cls:D.top_cls).slice().sort(function(a,b){return b.n-a.n;});
  var mx=sorted[0].n;
  return '<div class="sec">All classrooms · sorted by incident count</div><div class="card">'+
    sorted.map(function(c,i){var det=D.classrooms[c.cls]||{};return '<div class="li" data-cls="'+c.cls+'"><div class="li-c"><div class="li-t">'+c.cls+'</div><div class="li-s">Chart: '+(det.chart||'—')+'% · Home: '+(det.home||0)+'%</div>'+pb((c.n/mx)*100,i<3?'var(--red)':'var(--accent)')+'</div><div class="li-r" style="color:'+(i<3?'var(--red)':'var(--text2)')+';margin-left:10px">'+c.n+'</div><div style="color:var(--text3);font-size:18px">›</div></div>';}).join('')+'</div>';
}

// ── CLASS EXPLORER ──
function filterClasses(list){
  var f=STATE.clsFilter;
  if(f==='all') return list;
  if(f==='zero') return list.filter(function(k){var c=D.classrooms[k];return !c||c.total===0;});
  if(f==='four') return list.filter(function(k){var c=D.classrooms[k];return c&&c.total>=4;});
  if(f==='lowchart') return list.filter(function(k){var c=D.classrooms[k];return c&&c.total>0&&c.chart<30;});
  return list;
}

function renderClsExplorer(live){
  var liveArg=live||(STATE.liveRows.length?buildLiveStats(STATE.liveRows):null);
  var filtered=filterClasses(ALL_CLASSES);
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
      var c=(liveArg&&liveArg.classrooms&&liveArg.classrooms[k])||D.classrooms[k];
      var isZero=!c||c.total===0;
      var cardClass='card'+(isZero?' card-zero':'');
      var tot=isZero?0:c.total;
      var chartV=isZero?'—':(c.chart+'%');
      var chartTag=isZero?'<span class="tag gray">No data</span>':('<span class="tag '+(c.chart>=50?'green':c.chart>=30?'amber':'red')+'">Chart '+c.chart+'%</span>');
      var specHtml=isZero?'<span style="font-size:10px;color:var(--text3)">No incidents logged this window</span>':Object.keys(c.specials).filter(function(s){return c.specials[s]>0;}).map(function(s){return '<span style="font-size:10px;background:'+(SC[s]||'#888')+'22;color:'+(SC[s]||'#aaa')+';border-radius:10px;padding:2px 8px">'+s+': '+c.specials[s]+'</span>';}).join('');
      return '<div class="'+cardClass+'" style="cursor:pointer;margin-bottom:8px" data-cls="'+k+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div><div style="font-size:15px;font-weight:600">'+k+'</div><div style="font-size:11px;color:var(--text2);margin-top:2px">'+(isZero?'No incidents logged':''+tot+' incidents')+'</div></div>'+
        '<div style="text-align:right"><div style="font-family:DM Mono,monospace;font-size:22px;font-weight:500;color:'+(isZero?'var(--text3)':'var(--text)')+'">'+tot+'</div>'+chartTag+'</div></div>'+
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
    card.addEventListener('click',(function(k){return function(){openDet(k,liveArg);};})(card.dataset.cls));
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
    if(btn){btn.textContent='[ Export CSV ]';btn.disabled=false;}
  }).catch(function(){
    if(btn){btn.textContent='[ Export CSV ]';btn.disabled=false;}
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
        var submitter=r.submitted_by&&r.submitted_by!=='import@waynestem.org'?
          '<span style="font-size:9px;color:var(--text3);font-family:DM Mono,monospace;margin-left:4px">'+r.submitted_by.split('@')[0]+'</span>':'';
        return '<div class="log-item" data-uid="'+uid+'">'+
          '<div class="log-hdr" data-toggle="'+uid+'">'+
            '<div class="log-name">'+stuNameLink(r.student||'—')+submitter+
              '<span class="log-chevron" id="chev-'+uid+'">▾</span>'+
            '</div>'+
            '<div class="log-time">'+(r.incident_time||r.created_at.slice(11,16))+'</div>'+
          '</div>'+
          '<div class="log-tags">'+
            '<span class="tag blue">'+escHtml(r.specials||'—')+'</span>'+
            behs.map(function(b){return '<span class="tag amber">'+escHtml(b)+'</span>';}).join('')+
            (r.color_chart?'<span class="tag green">Chart</span>':'')+
            (r.home_contact?'<span class="tag red">Home</span>':'')+
          '</div>'+
          '<div class="log-detail" id="det-'+uid+'">'+
            '<div class="log-detail-inner">'+
              (hasNotes?'<div class="log-notes">'+escHtml(r.notes)+'</div>':
                '<div style="font-size:10px;color:var(--text3);margin-bottom:8px;font-family:DM Mono,monospace;letter-spacing:.04em">— no notes —</div>')+
              '<div class="log-actions">'+
                '<button class="log-act-btn edit" data-edit="'+uid+'" data-dbid="'+r.id+'">[ Edit ]</button>'+
                '<button class="log-act-btn del" data-del="'+uid+'" data-dbid="'+r.id+'">[ Delete ]</button>'+
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
  var c=(LD.classrooms&&LD.classrooms[id])||D.classrooms[id];
  var isZero=!c||c.total===0;
  el('det-title').textContent=id;
  el('det-sub').textContent=isZero?'No incidents logged':c.total+' incidents · Chart: '+c.chart+'% · Home: '+c.home+'%';

  if(isZero){
    el('det-body').innerHTML=
      '<div class="empty" style="padding-top:36px">'+
      '<div class="empty-t">No incidents logged</div>'+
      '<div class="empty-s">No specials incidents were recorded for this classroom during Jan 21 – Apr 1, 2026.<br><br>This may reflect genuinely smooth sessions, inconsistent logging, or limited specials overlap. It is not confirmation of no issues.</div></div>'+
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
    '<div class="ds-item"><div class="ds-lbl">Highest-repeat student</div><div class="ds-val hi">'+topStu+'</div></div>'+
    '<div class="ds-item"><div class="ds-lbl">Primary specials source</div><div class="ds-val hi">'+topSpec+'</div></div>'+
    '<div class="ds-item"><div class="ds-lbl">Chart use · Home contact</div><div class="ds-val hi">'+c.chart+'% · '+c.home+'%</div></div>'+
    '</div>';

  el('det-body').innerHTML=
    summBlock+
    '<div class="kpi-grid" style="margin-bottom:10px">'+
    kpiH('Total incidents',c.total,'specials logs',false)+
    kpiH('Chart used',c.chart+'%','',c.chart<30)+
    kpiH('Home contact',c.home+'%','',c.home===0)+
    '<div class="kpi"><div class="lbl">Specials logged</div><div class="val">'+Object.keys(c.specials).filter(function(k){return c.specials[k]>0;}).length+'/4</div></div></div>'+
    '<div class="sec">Behavior types</div><div class="card">'+
    c.behaviors.map(function(b,i){return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>'+b.t+'</span><span style="font-family:DM Mono,monospace">'+b.n+'</span></div>'+pb((b.n/mxB)*100,SER[i%SER.length])+'</div>';}).join('')+'</div>'+
    '<div class="sec">Students</div><div class="card">'+
    c.students.map(function(s){return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+(s.name==='Other'?'var(--text2)':'var(--text)')+'">'+stuNameLink(s.name)+'</span><span style="font-family:DM Mono,monospace;color:'+(s.n>=5?'var(--red)':s.n>=3?'var(--amber)':'var(--text2)')+'">'+s.n+'</span></div>'+pb((s.n/mxS)*100,s.name==='Other'?'var(--text3)':s.n>=5?'var(--red)':s.n>=3?'var(--amber)':'var(--accent)')+'</div>';}).join('')+'</div>'+
    '<div class="sec">By specials class</div><div class="card">'+
    Object.keys(c.specials).map(function(s){var n=c.specials[s];return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:'+(SC[s]||'var(--text2)')+'">'+s+'</span><span style="font-family:DM Mono,monospace">'+n+'</span></div>'+pb((n/mxSP)*100,SC[s]||'var(--text3)')+'</div>';}).join('')+'</div>'+
    '<div class="sec">Weekly trend</div><div class="card"><canvas id="c-det-wk" height="80" style="width:100%;display:block"></canvas></div>'+
    '<div class="sec" style="display:flex;justify-content:space-between;align-items:center">'+
    'All incidents'+
    '<span style="font-size:10px;color:var(--text3);font-family:DM Mono,monospace;letter-spacing:.04em" id="det-inc-count">loading…</span>'+
    '</div>'+
  '<div id="det-inc-list" style="margin-bottom:16px"><div style="text-align:center;padding:20px 0;font-size:11px;color:var(--text3);letter-spacing:.06em">Fetching records…</div></div>'+
  '<div style="height:16px"></div>';

  wireStudentLinks(el('det-body'),'S-detail');
  showScreen('S-detail');
  setTimeout(function(){
    drawBar('c-det-wk',c.weekly.map(function(w){return w.w;}),c.weekly.map(function(w){return w.n;}),c.weekly.map(function(_,i){return SER[i%SER.length];}));
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
function drawCharts(){
  var t=STATE.adminTab;
  if(t==='overview'){
    var liveWk=(STATE.liveRows.length&&buildLiveStats(STATE.liveRows)||{}).weekly||D.weekly;
    drawLine('c-wk',liveWk.map(function(d){return d.w;}),liveWk.map(function(d){return d.r;}));
    drawBar('c-gr',D.grades.map(function(d){return d.g;}),D.grades.map(function(d){return d.n;}),D.grades.map(function(d,i){return SER[i];}));
  }
  if(t==='timing'){
    var liveDow=(STATE.liveRows.length&&buildLiveStats(STATE.liveRows)||{}).dow||D.dow;
    var mxD=Math.max.apply(null,liveDow.map(function(d){return d.r;}));
    drawBar('c-dow',liveDow.map(function(d){return d.d.slice(0,3);}),liveDow.map(function(d){return d.r;}),liveDow.map(function(d){return d.r===mxD?'#ff4466':'#00e6c8';}));
  }
}
function drawLine(id,labels,d1){
  var cv=el(id);if(!cv)return;
  var ctx=cv.getContext('2d'),W=cv.offsetWidth||280,H=80,dpr=window.devicePixelRatio||1;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.height=H+'px';ctx.scale(dpr,dpr);
  var p={l:4,r:4,t:10,b:22},cw=W-p.l-p.r,ch=H-p.t-p.b;
  var mx=Math.max.apply(null,d1)*1.2;
  // add EOG future weeks to labels for context
  var eogLabels=labels.concat(['May W18','May W20','May W21']);
  var allLen=eogLabels.length;
  function xi(i){return p.l+i*(cw/(allLen-1));}
  function xid(i){return p.l+i*(cw/(d1.length-1));}
  function yi(v){return p.t+ch-(v/mx)*ch;}
  ctx.strokeStyle='rgba(0,230,200,.06)';ctx.lineWidth=.5;
  [2,4,6,8,10].forEach(function(v){if(v<=mx){ctx.beginPath();ctx.moveTo(p.l,yi(v));ctx.lineTo(p.l+cw,yi(v));ctx.stroke();}});
  ctx.strokeStyle='rgba(0,230,200,.14)';ctx.lineWidth=1;ctx.setLineDash([2,4]);
  ctx.beginPath();ctx.moveTo(p.l,yi(5.5));ctx.lineTo(p.l+cw,yi(5.5));ctx.stroke();ctx.setLineDash([]);
  // EOG shaded region — last 2 label slots
  var eogStart=xi(allLen-2),eogEnd=xi(allLen-1)+4;
  ctx.fillStyle='rgba(240,192,64,0.07)';
  ctx.fillRect(eogStart,p.t,eogEnd-eogStart,ch);
  ctx.strokeStyle='rgba(240,192,64,0.4)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
  ctx.beginPath();ctx.moveTo(eogStart,p.t);ctx.lineTo(eogStart,p.t+ch);ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='rgba(240,192,64,0.7)';ctx.font="7px DM Mono,monospace";ctx.textAlign='left';
  ctx.fillText('EOG',eogStart+2,p.t+8);
  // data line (only over actual data range)
  ctx.fillStyle='rgba(0,230,200,.07)';
  ctx.beginPath();ctx.moveTo(xi(0),yi(d1[0]));
  d1.forEach(function(v,i){ctx.lineTo(xi(i),yi(v));});
  ctx.lineTo(xi(d1.length-1),yi(0));ctx.lineTo(xi(0),yi(0));ctx.closePath();ctx.fill();
  ctx.strokeStyle='#00e6c8';ctx.lineWidth=2;
  ctx.beginPath();d1.forEach(function(v,i){i===0?ctx.moveTo(xi(i),yi(v)):ctx.lineTo(xi(i),yi(v));});ctx.stroke();
  var mxR=Math.max.apply(null,d1);
  d1.forEach(function(v,i){ctx.beginPath();ctx.arc(xi(i),yi(v),v===mxR?4:2.5,0,Math.PI*2);ctx.fillStyle=v===mxR?'#ff4466':'#00e6c8';ctx.fill();});
  ctx.fillStyle='rgba(0,180,150,.7)';ctx.font="8px DM Mono,monospace";ctx.textAlign='center';
  // show subset of labels across full range
  var step=Math.ceil(allLen/6);
  for(var i=0;i<allLen;i+=step){ctx.fillText(eogLabels[i].replace(/\w+ /,''),xi(i),H-4);}
  ctx.fillStyle='rgba(0,230,200,.4)';ctx.font="8px DM Mono,monospace";ctx.textAlign='right';ctx.fillText('avg 5.5',p.l+cw,yi(5.5)-3);
}
function drawBar(id,labels,data,colors){
  var cv=el(id);if(!cv)return;
  var ctx=cv.getContext('2d'),W=cv.offsetWidth||280,H=parseInt(cv.getAttribute('height'))||100,dpr=window.devicePixelRatio||1;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.height=H+'px';ctx.scale(dpr,dpr);
  var p={l:2,r:2,t:8,b:22},cw=W-p.l-p.r,ch=H-p.t-p.b;
  var mx=(Math.max.apply(null,data)||1)*1.15;
  var bw=(cw/data.length)*.65,gap=(cw/data.length)*.35;
  ctx.strokeStyle='rgba(0,230,200,.06)';ctx.lineWidth=.5;
  [.25,.5,.75].forEach(function(f){var yy=p.t+ch*(1-f);ctx.beginPath();ctx.moveTo(p.l,yy);ctx.lineTo(p.l+cw,yy);ctx.stroke();});
  data.forEach(function(v,i){
    var bx=p.l+i*(bw+gap)+gap/2,bh=(v/mx)*ch,by=p.t+ch-bh,r=Math.min(3,bh);
    ctx.fillStyle=Array.isArray(colors)?colors[i]:colors;
    ctx.beginPath();ctx.moveTo(bx+r,by);ctx.lineTo(bx+bw-r,by);ctx.quadraticCurveTo(bx+bw,by,bx+bw,by+r);
    ctx.lineTo(bx+bw,p.t+ch);ctx.lineTo(bx,p.t+ch);ctx.lineTo(bx,by+r);ctx.quadraticCurveTo(bx,by,bx+r,by);
    ctx.closePath();ctx.fill();
    if(v>0){ctx.fillStyle='rgba(0,230,200,.75)';ctx.font="8px 'DM Mono',monospace";ctx.textAlign='center';ctx.fillText(Number.isInteger(v)?v:v.toFixed(1),bx+bw/2,by-2);}
    ctx.fillStyle='rgba(0,180,150,.7)';ctx.font="9px 'DM Mono',monospace";ctx.textAlign='center';
    ctx.fillText(labels[i].length>4?labels[i].slice(0,4):labels[i],bx+bw/2,H-4);
  });
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
el('AN-classes').addEventListener('click',function(){ if(SESSION.role!=='admin') return; STATE.clsFilter='all';showScreen('S-classes');renderClsExplorer(STATE.liveRows.length?buildLiveStats(STATE.liveRows):null);});
el('AN-log').addEventListener('click',goTeacher);
el('btn-cls-back').addEventListener('click',function(){showScreen('S-admin',true);});
el('btn-det-back').addEventListener('click',function(){showScreen('S-classes',true);var live=STATE.liveRows.length?buildLiveStats(STATE.liveRows):null;renderClsExplorer(live);});
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
  if(!updates.student){status.textContent='Student name required';status.style.color='var(--red)';return;}

  function resetBtn(){saveBtn.textContent='[ Save changes ]';saveBtn.disabled=false;}
  function onSaved(){
    var cb=EDIT_STATE.onAfterEdit;
    resetBtn();
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
    if(!SESSION.token){status.textContent='Not signed in';status.style.color='var(--red)';resetBtn();return;}
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
      resetBtn();
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
  function resetBtn(){el('del-go-btn').textContent='[ Delete ]';el('del-go-btn').disabled=false;}
  if(!DEL_STATE.dbId){resetBtn();closeDelConfirm();return;}
  el('del-go-btn').textContent='[ Deleting… ]';
  el('del-go-btn').disabled=true;
  if(!SESSION.token){resetBtn();closeDelConfirm();return;}
  fetch(SB_URL+'/rest/v1/incidents?id=eq.'+DEL_STATE.dbId,{
    method:'DELETE',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token,'Prefer':'return=minimal'}
  }).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    STATE.myDbLogs=STATE.myDbLogs.filter(function(row){return String(row.id)!==String(DEL_STATE.dbId);});
    if(STATE.currentScreen==='S-admin'){STATE.liveLoaded=false;STATE.liveRows=[];}
    var cb=DEL_STATE.onAfterDelete;
    resetBtn();
    closeDelConfirm();
    if(cb){ try{cb();}catch(e){console.error(e);} }
    else renderHistory();
  }).catch(function(){
    resetBtn();
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
    btn.textContent='[ Activate account ]'; btn.disabled=false;
  });
});

initFreshness();

export {
  SESSION, STATE, D, ALL_CLASSES, BAND_LABELS, BEHAVIORS, HOMEROOMS, SER, SC,
  todayStr, nowStr, freshEntry,
  saveSession, loadSession, refreshSession, signOut,
  initLogin, fetchRole,
  authedFetch, authedInsert, authedSelect,
  fetchLiveData, buildLiveStats, fetchClassIncidents, fetchStudentIncidents, renderIncidentList,
  sbInsert,
  drawLine, drawBar, pb,
  openEditSheet, closeEditSheet, populateEditSheet, openDelConfirm, closeDelConfirm,
  renderStep, goTeacher, showPane, closeSheet, renderHistory, fetchMyLogs,
  goAdmin, renderAdmin, setTab, bOV, bTM, bCV, bST, bCL,
  renderClsExplorer, filterClasses, openDet, showScreen, escHtml,
  openStudent, wireStudentLinks, stuNameLink, setStuPrevScreen, getStuPrevScreen
};
