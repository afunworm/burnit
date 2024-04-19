![burnit](src/assets/favicon.png)

# burnit | Sharing Your Secret Safely & Minimally

burnit is a minimal temporary text sharing service. With burnit, you can configure your messages to expire with conditions such as number of views or after a certain time. You can even encrypt your message with a password.

## **Demo**

A running version of this app can be found [here](https://burnit.byh.uy/).

## **Usage**

### Basic Usage

Type in any message that you want to share, and press `Ctrl + S` or click the `Save` button and your message is ready to be shared. A link will be given to you. That link can only be used once, and expires after 7 days.

### Advanced Usage

By default, a message can only be seen once, and has an expiration of 7 days from the date it was created. After the expiration date, or after the message has been seen, it will be removed from the server. You can override and customize this behavior by adding specific configurations to the message by typing the configurations (separated by a linebreak for each configuration) before the message, separating the configurations and the message by `---`.

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
3. If a message starts with `---` without any configuration lines above it, `---` will be considered part of the message itself and the message will be saved with no custom configurations.
4. If a message with a requested `alias` already existed, the message creation will fail.

| Configuration | Alias                                                                    | Explanation                                                                                        | Example           |
| :------------ | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :---------------- |
| `nocopy`      | `obfuscate`, `obfuscated`                                                | Attempt to make the message uncopiable from the browser.                                           | `nocopy`          |
| `alias`       | `name`                                                                   | Custom alias for the URL. Alias can only contain numbers, letters and must has a length of 3 - 20. | `alias topSecret` |
| `password`    | `pwd`, `pw`                                                              | Encrypt the message with the provided password.                                                    | `pw test`         |
| `expires`     | `expire`, `expiration`, `exp`,`remove`, `removes`, `destroy`, `destroys` | Followed by a condition. Message will be destroyed and removed after the condition is met.         | `expires 5 days`  |

### Available Condition Units

**Note:**

1. Set the number of views to 0 to allow unlimited views. Time configuration is still applied.

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
