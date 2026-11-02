async function send(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function say(id, text, ok) {
    const el = document.getElementById(id);
    el.className = `text-xs min-h-4 ${ok ? 'text-app-accent' : 'text-app-error-border'}`;
    el.textContent = text;
}

async function logout() {
    await send('/api/auth/logout', 'POST');
    location.href = '/login';
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await send('/api/auth/me', 'PUT', {
            name: document.getElementById('userName').value,
            email: document.getElementById('email').value
        });
        say('profileMsg', 'Profile saved.', true);
    } catch (err) { say('profileMsg', err.message, false); }
});

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await send('/api/auth/password', 'PUT', {
            currentPassword: document.getElementById('currentPassword').value,
            newPassword: document.getElementById('newPassword').value
        });
        e.target.reset();
        say('passwordMsg', 'Password changed.', true);
    } catch (err) { say('passwordMsg', err.message, false); }
});

document.getElementById('deleteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Permanently delete your account and all of its data?')) return;
    try {
        await send('/api/auth/me', 'DELETE', { password: document.getElementById('deletePassword').value });
        location.href = '/';
    } catch (err) { say('deleteMsg', err.message, false); }
});
