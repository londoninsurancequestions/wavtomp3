import { fetchMe } from '/public/auth.js';

async function updateNavAuth() {
  const navAccount = document.getElementById('navAccount');
  const navFiles = document.getElementById('navFiles');
  if (!navAccount) return;

  const data = await fetchMe();
  if (data?.user) {
    navAccount.textContent = 'Account';
    navAccount.href = '/account/';
    if (navFiles) navFiles.hidden = false;
  }
}

updateNavAuth();
