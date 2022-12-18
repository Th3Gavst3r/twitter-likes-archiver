# twitter-archiver

Downloads liked tweets for local backup and storage.

## Building

```
npm install && npx prisma migrate deploy
```

## Running

### Environment variables

Rename the [`.env.example`](.env.example) file to `.env` and populate it with the following environment variables:

| Variable       | Description                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| DATABASE_URL   | Desired location of your database file.                                                         |
| CLIENT_ID      | Client ID for your [Twitter app](https://developer.twitter.com/en/docs/apps/overview).          |
| CLIENT_SECRET  | Client secret for your [Twitter app](https://developer.twitter.com/en/docs/apps/overview).      |
| SESSION_SECRET | A random secret used to secure session cookies. Can be any string.                              |
| BASE_URL       | The URL where your web server is hosted. The server starts on http://localhost:3000 by default. |

### Start the app

```
npm start
```

Once the server has started listening, navigate to http://localhost:3000 in your web browser.

Media files will be imported to `db/client_files`.
