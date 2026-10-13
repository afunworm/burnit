![burnit](public/favicon.png)

# burnit | Sharing Your Secret Safely & Minimally

burnit is a minimal temporary text sharing service. With burnit, you can configure your messages to expire with conditions such as number of views or after a certain time. Messages are end-to-end encrypted in your browser, and you can additionally protect them with a password.

## **Demo**

A running version of this app can be found [here](https://burnit.byh.uy/).

## **Usage**

### Basic Usage

Type in any message that you want to share, and press `Ctrl + S` or click the `Save` button and your message is ready to be shared. A link will be given to you. That link can only be used once, and expires after 7 days.

The part of the link after `#` is the decryption key. It never leaves the browser, so the server only ever stores encrypted data. Anyone with the full link can open the message, and the message cannot be recovered if the link is lost.

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
5. If a message with a requested `alias` already exists, the message creation will fail.
6. Messages always expire within 1 year (configurable by the host, see `MAX_TTL_DAYS`).

| Configuration | Alias                                                                    | Explanation                                                                                        | Example           |
| :------------ | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :---------------- |
| `nocopy`      | `obfuscate`, `obfuscated`                                                | Attempt to make the message uncopiable from the browser.                                           | `nocopy`          |
| `alias`       | `name`                                                                   | Custom alias for the URL. Alias can only contain numbers, letters and must has a length of 3 - 20. | `alias topSecret` |
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

The repository's `docker-compose.yml` builds the image straight from a checkout, so nothing needs to be pushed to a registry. It joins an existing external `pangolin` network for the reverse proxy instead of publishing ports. Point your proxy at `burnit:80`.

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
| `MAX_FAILED_ATTEMPTS` | `10`                | Wrong passwords allowed before a message is destroyed.                                            |
| `RATE_LIMIT_CREATE`   | `30`                | Messages one IP can create per 15 minutes.                                                        |
| `RATE_LIMIT_OPEN`     | `60`                | Open attempts one IP can make per 15 minutes.                                                     |

## **How It Works**

-   Each message gets a random 256-bit secret, which is put in the link's fragment (`/v/<id>#<secret>`). Browsers never send the fragment to the server.
-   If a password is set, it is stretched with PBKDF2-SHA256 (600,000 iterations) using the secret as salt. Without the link, the password cannot be brute-forced, even with a copy of the database.
-   Two independent keys are derived with HKDF: an AES-256-GCM key that encrypts the message in the browser, and an access token. The server only stores the ciphertext and the SHA-256 hash of the access token.
-   To open a message, the browser sends the access token. A wrong password or link is rejected without consuming a view, and too many failures destroy the message.
-   Views are counted atomically in SQLite, and the last allowed view deletes the message in the same transaction. Deleted data is overwritten (`secure_delete`), and expired messages are purged every minute.

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
