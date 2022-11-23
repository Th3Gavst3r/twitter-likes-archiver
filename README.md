# twitter-archiver

Downloads a Twitter user's liked tweets for local backup and storage.

## Building

```
npm install && npx prisma migrate deploy
```

## Running

### Environment variables

Rename the [.env.example](.env.example) file to `.env` and populate it with the following environment variables:
| Variable | Description |
| ------------ | ---------------------------------------------------------------------------------------- |
| DATABASE_URL | Desired location of your client database |
| BEARER_TOKEN | Bearer token for your [Twitter app](https://developer.twitter.com/en/docs/apps/overview) |
| USERNAME | The username of the account whose likes will be downloaded |

### Start the app

```
npm start
```

Media files will be imported to `db/client_files`.
