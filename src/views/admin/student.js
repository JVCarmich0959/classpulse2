import { SB_URL, SB_KEY } from '../../config.js';
import { SESSION, showScreen, escHtml, fetchStudentIncidents, renderIncidentList, setStuPrevScreen, getStuPrevScreen, drawLine, wireHeatCard } from '../../main.js';

function fetchStudentNote(name, cb){
  if(!SESSION.token){ if(cb) cb(new Error('not authenticated'), ''); return; }
  fetch(SB_URL + '/rest/v1/student_notes?student_name=eq.' + encodeURIComponent(name) + '&select=notes', {
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token}
  }).then(function(r){ return r.json(); })
    .then(function(rows){
      var note = (rows && rows[0] && rows[0].notes) || '';
      if(cb) cb(null, note);
    }).catch(function(err){ if(cb) cb(err, ''); });
}

function saveStudentNote(name, notes, cb){
  if(!SESSION.token){ if(cb) cb(new Error('not authenticated')); return; }
  fetch(SB_URL + '/rest/v1/student_notes', {
    method:'POST',
    headers:{
      'apikey':SB_KEY,
      'Authorization':'Bearer '+SESSION.token,
      'Content-Type':'application/json',
      'Prefer':'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      student_name:name,
      notes:notes || '',
      updated_at:new Date().toISOString(),
      updated_by:SESSION.email || null
    })
  }).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    if(cb) cb(null);
  }).catch(function(err){ if(cb) cb(err); });
}

function stuNameLink(name){
  if(!name || name==='Other') return escHtml(name || '');
  var n = escHtml(name);
  return '<span class="stu-name-link" data-stu="'+n+'">'+n+'</span>';
}

function wireStudentLinks(container, prevScreen){
  if(!container) return;
  container.querySelectorAll('[data-stu]').forEach(function(el){
    el.addEventListener('click', function(e){
      e.stopPropagation();
      openStudent(el.dataset.stu, prevScreen);
    });
  });
}

function studentDateStr(r){
  return r.incident_date || (r.created_at||'').slice(0,10) || '';
}
function studentWeekStart(dateStr){
  if(!dateStr) return '';
  var d=new Date(dateStr+'T12:00:00');
  if(isNaN(d)) return '';
  var day=d.getDay();
  var mon=new Date(d);
  mon.setDate(d.getDate()-(day===0?6:day-1));
  return mon.toISOString().slice(0,10);
}
function buildStudentWeekly(rows){
  var wk={};
  (rows||[]).forEach(function(r){
    var k=studentWeekStart(studentDateStr(r));
    if(!k) return;
    wk[k]=(wk[k]||0)+1;
  });
  var keys=Object.keys(wk).sort().slice(-10);
  return {
    labels:keys.map(function(k){
      var d=new Date(k+'T12:00:00');
      return isNaN(d)?k:(d.toLocaleString('en-US',{month:'short'})+' '+d.getDate());
    }),
    values:keys.map(function(k){return wk[k]||0;})
  };
}

