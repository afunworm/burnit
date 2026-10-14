![burnit](public/favicon.png)

# burnit | Sharing Your Secret Safely & Minimally

burnit is a minimal temporary text sharing service. With burnit, you can configure your messages to expire with conditions such as number of views or after a certain time. Messages are end-to-end encrypted in your browser, and you can additionally protect them with a password.

## **Demo**

A running version of this app can be found [here](https://burnit.byh.uy/).

## **Usage**

### Basic Usage

Type in any message that you want to share, and press `Ctrl + S` or click the `Save` button and your message is ready to be shared. A link will be given to you. That link can only be used once, and expires after 7 days.

The part of the link after `#` is the decryption key. It never leaves the browser, so the server only ever stores encrypted data. Anyone with the full link can open the message, and the message cannot be recovered if the link is lost.

Not into typing configuration? Click any setting in the status bar (`views:1`, `ttl:7d`, ...) or press `Ctrl + O` to pick views, expiry, password, `nocopy` and alias from a menu. Your choices are written as configuration lines at the top of the message, so both ways give the same result.

### Short Links and QR Codes

The full link is long, because it carries the key. To open a message on another device:

-   **QR code**: click `QR CODE` next to any link and scan it with a phone. This keeps the full link, so nothing changes about the encryption.
-   **Short link**: add `alias test` to the configuration (or click `MAKE SHORT LINK` after saving) to get `https://<your-domain>/test`, which is easy to type. Short links are case-insensitive and **work once, for 15 minutes**. While a short link exists, the server holds the message's key, so the server operator could read the message during that window. A password still protects it, since the password never goes into a short link. If someone else uses your short link first, you get "not found" instead of the message, so interception doesn't go unnoticed.

Signed-in users can make new short links (named or random), invalidate them, and show their QR codes from the message's page in their account.

### Advanced Usage

By default, a message can only be seen once, and has an expiration of 7 days from the date it was created. The message is deleted from the server as soon as it is opened for the last time, and expired messages are purged automatically. You can override and customize this behavior by adding specific configurations to the message by typing the configurations (separated by a linebreak for each configuration) before the message, separating the configurations and the message by `---`.

For example, this is the default configuration (when no configuration is given):

```
expires 7d
expires 1v
---
Your message goes here
```

You can override the message's configuration however you want (see below for all available configurations). For example:

```
nocopy
password secret sauce
expires 3 days
delete 11 view
---
This message requires the password "secret sauce" to open, and will be destroyed after 3 day or 11 views. The browser will also attempt to disable copy of the message by obfuscate it and apply certain CSS to it.
```

### Available Configurations

**Note:**

1. If you configure the expiration by date, or by views, the other default configuration will still remain active (e.g. if you configure expires 10 days, the message still have the property of expires 1). You need to overwrite that to get the desire effect.
2. Each configuration has to be on its own line.
3. Configuration is only recognized when the first line starts with a configuration keyword. Otherwise (including when a message starts with `---`), the whole text is saved as the message with the default configuration.
4. Inside the configuration block, every line must be valid. Unknown or malformed lines are reported, and the message is not saved.
5. If the requested `alias` is in use by another live short link, the message is not created.
6. Messages always expire within 1 year (configurable by the host, see `MAX_TTL_DAYS`).

| Configuration | Alias                                                                    | Explanation                                                                                        | Example           |
| :------------ | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :---------------- |
| `nocopy`      | `obfuscate`, `obfuscated`                                                | Attempt to make the message uncopiable from the browser.                                           | `nocopy`          |
| `alias`       | `name`                                                                   | Also make a short link with this name (3 - 20 letters or numbers). See Short Links above.          | `alias topSecret` |
| `password`    | `pwd`, `pw`                                                              | Encrypt the message with the provided password.                                                    | `pw test`         |
| `expires`     | `expire`, `expiration`, `exp`,`remove`, `removes`, `destroy`, `destroys` | Followed by a condition. Message will be destroyed and removed after the condition is met.         | `expires 5 days`  |

### Available Condition Units

**Note:**

1. Set the number of views to 0 to allow unlimited views. Time configuration is still applied.
2. Units are case-insensitive, except `m` (minutes) and `M` (months).

| Unit     | Alias                              | Definition      |
| :------- | :--------------------------------- | :-------------- |
| `minute` | `minutes`, `min`, `mins`, `m`      | Minutes         |
| `hour`   | `hours`, `h`, `hr`                 | Hours           |
| `day`    | `days`, `d`                        | Days            |
| `week`   | `weeks`, `wk`, `wks`, `w`          | Weeks           |
| `month`  | `months`, `mo`, `M`                | Months          |
| `year`   | `years`, `yr`, `yrs`, `y`          | Years           |
| `view`   | `views`, `v`, `time`, `times`, `t` | Number of Views |

## **Installation**

The easiest way to install burnit is using Docker. This guide assumes you are familiar and already had Docker Engine installed on your server.

**burnit must be served over HTTPS** (or from `localhost`). Browsers only allow the encryption APIs it relies on in a secure context. Put it behind a reverse proxy that terminates TLS (Caddy, Traefik, nginx, ...), and set `TRUST_PROXY` so rate limiting sees real client IPs.

### Using docker CLI

```bash
docker run -d \
    --restart unless-stopped \
    --name burnit \
    -v burnit-data:/home/burnit/data \
    -p 80:80 \
    afunworm/burnit:latest
```

Messages are stored in a SQLite database in `/home/burnit/data`. The container runs as the unprivileged `node` user (uid 1000), so if you bind-mount a host folder instead of a named volume, make sure that user can write to it.

### Using docker-compose.yml

Create a file `docker-compose.yml`:

```yaml
services:
    burnit:
        container_name: burnit
        restart: unless-stopped
        ports:
            - "80:80"
        environment:
            TRUST_PROXY: "1" # One reverse proxy in front of burnit
        volumes:
            - "burnit-data:/home/burnit/data"
        image: "afunworm/burnit:latest"

volumes:
    burnit-data:
```

And run it:

```bash
docker compose up -d
```

### Building from source

The repository's `docker-compose.yml` builds the image straight from a checkout, so nothing needs to be pushed to a registry. It joins the external `dokploy-network` (Dokploy's Traefik network) instead of publishing ports. Point the domain at the `burnit` service, port `80`.

