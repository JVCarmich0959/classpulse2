import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const DIGEST_TO = Deno.env.get('DIGEST_EMAIL') ?? 'jacquelyn.carmichael@waynestem.org';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SB_URL, SB_SERVICE);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const { data: rows, error } = await supabase
    .from('incidents')
    .select('*')
    .gte('incident_date', weekAgoStr)
    .order('incident_date', { ascending: false });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const total = rows?.length ?? 0;
  if (total === 0) return new Response(JSON.stringify({ message: 'No incidents, digest skipped.' }), { status: 200 });

  const chartY = rows!.filter((r: any) => !!r.color_chart).length;
  const homeY = rows!.filter((r: any) => !!r.home_contact).length;
  const behCounts: Record<string, number> = {};
  const spCounts: Record<string, number> = {};
  const stuCounts: Record<string, number> = {};
  const clsCounts: Record<string, number> = {};

  for (const r of rows as any[]) {
    for (const b of (r.behaviors ?? [])) behCounts[b] = (behCounts[b] ?? 0) + 1;
    if (r.specials) spCounts[r.specials] = (spCounts[r.specials] ?? 0) + 1;
    if (r.student) stuCounts[r.student] = (stuCounts[r.student] ?? 0) + 1;
    if (r.homeroom) clsCounts[r.homeroom] = (clsCounts[r.homeroom] ?? 0) + 1;
  }

  const topBehs = Object.entries(behCounts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const topStus = Object.entries(stuCounts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const topCls = Object.entries(clsCounts).sort((a,b) => b[1]-a[1]).slice(0,5);

  const subject = `ClassPulse Weekly Digest — ${total} incidents (${weekAgoStr})`;
  const from = 'ClassPulse <digest@classpulse.waynestem.org>';
  const html = `<div style="background:#060a0f;color:#d9fff8;padding:24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace"><h1 style="margin:0 0 8px;color:#00e6c8">ClassPulse Weekly Digest</h1><p style="margin:0 0 16px;color:#8adfd2">Since ${weekAgoStr}</p><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px"><div style="border:1px solid #13423b;padding:10px 12px">Total: <b>${total}</b></div><div style="border:1px solid #13423b;padding:10px 12px">Chart: <b>${Math.round((chartY/total)*100)}%</b></div><div style="border:1px solid #13423b;padding:10px 12px">Home: <b>${Math.round((homeY/total)*100)}%</b></div></div><h3 style="color:#00e6c8">Top behaviors</h3><ul>${topBehs.map(([k,v]) => `<li>${k}: ${v}</li>`).join('')}</ul><h3 style="color:#00e6c8">Top students</h3><ul>${topStus.map(([k,v]) => `<li>${k}: ${v}</li>`).join('')}</ul><h3 style="color:#00e6c8">Top classrooms</h3><ul>${topCls.map(([k,v]) => `<li>${k}: ${v}</li>`).join('')}</ul></div>`;

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ total, topBehs, topStus, topCls,
      message: 'RESEND_API_KEY not set — email not sent' }),
      { headers: { 'Content-Type': 'application/json' } });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [DIGEST_TO], subject, html })
  });

  return new Response(JSON.stringify({ success: emailRes.ok, total }), {
    status: emailRes.ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' }
  });
});
