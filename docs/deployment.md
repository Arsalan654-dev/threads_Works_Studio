# Deployment (Vercel + Railway + MongoDB Atlas)

This is the hosted shape of ThreadWorks Studio:

```
Browser ──► Vercel (client/dist, static React) ──► Railway (Express API) ──► Atlas (MongoDB)
```

Local use is unchanged: with no environment variables the API binds
`127.0.0.1`, talks to `mongodb://127.0.0.1:27017/embroidery_studio`, and the
Vite dev server proxies `/api`.

---

## 1. MongoDB Atlas (database)

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user with **Read and write to any database**
   (or just the `embroidery_studio` database).
3. **Network Access** → **Add IP Address** → `0.0.0.0/0`. Railway does not
   publish fixed outbound IPs on the trial plan, so Atlas has to accept the
   connection from anywhere. The database user and password are what protect
   it.
4. **Connect → Drivers** → copy the SRV string and insert the database name:

   ```text
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/embroidery_studio?retryWrites=true&w=majority
   ```

   If the password contains `@ : / ? # [ ] %`, URL-encode it (`@` → `%40`).
   The app refuses a string that does not start with `mongodb://` or
   `mongodb+srv://`.

The first Railway boot runs the seed script automatically, so hoops, palettes,
digitizing presets and the nine motifs appear in the fresh database without a
manual step.

---

## 2. Railway (API)

1. Push this repository to GitHub (see §4).
2. Railway → **New Project → Deploy from GitHub repo** → pick the repository.
3. Leave the service root at the **repository root**. `railway.json` supplies
   the build and start commands:

   - build: `npm ci --include=dev && npm run build -w @threadworks/engine && npm run build -w @threadworks/server`
   - start: `node server/dist/scripts/seed.js && node server/dist/server.js`
   - health check: `/api/health`

4. **Variables** on the service:

   | Variable       | Value                                                                          |
   | -------------- | ------------------------------------------------------------------------------ |
   | `MONGODB_URI`  | the Atlas SRV string from §1                                                   |
   | `CORS_ORIGINS` | the Vercel URL, e.g. `https://threadworks.vercel.app` (comma-separate several) |
   | `NODE_ENV`     | `production`                                                                   |

   `PORT` is injected by Railway and takes precedence over `SERVER_PORT`.
   `SERVER_HOST` can stay unset: production binds `0.0.0.0`.

5. **Settings → Networking → Generate Domain**. Call the result
   `https://<name>.up.railway.app` the **API origin**.
6. Open `https://<name>.up.railway.app/api/health`; it must return `200` with
   `"database":"connected"`.

`CORS_ORIGINS` accepts exact origins and one wildcard level:
`https://threadworks.vercel.app,https://*.vercel.app`. Loopback is always
allowed, so local development keeps working against the same code.

---

## 3. Vercel (client)

1. Vercel → **Add New → Project** → import the same GitHub repository.
2. Keep the **root directory** as the repository root. `vercel.json` sets:

   - install: `npm ci --include=dev`
   - build: `npm run build -w @threadworks/engine && npm run build -w @threadworks/client`
   - output: `client/dist`
   - SPA rewrite: every path returns `index.html`

3. **Environment Variables** (Production and Preview):

   | Variable       | Value                                      |
   | -------------- | ------------------------------------------ |
   | `VITE_API_URL` | the Railway API origin, **without** `/api` |

   `VITE_API_URL` is compiled into the bundle, so changing it requires a
   redeploy of the Vercel project.

4. Deploy, then copy the production domain (e.g.
   `https://threadworks.vercel.app`).
5. Put that domain into the Railway service's `CORS_ORIGINS` and redeploy the
   API. Without it the browser gets `ORIGIN_NOT_ALLOWED`.

### Order that avoids the CORS deadlock

1. Deploy Railway first (CORS can be empty for now).
2. Deploy Vercel with `VITE_API_URL` set.
3. Set `CORS_ORIGINS` to the Vercel production domain (plus
   `https://*.vercel.app` if preview URLs matter).
4. Redeploy Railway, then reload the Vercel site.

---

## 4. GitHub repository

The project is not a git repository yet. From `D:\my-embroidery-software`:

```powershell
git init
git add .
git commit -m "ThreadWorks Studio"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

`.env`, `node_modules`, `dist` and `data` are already ignored. Do not commit
the Atlas string or any account password.

Railway and Vercel can then watch `main` and redeploy on every push.

---

## 5. What persists where

| Data                                  | Stored in                                     |
| ------------------------------------- | --------------------------------------------- |
| projects, versions, presets, settings | MongoDB Atlas                                 |
| exports                               | generated in the browser, downloaded directly |
| backups / uploads on disk             | Railway container (ephemeral)                 |

The app's real data is all in MongoDB. Railway's filesystem is temporary on
the trial plan, so do not rely on `data/backups` there; use the project and
version history instead.

---

## 6. Deleting an older deployment

Vercel: **Project → Settings → General → Delete Project**. This removes the
deployment and its domains. Also remove the GitHub integration if the repo
should no longer deploy.

Railway: open the project → **Settings → Danger → Delete Project**. Delete the
service first if the project contains more than one. Generated domains go with
it.

Atlas: delete the cluster only after the Railway project is gone, otherwise
the API cannot start. Keep the database if you plan to reuse the data.

---

## 7. Security notes (read before making the URL public)

- The API has **no login**. CORS stops other _web pages_ from calling it with a
  visitor's browser, but anyone with the Railway URL and a script can read and
  write projects. Treat the URL as private, or add an access token/auth layer
  before sharing it.
- Keep the Atlas user limited to the `embroidery_studio` database.
- A leaked `MONGODB_URI` gives direct database access. Rotate the Atlas user if
  it is ever exposed.
- Vercel's free (Hobby) tier is free for personal use. **Railway no longer has
  a perpetual free tier**: the trial includes a small one-time credit, after
  which the service bills by usage or sleeps. If you need a permanently free
  API host, Render's free web service (sleeps when idle) or a Vercel
  serverless function are the alternatives; the server code is unchanged.

---

## 8. Verification checklist

- [ ] `GET /api/health` → `200`, `"database":"connected"`
- [ ] Vercel page loads with no console CORS errors
- [ ] the reference data (hoops, palettes, presets, motifs) appears
- [ ] create a project, reload the page, the project is still listed
- [ ] export a DST and open it in a viewer
- [ ] restart the Railway service; the project still exists (it is in Atlas)
