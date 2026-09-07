# Mirrors xeno-journeys' multi-stage build. The --mount=type=ssh is kept from the org's
# pattern for private git dependencies; this repo has none today but Jenkins passes it anyway.
FROM node:20 AS env

ENV NODE_ENV production

FROM env AS deps

WORKDIR /app

COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases

RUN --mount=type=ssh \
  mkdir -p /root/.ssh && chmod 0700 /root/.ssh \
  && ssh-keyscan -T 60 github.com >> /root/.ssh/known_hosts \
  && yarn install --immutable

FROM env AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

# The CronJob overrides this with the module and channel it wants.
CMD ["yarn", "run:daily", "--module=journeys"]
