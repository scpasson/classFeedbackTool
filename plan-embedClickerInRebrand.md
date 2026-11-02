## Plan: Embed plickersClone into rebrand under `/clicker`

Mount the clicker as a router at `/clicker` inside rebrand, in dev only. Keep Socket.IO and the in-memory session, run it locally, and use rebrand's login to identify the teacher.

**What I found in rebrand**
- It is Express 4 (the clicker is on 5), with ejs-mate, passport and a MongoDB-backed session. Production runs on Lambda, and only dev calls `app.listen` (`app.js`).
- Model collision: both apps define a Mongoose model named `User` (`models/users.js`). The clicker's version has to go and use rebrand's.
- No route collisions under `/clicker`. Rebrand's `/dashboard` exists but is unaffected by the prefix.
- Rebrand's `package.json` lists `socket.io`, but nothing in rebrand uses it.
- Rebrand's `.env` contains AWS and SMTP keys, and they showed up in my exploration output. If this chat or its logs get shared, consider rotating them.

**Steps**
1. **Models:** copy `Class`, `Student`, `QuestionSet`, `Question`, `Response` and `Card` into `rebrand/models/clicker/`. Name them `ClickerClass` and so on, with `clicker_*` collection names, so they can't clash with your other data. `teacherId` refs point at rebrand's `User`. The clicker's own `User` model and the seed teacher are dropped.
2. **Router:** create `rebrand/routes/clickerRoutes.js` with the page and `/api` routes from `server.js`.
   - Guard it with the existing `isLoggedIn` and `requireRole('teacher','admin')` from rebrand's `middleware/roleMiddleware.js`.
   - `getTeacher()` becomes `req.user._id`.
   - Add owner checks: classes, sets and questions filtered by `teacherId`, and student routes verifying the class belongs to the user. Today these are unfiltered.
   - Drop `/api/session/default` and the `mongoose.connect` call, since rebrand's `connectToDatabase` middleware already connects.
3. **Socket:** move `activeSession` and the `show-question`, `submit-card-scan` and `get-session` handlers into `rebrand/clicker/socket.js`, exported as `attachClickerSocket(io)`. The Socket.IO path becomes `/clicker/socket.io`.
4. **Views and scripts:**
   - Copy the views to `rebrand/views/clicker/` and the scripts to `rebrand/public/clicker/scripts/`, with a router-level `express.static` at `/clicker/scripts`.
   - Replace every absolute path (`href="/active"`, `fetch('/api/...')`, script `src`) with a `CLICKER_BASE` value.
   - Client sockets become `io({ path: CLICKER_BASE + '/socket.io' })`.
   - The pages keep their own standalone look, as you wanted.
5. **Local HTTPS server:** add a `dev-server.js` in rebrand that wraps the app in an HTTP server on 4000 and an HTTPS server on 4443, with a self-signed cert in a gitignored `certs/` folder (the same cert code as today). Socket.IO attaches to both. This is what keeps phone camera access working locally, and it needs `npm i selfsigned`.
6. **`app.js` changes:** mount `/clicker` only when not in production, export the app in dev too, and only call `listen` when run directly. This keeps Lambda untouched.
7. **Seed:** a `scripts/seedClicker.js` that loads your `CARDS` without wiping anything else.
8. **Optional:** add a link to `/clicker/dashboard` on rebrand's teacher dashboard.

**Verification**
1. Log in as a teacher, open `/clicker/dashboard`, and create a class and students.
2. Open `https://<pc-ip>:4443/clicker/active` on the phone, start the camera, and scan a card.
3. Open `/clicker/presentation` in a second window and confirm questions and responses update live.
4. Log out and confirm `/clicker/*` redirects to `/login`.
5. Confirm rebrand's `sanitizeLatexAware` doesn't alter prompts containing `$...$` or the card grids.

**Deliberately left out**
- Unifying the CSS, header, footer and navbar.
- Lambda and production support, since the router isn't mounted there.
- Per-teacher session isolation. There is one global `activeSession`, which is fine for a single classroom.
- Socket authentication. For now anyone on the LAN could emit `show-question`. A later fix is to share rebrand's session with the socket.

**Questions**
1. **Existing data:** do you want the current `math_clicker` data copied into rebrand's database, or is starting fresh with the seed script fine? I'd suggest fresh, since it's only seed data.
2. **Class assignment:** should class rosters belong to the logged-in teacher only (my suggestion), or be visible to all teachers?
