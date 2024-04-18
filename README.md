![burnit](src/assets/favicon.png)

# burnit | Sharing Your Secret Safely & Minimally

burnit is a minimal temporary text sharing service. With burnit, you can configure your messages to expire with conditions such as number of views or after a certain time. You can even encrypt your message with a password.

## **Demo**

A running version of this app can be found [here](https://burnit.byh.uy/).

## **Installation**

The easiest way to install burnit is using Docker. This guide assumes you are familiar and already had Docker Engine installed on your server.

### Using docker CLI

For quick installation, run:

```bash
docker run -d \
    --restart unless-stopped \
    --name burnit \
    -p 80:80 \
    afunworm/burnit:latest
```

To run burnit with data persistency (retain the database even if the container is destroyed), mount the `/home/burnit/data` folder.

```bash
docker run -d \
    --restart unless-stopped \
    --name burnit \
    -v ./data:/home/burnit/data \
    -p 80:80 \
    afunworm/burnit:latest
```

Now burnit should be accessible from `localhost:80`.

### Using docker-compose.yml

Create a file `docker-compose.yml`:

```yaml
services:
    burnit:
        container_name: burnit
        restart: unless-stopped
        ports:
            - "80:80"
        image: "afunworm/burnit:latest"
```

You can also mount the `/home/burnit/data` folder for persistent data:

```yaml
services:
    burnit:
        container_name: burnit
        restart: unless-stopped
        ports:
            - "80:80"
        volumes: # Optional for data persistency
            - "./data:/home/burnit/data"
        image: "afunworm/burnit:latest"
```

And run it:

```bash
docker compose up -d
```

Now burnit should be accessible from `localhost:80`.

## **LICENSE**

** TL;DR **
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
