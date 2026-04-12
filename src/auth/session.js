export function checkInviteToken() {
  const hash = window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash.replace('#', '?'));
  const type = params.get('type');
  const accessToken = params.get('access_token');
  if ((type === 'invite' || type === 'recovery') && accessToken) {
    return accessToken;
  }
  return null;
}
