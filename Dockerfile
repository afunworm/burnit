# syntax=docker/dockerfile:1

################################################################################

### BUILD
FROM node:20.9.0 as build-step
WORKDIR /home/burnit
COPY . .

# Client
RUN npm install -g @angular/cli
RUN npm install
RUN ng build

# Server
RUN cd ./server && npm install
EXPOSE 80
CMD ["node", "server/index.js"]