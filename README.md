![burnit](src/assets/favicon.png)

# burnit | Sharing Your Secret Safely & Minimally

burnit is a minimal temporary text sharing service. With burnit, you can configure your messaeg to expires with conditions such as number of views or after a certain time.

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
