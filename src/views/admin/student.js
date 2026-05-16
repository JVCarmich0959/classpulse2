import { SB_URL, SB_KEY } from '../../config.js';
import { SESSION, showScreen, escHtml, fetchStudentIncidents, renderIncidentList, setStuPrevScreen, getStuPrevScreen, drawLine, wireHeatCard, displayBehavior, skeletonKpis, skeletonRows, animateListIn, showToast, emptyState, authedFetch, buildAcc, subjectBarColor } from '../../main.js';

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
  return r.incident_date || r.date || (r.created_at||'').slice(0,10) || '';
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
  if(body) body.innerHTML = skeletonKpis(6) + skeletonRows(6);
  showScreen('S-student');

  fetchStudentIncidents(name, function(err, rows){
    rows = rows || [];
    if(err){
      if(body) body.innerHTML = emptyState('Could not load records', 'Check your connection and try again.');
      showToast('Could not connect', 'error');
      return;
    }
    var total = rows.length;
    var transitionCount = rows.filter(function(r){ return r._type === 'transition'; }).length;
    var incidentCount = rows.filter(function(r){ return r._type === 'incident'; }).length;
    var chartY = rows.filter(function(r){ return !!r.color_chart; }).length;
    var homeY = rows.filter(function(r){ return !!r.home_contact; }).length;
    var behCounts = {};
    var spCounts = {};
    var blockCounts = {};
    rows.forEach(function(r){
      (r.behaviors||[]).forEach(function(bh){ var mapped=displayBehavior(bh); behCounts[mapped]=(behCounts[mapped]||0)+1; });
      if(r.specials) spCounts[r.specials]=(spCounts[r.specials]||0)+1;
      if(!r.specials) return;
      if(r._type === 'transition' && r.to_color === 'Green') return;
      blockCounts[r.specials] = (blockCounts[r.specials] || 0) + 1;
    });
    var topBehavior = Object.keys(behCounts).sort(function(a,b){ return behCounts[b]-behCounts[a]; })[0] || '—';
    var topSpecial = Object.keys(spCounts).sort(function(a,b){ return spCounts[b]-spCounts[a]; })[0] || '—';
    var blocks = Object.keys(blockCounts).sort(function(a,b){ return blockCounts[b]-blockCounts[a]; });
    var maxBlock = blocks.length ? blockCounts[blocks[0]] : 0;

    if(title) title.textContent = name || 'Scholar';
    if(sub) sub.textContent = total + ' behavior records';

    var kpiHtml =
      '<div class="kpi-grid" style="margin-bottom:10px">'+
        '<div class="kpi"><div class="lbl">Total records</div><div class="val">'+total+'</div></div>'+
        '<div class="kpi"><div class="lbl">Quick Color events</div><div class="val">'+transitionCount+'</div></div>'+
        '<div class="kpi"><div class="lbl">Full incidents</div><div class="val">'+incidentCount+'</div></div>'+
        '<div class="kpi"><div class="lbl">Chart used</div><div class="val">'+(total?Math.round(chartY/total*100):0)+'%</div></div>'+
        '<div class="kpi"><div class="lbl">Home contact</div><div class="val">'+(total?Math.round(homeY/total*100):0)+'%</div></div>'+
        '<div class="kpi"><div class="lbl">Top behavior</div><div class="val" style="font-size:13px">'+escHtml(topBehavior)+'</div></div>'+
      '</div>';
    var blockHeatHtml = '<div class="card" style="margin-bottom:10px">'+
      '<div style="font-size:11px;color:var(--text2);margin-bottom:8px">By specials block</div>'+
      (blocks.length ? blocks.map(function(block, i){
        var count = blockCounts[block] || 0;
        var pct = maxBlock ? Math.max(4, Math.round(count / maxBlock * 100)) : 0;
        var col = subjectBarColor(i);
        return '<div style="display:grid;grid-template-columns:minmax(78px,1fr) 3fr 28px;gap:8px;align-items:center;margin-bottom:7px">'+
          '<div style="font-size:11px;color:'+col+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(block)+'</div>'+
          '<div style="height:8px;border-radius:999px;background:rgba(152,162,173,.18);overflow:hidden">'+
            '<div style="width:'+pct+'%;height:100%;border-radius:999px;background:'+col+'"></div>'+
          '</div>'+
          '<div style="font-size:11px;color:var(--text2);text-align:right">'+count+'</div>'+
        '</div>';
      }).join('') : emptyState('No specials blocks yet', ''))+
    '</div>';
    var weeklyHtml = '<div class="card" style="margin-bottom:10px"><canvas id="stu-wk-line" height="80" style="width:100%;display:block"></canvas></div>';
    var heatmapHtml = '<div class="card" id="stu-heat-card" style="margin-bottom:10px;overflow-x:auto"></div>'+
      '<div class="card" style="margin-bottom:10px"><div style="font-size:11px;color:var(--text2);margin-bottom:6px">Most-logged specials class</div><div style="font-size:14px">'+escHtml(topSpecial)+'</div></div>';
    var incHtml = '<div id="stu-inc-list"></div>';
    var firstAidHtml = '<div id="stu-first-aid"></div>';
    var accomHtml = SESSION.role==='admin' ?
      '<div class="card" style="margin-bottom:10px">'+
        '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">Admin notes</div>'+
        '<textarea id="stu-notes-ta" style="width:100%;min-height:88px;background:var(--panel);border:0.5px solid var(--border);color:var(--text);border-radius:10px;padding:10px;font-family:inherit"></textarea>'+
        '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="pill" id="stu-save-note">Save note</button></div>'+
        '<div id="stu-note-status" style="font-size:10px;color:var(--text3);margin-top:6px"></div>'+
      '</div>'+
      '<div id="stu-accommodations"></div>' : '';
    var transHtml = SESSION.role==='admin' ? '<div id="stu-transitions"></div>' : '';
    body.innerHTML = kpiHtml + blockHeatHtml +
      buildAcc('stu','trend','Weekly trend','',weeklyHtml,true) +
      buildAcc('stu','heatmap','Pattern heatmap','',heatmapHtml,true) +
      buildAcc('stu','incidents','Behavior timeline',total+' records',incHtml,true) +
      buildAcc('stu','firstaid','First aid / injury log','',firstAidHtml,false) +
      (SESSION.role==='admin' ? buildAcc('stu','acc','Accommodations','Admin only',accomHtml,false) : '') +
      (SESSION.role==='admin' ? buildAcc('stu','trans','Color transition history','Admin only',transHtml,false) : '');

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
            saveBtn.textContent = 'Save note';
            if(st) st.textContent = e2 ? 'Save failed' : '';
            if(e2) showToast('Could not connect', 'error');
            else showToast('Note saved');
          });
        });
      }
    }

    if(SESSION.role==='admin'){
      var ctWrap = document.getElementById('stu-transitions');
      if(ctWrap){
        authedFetch('/rest/v1/color_transitions?student=eq.' + encodeURIComponent(name) + '&select=*&order=created_at.desc&limit=30')
          .then(function(r){ return r.json(); })
          .then(function(rows){
            if(!rows || !rows.length){
              ctWrap.innerHTML = emptyState('No color transitions logged', 'Color transitions will appear here when teachers log them.');
              return;
            }
            var colorHex = { Green:'#1e7e44', Yellow:'#BFA95F', Orange:'#d4622a', Red:'#c0392b' };
            ctWrap.innerHTML = '<div class="card">' +
              rows.map(function(r){
                var fromC = colorHex[r.from_color] || '#98A2AD';
                var toC = colorHex[r.to_color] || '#98A2AD';
                var time = r.created_at ? new Date(r.created_at).toLocaleString('en-US', {
                  month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
                }) : '';
                var resolved = r.resolved_at
                  ? '<span style="font-size:10px;color:#1e7e44;margin-left:8px;font-weight:600">Returned to Green</span>'
                  : '';
                return '<div style="padding:10px 0;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:10px">' +
                  '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">' +
                    '<div style="width:10px;height:10px;border-radius:50%;background:' + fromC + '"></div>' +
                    '<span style="font-size:12px;color:var(--text3)">→</span>' +
                    '<div style="width:10px;height:10px;border-radius:50%;background:' + toC + '"></div>' +
                  '</div>' +
                  '<div style="flex:1;min-width:0">' +
                    '<span style="font-size:12px;font-weight:600;color:var(--text)">' + escHtml(r.specials || '') + '</span>' +
                    resolved +
                    (r.notes ? '<div style="font-size:11px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.notes) + '</div>' : '') +
                  '</div>' +
                  '<span style="font-size:10px;color:var(--text3);flex-shrink:0">' + escHtml(time) + '</span>' +
                '</div>';
              }).join('') +
            '</div>';
          })
          .catch(function(){
            if(ctWrap) ctWrap.innerHTML = emptyState('Could not load transitions', '');
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
      animateListIn(listEl);
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

    fetch(SB_URL + '/rest/v1/first_aid_log?student=eq.' + encodeURIComponent(name) + '&select=*&order=incident_date.desc,created_at.desc&limit=100', {
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token}
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(faRows){
      var wrap=document.getElementById('stu-first-aid');
      if(!wrap) return;
      if(!faRows || !faRows.length){
        wrap.innerHTML='<div class="card">' + emptyState('No first aid records', 'First aid events will appear here when logged.') + '</div>';
        return;
      }
      wrap.innerHTML='<div class="card">'+faRows.map(function(r){
        return '<div style="padding:8px 0;border-bottom:0.5px solid var(--border)">'+
          '<div style="font-size:12px;font-weight:600">'+escHtml(r.incident_date||'—')+' · '+escHtml(r.specials||'—')+'</div>'+
          '<div style="font-size:11px;color:var(--text2);margin-top:2px">Injury: '+escHtml(r.injury_description||'—')+'</div>'+
          '<div style="font-size:11px;color:var(--text2)">Treatment: '+escHtml(r.treatment||'—')+'</div>'+
          '<div style="font-size:11px;color:var(--text2)">Returned to activity: '+(r.returned_to_activity?'Yes':'No')+' · Home contacted: '+(r.home_contact?'Yes':'No')+'</div>'+
        '</div>';
      }).join('')+'</div>';
    }).catch(function(){
      var wrap=document.getElementById('stu-first-aid');
      if(wrap) wrap.innerHTML='<div class="card">' + emptyState('Could not load records', 'Check your connection and try again.') + '</div>';
      showToast('Could not load first aid records', 'error');
    });
    if(SESSION.role==='admin'){
      var accWrap = document.getElementById('stu-accommodations');
      if(accWrap){
        fetch(SB_URL + '/rest/v1/student_accommodations?student_name=eq.' + encodeURIComponent(name) + '&select=plan_type,classroom_accommodations&limit=1', {
          headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SESSION.token}
        }).then(function(r){
          if(!r.ok) throw new Error('HTTP '+r.status);
          return r.json();
        }).then(function(rows){
          if(!rows || !rows.length || !rows[0].classroom_accommodations){
            accWrap.innerHTML=emptyState('No accommodations on file', '');
            return;
          }
          var rec=rows[0];
          accWrap.innerHTML=
            '<div class="card">'+
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
                '<span style="font-size:12px;font-weight:700;color:var(--indigo)">'+escHtml(rec.plan_type)+' — Classroom Accommodations</span>'+
                '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--indigo-lt);color:var(--indigo);font-weight:600;letter-spacing:.04em">CONFIDENTIAL</span>'+
              '</div>'+
              '<div style="font-size:13px;color:var(--text2);line-height:1.75">'+escHtml(rec.classroom_accommodations)+'</div>'+
            '</div>';
        }).catch(function(){
          if(accWrap) accWrap.innerHTML=emptyState('Could not load accommodations', '');
          showToast('Could not connect', 'error');
        });
      }
    }

  });
}

export { openStudent, wireStudentLinks, stuNameLink, fetchStudentNote, saveStudentNote };