function openStudent(name, prevScreen){
  var map = {
    'S-detail':'‹ Class',
    'S-classes':'‹ Classes',
    'S-admin':'‹ Dashboard',
    'S-teacher':'‹ My Logs'
  };
  setStuPrevScreen(prevScreen || 'S-detail');
  var ps = getStuPrevScreen();
  var b = document.getElementById('btn-stu-back');
  if(b) b.textContent = map[ps] || '‹ Back';
  var title = document.getElementById('stu-title');
  var sub = document.getElementById('stu-sub');
  var body = document.getElementById('stu-body');
  if(title) title.textContent = 'Loading…';
  if(sub) sub.textContent = 'Loading…';
  if(body) body.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:11px;color:var(--text3);letter-spacing:.06em">Loading student profile…</div>';
  showScreen('S-student');

  fetchStudentIncidents(name, function(err, rows){
    rows = rows || [];
    if(err){
      if(body) body.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:11px;color:var(--text3);letter-spacing:.06em">Could not load student incidents</div>';
      return;
    }
    var total = rows.length;
    var chartY = rows.filter(function(r){ return !!r.color_chart; }).length;
    var homeY = rows.filter(function(r){ return !!r.home_contact; }).length;
    var behCounts = {};
    var spCounts = {};
    rows.forEach(function(r){
      (r.behaviors||[]).forEach(function(bh){ behCounts[bh]=(behCounts[bh]||0)+1; });
      if(r.specials) spCounts[r.specials]=(spCounts[r.specials]||0)+1;
    });
    var topBehavior = Object.keys(behCounts).sort(function(a,b){ return behCounts[b]-behCounts[a]; })[0] || '—';
    var topSpecial = Object.keys(spCounts).sort(function(a,b){ return spCounts[b]-spCounts[a]; })[0] || '—';

    if(title) title.textContent = name || 'Student';
    if(sub) sub.textContent = total + ' incidents';

    body.innerHTML =
      '<div class="kpi-grid" style="margin-bottom:10px">'+
        '<div class="kpi"><div class="lbl">Total incidents</div><div class="val">'+total+'</div></div>'+
        '<div class="kpi"><div class="lbl">Chart used</div><div class="val">'+(total?Math.round(chartY/total*100):0)+'%</div></div>'+
        '<div class="kpi"><div class="lbl">Home contact</div><div class="val">'+(total?Math.round(homeY/total*100):0)+'%</div></div>'+
        '<div class="kpi"><div class="lbl">Top behavior</div><div class="val" style="font-size:13px">'+escHtml(topBehavior)+'</div></div>'+
      '</div>'+
      '<div class="sec">Weekly trend</div><div class="card" style="margin-bottom:10px"><canvas id="stu-wk-line" height="80" style="width:100%;display:block"></canvas></div>'+
      '<div class="sec">Weekly pattern heatmap</div><div class="card" id="stu-heat-card" style="margin-bottom:10px;overflow-x:auto"></div>'+
      '<div class="card" style="margin-bottom:10px"><div style="font-size:11px;color:var(--text2);margin-bottom:6px">Most-logged specials class</div><div style="font-size:14px">'+escHtml(topSpecial)+'</div></div>'+
      (SESSION.role==='admin' ?
        '<div class="card" style="margin-bottom:10px">'+
          '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">Admin notes</div>'+
          '<textarea id="stu-notes-ta" style="width:100%;min-height:88px;background:var(--panel);border:0.5px solid var(--border);color:var(--text);border-radius:10px;padding:10px;font-family:inherit"></textarea>'+
          '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="pill" id="stu-save-note">[ Save note ]</button></div>'+
          '<div id="stu-note-status" style="font-size:10px;color:var(--text3);margin-top:6px"></div>'+
        '</div>'
      : '')+
      '<div class="sec" style="display:flex;justify-content:space-between;align-items:center">All incidents <span id="stu-inc-meta" style="font-size:10px;color:var(--text3);font-family:DM Mono,monospace"></span></div>'+
      '<div id="stu-inc-list"></div>';

    if(SESSION.role==='admin'){
      fetchStudentNote(name, function(_e, note){
        var ta = document.getElementById('stu-notes-ta');
        if(ta) ta.value = note || '';
      });
      var saveBtn = document.getElementById('stu-save-note');
      if(saveBtn){
        saveBtn.addEventListener('click', function(){
          var ta = document.getElementById('stu-notes-ta');
          var st = document.getElementById('stu-note-status');
          saveBtn.disabled = true;
          saveBtn.textContent = '[ Saving… ]';
          saveStudentNote(name, ta ? ta.value : '', function(e2){
            saveBtn.disabled = false;
            saveBtn.textContent = '[ Save note ]';
            if(st) st.textContent = e2 ? 'Save failed' : 'Saved';
          });
        });
      }
    }

    var listEl = document.getElementById('stu-inc-list');
    var metaEl = document.getElementById('stu-inc-meta');
    var weekly=buildStudentWeekly(rows);
    if(weekly.values.length){
      setTimeout(function(){ drawLine('stu-wk-line', weekly.labels, weekly.values); },20);
    }
    var activeRows=rows.slice();
    function renderStudentList(nextRows){
      activeRows=nextRows||[];
      if(metaEl) metaEl.textContent=activeRows.length+' records';
      renderIncidentList(activeRows, listEl, onRefresh);
    }
    var onRefresh = function(){
      fetchStudentIncidents(name, function(_e2, rows2){
        rows=rows2||[];
        var wk2=buildStudentWeekly(rows);
        if(wk2.values.length){
          setTimeout(function(){ drawLine('stu-wk-line', wk2.labels, wk2.values); },20);
        }
        wireHeatCard('stu-heat-card', rows, {
          prefix:'stu-heat',
          showFilters:false,
          onCellClick:function(filteredRows, ctx){
            if(!filteredRows.length){
              if(metaEl) metaEl.textContent='0 records · '+ctx.period+' '+ctx.day;
              renderIncidentList([], listEl, onRefresh);
              return;
            }
            if(metaEl) metaEl.textContent=filteredRows.length+' records · '+ctx.period+' '+ctx.day;
            renderIncidentList(filteredRows, listEl, onRefresh);
          }
        });
        renderStudentList(rows);
      });
    };
    wireHeatCard('stu-heat-card', rows, {
      prefix:'stu-heat',
      showFilters:false,
      onCellClick:function(filteredRows, ctx){
        if(!filteredRows.length){
          if(metaEl) metaEl.textContent='0 records · '+ctx.period+' '+ctx.day;
          renderIncidentList([], listEl, onRefresh);
          return;
        }
        if(metaEl) metaEl.textContent=filteredRows.length+' records · '+ctx.period+' '+ctx.day;
        renderIncidentList(filteredRows, listEl, onRefresh);
      }
    });
    renderStudentList(rows);
    wireStudentLinks(body, 'S-student');
  });
}

export { openStudent, wireStudentLinks, stuNameLink, fetchStudentNote, saveStudentNote };
