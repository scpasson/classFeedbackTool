// Usage: node reset-password.js <email> <newPassword>
// Lets you claim an existing account (e.g. the old dummy teacher) so its data stays reachable.
const mongoose = require('mongoose');
const User = require('./models/User');
const { hashPassword } = require('./auth');

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Usage: node reset-password.js <email> <newPassword (8+ chars)>');
  process.exit(1);
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/math_clicker');
  const user = await User.findOneAndUpdate({ email: email.toLowerCase().trim() }, { passwordHash: hashPassword(password) });
  console.log(user ? `Password updated for ${user.email}` : 'No user with that email.');
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
