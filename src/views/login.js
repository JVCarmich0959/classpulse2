import { SB_URL, SB_KEY } from '../config.js';

export function initPasswordSetup(token) {
  return fetch(`${SB_URL}/auth/v1/user`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`
    }
  }).then(function (r) {
    if (!r.ok) throw new Error('Invalid invite link');
    return r.json();
  });
}
