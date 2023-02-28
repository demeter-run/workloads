FROM node:16-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install
RUN npm install -g typescript
COPY . .
RUN npm run build

EXPOSE 9946

CMD [ "npm", "run", "start" ]