```bash
git pull && docker compose up -d --build
```

### Configuration

| Variable              | Default             | Description                                                                                       |
| :-------------------- | :------------------ | :------------------------------------------------------------------------------------------------ |
| `PORT`                | `80` (Docker)       | Port the server listens on (`3000` outside Docker).                                               |
| `DATA_DIR`            | `/home/burnit/data` | Folder of the SQLite database.                                                                    |
| `TRUST_PROXY`         | `false`             | Express `trust proxy` setting: `true`, a hop count, or a comma-separated list of proxy addresses. |
| `MAX_TTL_DAYS`        | `366`               | Maximum lifetime of a message.                                                                    |
| `MAX_VIEWS`           | `10000`             | Maximum view limit a message can have (0 = unlimited is always allowed).                          |
| `MAX_MESSAGE_KB`      | `512`               | Maximum size of an encrypted message.                                                             |
| `MAX_FAILED_ATTEMPTS` | `10`                | Failed opens (wrong password or link, unknown short link) one IP can make per 15 minutes.          |
| `SHORT_LINK_MINUTES`  | `15`                | How long a short link works, unless it is used first.                                             |
| `RATE_LIMIT_CREATE`   | `30`                | Messages one IP can create per 15 minutes.                                                        |
| `RATE_LIMIT_OPEN`     | `60`                | Open attempts one IP can make per 15 minutes.                                                     |
| `RATE_LIMIT_ACCOUNT`  | `600`               | Account API requests one IP can make per 15 minutes.                                              |

### Accounts (optional)

burnit works without accounts. To let people sign in with [PocketID](https://pocket-id.org) (or any OpenID Connect provider), create an OIDC client there with the callback URL `https://<your-domain>/auth/callback`, and set:

| Variable             | Default    | Description                                                                         |
| :------------------- | :--------- | :---------------------------------------------------------------------------------- |
| `PUBLIC_URL`         |            | Public origin of burnit, e.g. `https://burnit.example.com`. Recommended.            |
| `OIDC_ISSUER`        |            | The provider's URL, e.g. `https://id.example.com`.                                  |
| `OIDC_CLIENT_ID`     |            | Client ID from the provider.                                                        |
| `OIDC_CLIENT_SECRET` |            | Client secret from the provider.                                                    |
| `OIDC_PROVIDER_NAME` | `PocketID` | Name on the sign-in button.                                                         |
| `SESSION_DAYS`       | `30`       | How long a sign-in lasts.                                                           |
| `HISTORY_DAYS`       | `30`       | How long destroyed messages stay listed (without content) in their owner's history. |

Accounts are created on first sign-in. Signed-in users find their messages under `/account` (`Ctrl + K`), where they can read them again without using up a view, edit content and settings, or destroy them early.

## **How It Works**

-   Each message gets a random 256-bit secret, which is put in the link's fragment (`/v/<id>#<secret>`). Browsers never send the fragment to the server.
-   If a password is set, it is stretched with PBKDF2-SHA256 (600,000 iterations) using the secret as salt. Without the link, the password cannot be brute-forced, even with a copy of the database.
-   Two independent keys are derived with HKDF: an AES-256-GCM key that encrypts the message in the browser, and an access token. The server only stores the ciphertext and the SHA-256 hash of the access token.
-   To open a message, the browser sends the access token. A wrong password or link is rejected without consuming a view. Too many failures block that IP for a while; they never destroy the message, so knowing its id isn't enough to destroy it.
-   Views are counted atomically in SQLite, and the last allowed view deletes the message in the same transaction. Deleted data is overwritten (`secure_delete`), and expired messages are purged every minute.
-   Short links are the exception, and are opt-in: a short link stores the link secret (never the password) on the server until it is used, its 15 minutes run out, or the message burns. Resolving one is a `POST`, so link previews and scanners can't use it up.
-   Accounts don't weaken this. Sign-in uses the OIDC authorization code flow with PKCE, and the session cookie is `HttpOnly` and `SameSite=Lax`. To let owners read their messages again, each one carries a copy of its link secret and password, encrypted in the browser with a vault key. The vault key is stored on the server only wrapped with the user's vault passphrase (PBKDF2-SHA256, 600,000 iterations), so the server can't read owned messages either. When an owned message burns, its ciphertext and key copy are wiped; only the bookkeeping (views, dates) stays in the owner's history.

## **Development**

Requires Node.js 22.22.3+ or 24.15+.

```bash
# API server on http://localhost:3000
cd server && npm install && npm run dev

# Angular dev server on http://localhost:4200, proxying /api to the server
npm install && npm start
```

-   `npm test` runs the client unit tests, and `cd server && npm test` runs the API tests.
-   `npm run build` builds the client into `server/public`, where the server picks it up.

## **History**

burnit was originally built by hand by its maintainer. AI was later brought in to help with improvements, new features and a new terminal-style look, while the original concept stayed the same: write a secret, share a link, and let it burn.

## **LICENSE**

#### TL;DR

[MIT](https://en.wikipedia.org/wiki/MIT_License). You can do whatever you want with this software, for any kind of use (personal or commercial). I claim no warranty of any kind.

```bash
MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
