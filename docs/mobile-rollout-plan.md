# Mobile Rollout Plan for ClassPulse

You already have the right foundation (Netlify + Supabase). The best rollout path is:

1. **Ship a production-grade PWA first** (fastest, lowest risk)
2. **Wrap the same app with Capacitor** for App Store / Play Store distribution
3. **Add native-only features** (push notifications, offline sync, biometrics) in phases

---

## 1) Recommended path

### Phase 1: PWA (2-5 days)

- Keep existing Vite app hosted on Netlify.
- Add/finish:
  - valid `manifest.json` (name, icons, theme color, display standalone)
  - service worker for shell caching + offline fallback
  - install prompt handling ("Add to Home Screen")
  - mobile viewport and touch polish
- Outcome:
  - users can install from browser to home screen
  - app opens full-screen like a native app
  - single codebase, no app-store review delay

### Phase 2: App-store package with Capacitor (1-2 weeks)

- Add Capacitor to existing web build output.
- Create iOS and Android shells that load the same bundled web app.
- Configure:
  - app icons / splash screens
  - deep links and universal links
  - secure storage for auth session tokens
- Outcome:
  - downloadable from App Store / Play Store
  - same UI/logic as your web app

### Phase 3: Native enhancements (ongoing)

- Push notifications (incident reminders, digest nudges)
- Background sync / queued submissions for weak Wi-Fi areas
- Optional biometric unlock
- Optional camera/file attachments for incident evidence

---

## 2) Why this is the best fit for your current stack

- **No rewrite needed**: You keep your Vite + Supabase app.
- **Fast to pilot**: PWA can be field-tested with teachers/admins quickly.
- **Lower maintenance**: One core frontend for web + mobile shells.
- **Data model unchanged**: Supabase schema and edge functions remain source of truth.

---

## 3) Architecture for phone distribution

- **Frontend**: existing SPA (same code)
- **Backend/API**: existing Supabase Postgres + Auth + REST/Edge Functions
- **Hosting/CDN**: Netlify remains origin for web assets
- **Mobile shell**: Capacitor iOS/Android containers
- **Auth/session**:
  - web: localStorage (current)
  - native shell: secure storage plugin for tokens

---

## 4) Production checklist (high priority)

### Security & compliance

- Enforce HTTPS-only redirects
- Ensure Row-Level Security policies are strict per role (`specials`, `homeroom`, `ia`, `admin`)
- Add audit logging for record edits/deletes
- Define FERPA-aligned retention/export/delete workflows

### Reliability

- Add client-side error monitoring (Sentry or similar)
- Add uptime and DB health alerts
- Add backup/restore drills for Supabase data

### Mobile UX

- Increase tap targets to 44px+ for all interactive controls
- Verify keyboard behavior on iOS/Android forms
- Ensure charts are readable at narrow widths
- Keep critical screens performant under school Wi-Fi conditions

---

## 5) Rollout strategy (practical)

1. **Pilot group**: 5-10 staff install PWA for 2 weeks
2. **Stabilize**: fix auth/session edge cases and offline behavior
3. **Package**: ship internal TestFlight + Play Internal Testing builds
4. **Train**: publish short in-app walkthrough (login, logging, drilldowns)
5. **Launch**: app-store release + fallback PWA link for immediate access

---

## 6) Cost / effort estimate

- **PWA baseline**: low cost, very fast
- **Capacitor app-store release**: medium effort
- **Native feature parity (push/offline)**: medium-high effort, phased

If speed and adoption are your priority, start with the PWA this week and plan Capacitor packaging immediately after pilot validation.
